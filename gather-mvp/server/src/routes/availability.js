const express = require('express');
const { z } = require('zod');
const { query, withTx } = require('../db');
const { HttpError, parse } = require('../http');
const { requireGroupMember } = require('../auth');
const { emitToUserGroups } = require('../realtime');
const { rankSlots } = require('../lib/slots');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

async function membersOf(groupId) {
  const { rows } = await query(
    `SELECT u.id, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 ORDER BY gm.joined_at`,
    [groupId]
  );
  return rows;
}

async function busyFor(userIds, from, to) {
  const { rows } = await query(
    `SELECT user_id, start_utc, end_utc, source FROM availability
      WHERE user_id = ANY($1) AND end_utc > $2 AND start_utc < $3 ORDER BY start_utc`,
    [userIds, from, to]
  );
  return rows;
}

const MAX_RANGE_DAYS = 62;

// Busy blocks (start/end/source only) for every member.
// Use ?from=<ISO>&to=<ISO> for an explicit range (up to 62 days), or ?days=N for "the next N days".
router.get('/groups/:groupId/availability', requireGroupMember, async (req, res) => {
  let from;
  let to;
  if (req.query.from !== undefined || req.query.to !== undefined) {
    from = new Date(String(req.query.from));
    to = new Date(String(req.query.to));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new HttpError(400, 'from and to must be valid dates, with to after from');
    }
    if (to - from > MAX_RANGE_DAYS * DAY_MS) throw new HttpError(400, `Range is too long (max ${MAX_RANGE_DAYS} days)`);
  } else {
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 31);
    from = new Date(Date.now() - DAY_MS); // include today
    to = new Date(Date.now() + days * DAY_MS);
  }
  const members = await membersOf(req.groupId);
  const busy = await busyFor(members.map((m) => m.id), from, to);
  res.json({
    members,
    busy: busy.map((b) => ({ userId: b.user_id, start: b.start_utc, end: b.end_utc, source: b.source })),
  });
});

const manualSchema = z.object({
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  busy: z.array(z.object({ start: z.coerce.date(), end: z.coerce.date() })).max(500),
}).refine((v) => v.windowEnd > v.windowStart, 'windowEnd must be after windowStart')
  .refine((v) => v.windowEnd - v.windowStart <= 31 * DAY_MS, 'Window is too long');

// Replace MY manual busy blocks inside a window (what the availability grid saves).
router.put('/groups/:groupId/availability/me', requireGroupMember, async (req, res) => {
  const { windowStart, windowEnd, busy } = parse(manualSchema, req.body);
  for (const b of busy) {
    if (!(b.end > b.start)) throw new HttpError(400, 'Each busy block must end after it starts');
    if (b.start < windowStart || b.end > windowEnd) throw new HttpError(400, 'Busy block outside the window');
  }
  await withTx(async (db) => {
    await db.query(
      `DELETE FROM availability WHERE user_id = $1 AND source = 'manual'
         AND start_utc >= $2 AND end_utc <= $3`,
      [req.user.id, windowStart, windowEnd]
    );
    for (const b of busy) {
      await db.query(
        "INSERT INTO availability (user_id, start_utc, end_utc, source) VALUES ($1, $2, $3, 'manual')",
        [req.user.id, b.start, b.end]
      );
    }
  });
  await emitToUserGroups(req.user.id, 'availability');
  res.json({ ok: true, saved: busy.length });
});

// Ranked suggestions: most people free, then longest, then soonest.
router.get('/groups/:groupId/slots', requireGroupMember, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 31);
  const minMinutes = Math.min(Math.max(Number(req.query.minMinutes) || 120, 30), 12 * 60);
  const { rows: g } = await query('SELECT timezone FROM groups WHERE id = $1', [req.groupId]);
  const members = await membersOf(req.groupId);
  const windowStart = new Date();
  const windowEnd = new Date(Date.now() + days * DAY_MS);
  const busy = (await busyFor(members.map((m) => m.id), windowStart, windowEnd))
    .map((b) => ({ userId: b.user_id, start: b.start_utc, end: b.end_utc }));

  const names = new Map(members.map((m) => [m.id, m.name]));
  const slots = rankSlots({ members, busy, windowStart, windowEnd, timeZone: g[0].timezone, minMinutes })
    .map((s) => ({
      start: s.start,
      end: s.end,
      freeCount: s.freeCount,
      total: s.total,
      freeMembers: s.freeMemberIds.map((id) => names.get(id)),
      busyMembers: members.filter((m) => !s.freeMemberIds.includes(m.id)).map((m) => m.name),
    }));
  res.json({ timezone: g[0].timezone, slots });
});

module.exports = router;
