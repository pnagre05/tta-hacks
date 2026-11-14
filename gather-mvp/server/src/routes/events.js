const express = require('express');
const { z } = require('zod');
const { query, withTx } = require('../db');
const { HttpError, parse, parseId } = require('../http');
const { requireGroupMember, assertMember, groupOf } = require('../auth');
const { emitGroupUpdate } = require('../realtime');

const router = express.Router();

// Events with each member's response, plus who hasn't answered yet.
async function listEvents(groupId, userId, { daysBack = 2 } = {}) {
  const { rows: events } = await query(
    `SELECT e.id, e.title, e.start_utc, e.end_utc, e.status, e.idea_id, e.poll_id, e.created_by,
            u.name AS created_by_name
       FROM events e LEFT JOIN users u ON u.id = e.created_by
      WHERE e.group_id = $1 AND e.status <> 'cancelled' AND e.end_utc > now() - ($2 || ' days')::interval
      ORDER BY e.start_utc`,
    [groupId, String(daysBack)]
  );
  if (!events.length) return [];
  const { rows: responses } = await query(
    `SELECT r.event_id, r.user_id, r.response, u.name FROM event_responses r
       JOIN users u ON u.id = r.user_id WHERE r.event_id = ANY($1)`,
    [events.map((e) => e.id)]
  );
  const { rows: members } = await query(
    `SELECT u.id, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1`,
    [groupId]
  );
  return events.map((e) => {
    const rs = responses.filter((r) => r.event_id === e.id);
    const answered = new Set(rs.map((r) => r.user_id));
    return {
      id: e.id,
      title: e.title,
      start: e.start_utc,
      end: e.end_utc,
      status: e.status,
      ideaId: e.idea_id,
      pollId: e.poll_id,
      createdBy: e.created_by,
      createdByName: e.created_by_name,
      counts: {
        yes: rs.filter((r) => r.response === 'yes').length,
        no: rs.filter((r) => r.response === 'no').length,
        maybe: rs.filter((r) => r.response === 'maybe').length,
      },
      responses: rs.map((r) => ({ userId: r.user_id, name: r.name, response: r.response })),
      myResponse: rs.find((r) => r.user_id === userId)?.response || null,
      notResponded: members.filter((m) => !answered.has(m.id)).map((m) => m.name),
    };
  });
}

// Used by polls when a winner becomes a proposed event.
async function createProposedEvent(db, { groupId, title, start, end, ideaId = null, pollId = null, createdBy }) {
  const { rows } = await db.query(
    `INSERT INTO events (group_id, title, start_utc, end_utc, status, idea_id, poll_id, created_by)
     VALUES ($1, $2, $3, $4, 'proposed', $5, $6, $7) RETURNING id`,
    [groupId, title, start, end, ideaId, pollId, createdBy]
  );
  if (createdBy) {
    await db.query(
      "INSERT INTO event_responses (event_id, user_id, response) VALUES ($1, $2, 'yes') ON CONFLICT DO NOTHING",
      [rows[0].id, createdBy]
    );
  }
  return rows[0].id;
}

router.get('/groups/:groupId/events', requireGroupMember, async (req, res) => {
  res.json({ events: await listEvents(req.groupId, req.user.id) });
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(100),
  start: z.coerce.date(),
  end: z.coerce.date(),
  ideaId: z.number().int().positive().nullable().optional(),
}).refine((v) => v.end > v.start, 'End must be after start');

router.post('/groups/:groupId/events', requireGroupMember, async (req, res) => {
  const body = parse(createSchema, req.body);
  if (body.ideaId) {
    const { rows } = await query('SELECT 1 FROM ideas WHERE id = $1 AND group_id = $2', [body.ideaId, req.groupId]);
    if (!rows[0]) throw new HttpError(400, 'That idea is not in this group');
  }
  const id = await withTx((db) => createProposedEvent(db, {
    groupId: req.groupId, title: body.title, start: body.start, end: body.end,
    ideaId: body.ideaId || null, createdBy: req.user.id,
  }));
  emitGroupUpdate(req.groupId, 'event');
  res.status(201).json({ id });
});

const respondSchema = z.object({ response: z.enum(['yes', 'no', 'maybe']) });

router.post('/events/:eventId/respond', async (req, res) => {
  const eventId = parseId(req.params.eventId, 'event id');
  const groupId = await groupOf('events', eventId);
  await assertMember(req.user.id, groupId);
  const { response } = parse(respondSchema, req.body);
  await query(
    `INSERT INTO event_responses (event_id, user_id, response) VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO UPDATE SET response = EXCLUDED.response`,
    [eventId, req.user.id, response]
  );
  emitGroupUpdate(groupId, 'event');
  res.json({ ok: true });
});

router.post('/events/:eventId/confirm', async (req, res) => {
  const eventId = parseId(req.params.eventId, 'event id');
  const groupId = await groupOf('events', eventId);
  await assertMember(req.user.id, groupId);
  const { rows } = await query(
    "UPDATE events SET status = 'confirmed' WHERE id = $1 AND status = 'proposed' RETURNING idea_id", [eventId]
  );
  if (!rows[0]) throw new HttpError(400, 'Only proposed events can be confirmed');
  if (rows[0].idea_id) {
    await query("UPDATE ideas SET status = 'planned' WHERE id = $1 AND status <> 'completed'", [rows[0].idea_id]);
    emitGroupUpdate(groupId, 'idea');
  }
  emitGroupUpdate(groupId, 'event');
  res.json({ ok: true });
});

router.post('/events/:eventId/cancel', async (req, res) => {
  const eventId = parseId(req.params.eventId, 'event id');
  const groupId = await groupOf('events', eventId);
  await assertMember(req.user.id, groupId);
  await query("UPDATE events SET status = 'cancelled' WHERE id = $1", [eventId]);
  emitGroupUpdate(groupId, 'event');
  res.json({ ok: true });
});

module.exports = { router, listEvents, createProposedEvent };
