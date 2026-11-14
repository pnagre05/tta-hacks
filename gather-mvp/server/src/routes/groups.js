const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { query, withTx } = require('../db');
const { HttpError, parse } = require('../http');
const { requireGroupMember } = require('../auth');
const { emitGroupUpdate } = require('../realtime');

const router = express.Router();

// No 0/O or 1/I so codes are easy to read aloud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function inviteCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  timezone: z.string().max(64).refine(validTimeZone, 'Unknown time zone').default('America/Chicago'),
});

router.post('/groups', async (req, res) => {
  const { name, timezone } = parse(createSchema, req.body);
  const group = await withTx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO groups (name, invite_code, timezone, created_by) VALUES ($1, $2, $3, $4)
       RETURNING id, name, invite_code, timezone`,
      [name, inviteCode(), timezone, req.user.id]
    );
    await db.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')",
      [rows[0].id, req.user.id]
    );
    return rows[0];
  });
  res.status(201).json({ group });
});

const joinSchema = z.object({ inviteCode: z.string().trim().toUpperCase().length(6) });

router.post('/groups/join', async (req, res) => {
  const { inviteCode: code } = parse(joinSchema, req.body);
  const { rows } = await query('SELECT id, name, timezone FROM groups WHERE invite_code = $1', [code]);
  if (!rows[0]) throw new HttpError(404, 'No group with that invite code');
  const { rows: count } = await query('SELECT COUNT(*) AS n FROM group_members WHERE group_id = $1', [rows[0].id]);
  if (count[0].n >= 12) throw new HttpError(400, 'This group is full');
  await query(
    'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [rows[0].id, req.user.id]
  );
  emitGroupUpdate(rows[0].id, 'group');
  res.json({ group: rows[0] });
});

const timezoneSchema = z.object({
  timezone: z.string().max(64).refine(validTimeZone, 'Unknown time zone'),
});

// The group's time zone decides the 9 AM to 11 PM window used for suggestions, so only the owner can change it.
router.patch('/groups/:groupId/timezone', requireGroupMember, async (req, res) => {
  const { timezone } = parse(timezoneSchema, req.body);
  const { rows } = await query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [req.groupId, req.user.id]
  );
  if (rows[0]?.role !== 'owner') throw new HttpError(403, 'Only the group owner can change the time zone');
  await query('UPDATE groups SET timezone = $1 WHERE id = $2', [timezone, req.groupId]);
  emitGroupUpdate(req.groupId, 'group');
  emitGroupUpdate(req.groupId, 'availability'); // suggested times depend on it
  res.json({ ok: true, timezone });
});

router.get('/groups/:groupId', requireGroupMember, async (req, res) => {
  const { rows } = await query('SELECT id, name, invite_code, timezone FROM groups WHERE id = $1', [req.groupId]);
  const { rows: members } = await query(
    `SELECT u.id, u.name, gm.role, false AS calendar_connected
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 ORDER BY gm.joined_at`,
    [req.groupId]
  );
  res.json({ group: rows[0], members });
});

module.exports = router;
