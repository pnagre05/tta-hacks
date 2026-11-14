const express = require('express');
const { z } = require('zod');
const { query, withTx } = require('../db');
const { HttpError, parse, parseId } = require('../http');
const { requireGroupMember, assertMember, groupOf } = require('../auth');
const { emitGroupUpdate } = require('../realtime');
const { createProposedEvent } = require('./events');

const router = express.Router();

// Polls with vote COUNTS only. Who voted for what never leaves the server.
async function listPolls(groupId, userId) {
  const { rows: polls } = await query(
    `SELECT p.id, p.question, p.deadline, p.closed, p.winner_option_id, p.event_start_utc, p.event_end_utc,
            p.created_by, u.name AS created_by_name, p.created_at
       FROM polls p LEFT JOIN users u ON u.id = p.created_by
      WHERE p.group_id = $1 AND (NOT p.closed OR p.created_at > now() - interval '14 days')
      ORDER BY p.closed, p.deadline`,
    [groupId]
  );
  if (!polls.length) return [];
  const ids = polls.map((p) => p.id);
  const { rows: options } = await query(
    `SELECT o.id, o.poll_id, o.label, o.idea_id, COUNT(v.user_id) AS votes
       FROM poll_options o LEFT JOIN votes v ON v.option_id = o.id
      WHERE o.poll_id = ANY($1) GROUP BY o.id ORDER BY o.id`,
    [ids]
  );
  const { rows: mine } = await query('SELECT poll_id, option_id FROM votes WHERE poll_id = ANY($1) AND user_id = $2', [ids, userId]);
  const { rows: voters } = await query('SELECT poll_id, COUNT(*) AS n FROM votes WHERE poll_id = ANY($1) GROUP BY poll_id', [ids]);
  return polls.map((p) => ({
    id: p.id,
    question: p.question,
    deadline: p.deadline,
    closed: p.closed,
    winnerOptionId: p.winner_option_id,
    eventStart: p.event_start_utc,
    eventEnd: p.event_end_utc,
    createdBy: p.created_by,
    createdByName: p.created_by_name,
    totalVotes: voters.find((v) => v.poll_id === p.id)?.n || 0,
    myOptionId: mine.find((m) => m.poll_id === p.id)?.option_id || null,
    options: options.filter((o) => o.poll_id === p.id)
      .map((o) => ({ id: o.id, label: o.label, ideaId: o.idea_id, votes: o.votes })),
  }));
}

const createSchema = z.object({
  question: z.string().trim().min(1).max(120),
  deadline: z.coerce.date(),
  options: z.array(z.union([
    z.object({ ideaId: z.number().int().positive() }),
    z.object({ label: z.string().trim().min(1).max(80) }),
  ])).min(2, 'A poll needs at least 2 options').max(8),
  eventStart: z.coerce.date().nullable().optional(),
  eventEnd: z.coerce.date().nullable().optional(),
});

router.post('/groups/:groupId/polls', requireGroupMember, async (req, res) => {
  const b = parse(createSchema, req.body);
  if (b.deadline <= new Date()) throw new HttpError(400, 'The deadline must be in the future');
  if (b.deadline - Date.now() > 30 * 24 * 60 * 60 * 1000) throw new HttpError(400, 'Deadline is too far away');
  if ((b.eventStart && !b.eventEnd) || (!b.eventStart && b.eventEnd) || (b.eventStart && b.eventEnd <= b.eventStart)) {
    throw new HttpError(400, 'Event time is invalid');
  }

  const pollId = await withTx(async (db) => {
    // Every idea option must belong to THIS group.
    const ideaIds = b.options.filter((o) => o.ideaId).map((o) => o.ideaId);
    const { rows: ideas } = await db.query(
      'SELECT id, title FROM ideas WHERE id = ANY($1) AND group_id = $2', [ideaIds, req.groupId]
    );
    if (ideas.length !== new Set(ideaIds).size) throw new HttpError(400, 'An idea in this poll is not in your group');

    const { rows } = await db.query(
      `INSERT INTO polls (group_id, question, deadline, event_start_utc, event_end_utc, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.groupId, b.question, b.deadline, b.eventStart || null, b.eventEnd || null, req.user.id]
    );
    for (const o of b.options) {
      const label = o.ideaId ? ideas.find((i) => i.id === o.ideaId).title : o.label;
      await db.query('INSERT INTO poll_options (poll_id, label, idea_id) VALUES ($1, $2, $3)', [rows[0].id, label, o.ideaId || null]);
    }
    if (ideaIds.length) {
      await db.query(
        "UPDATE ideas SET status = 'under_consideration' WHERE id = ANY($1) AND status = 'saved'", [ideaIds]
      );
    }
    return rows[0].id;
  });
  emitGroupUpdate(req.groupId, 'poll');
  emitGroupUpdate(req.groupId, 'idea');
  res.status(201).json({ id: pollId });
});

router.get('/groups/:groupId/polls', requireGroupMember, async (req, res) => {
  res.json({ polls: await listPolls(req.groupId, req.user.id) });
});

const voteSchema = z.object({ optionId: z.number().int().positive() });

router.post('/polls/:pollId/vote', async (req, res) => {
  const pollId = parseId(req.params.pollId, 'poll id');
  const groupId = await groupOf('polls', pollId);
  await assertMember(req.user.id, groupId);
  const { optionId } = parse(voteSchema, req.body);

  const { rows } = await query('SELECT closed, deadline FROM polls WHERE id = $1', [pollId]);
  if (rows[0].closed || new Date(rows[0].deadline) <= new Date()) throw new HttpError(400, 'This poll is closed');
  const { rows: opt } = await query('SELECT 1 FROM poll_options WHERE id = $1 AND poll_id = $2', [optionId, pollId]);
  if (!opt[0]) throw new HttpError(400, 'That option is not in this poll');

  // The primary key (poll_id, user_id) makes a second vote impossible; this changes the existing one.
  await query(
    `INSERT INTO votes (poll_id, user_id, option_id) VALUES ($1, $2, $3)
     ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = now()`,
    [pollId, req.user.id, optionId]
  );
  emitGroupUpdate(groupId, 'poll');
  res.json({ ok: true });
});

// Close a poll, pick the winner, and turn it into a proposed event if the poll has a time.
async function closePoll(pollId) {
  const result = await withTx(async (db) => {
    const { rows } = await db.query('SELECT * FROM polls WHERE id = $1 AND NOT closed FOR UPDATE', [pollId]);
    const poll = rows[0];
    if (!poll) return null;
    const { rows: tally } = await db.query(
      `SELECT o.id, o.label, o.idea_id, COUNT(v.user_id) AS votes
         FROM poll_options o LEFT JOIN votes v ON v.option_id = o.id
        WHERE o.poll_id = $1 GROUP BY o.id ORDER BY COUNT(v.user_id) DESC, o.id`,
      [pollId]
    );
    const winner = tally[0] && tally[0].votes > 0 ? tally[0] : null; // ties: earliest option wins
    await db.query('UPDATE polls SET closed = true, winner_option_id = $1 WHERE id = $2', [winner?.id || null, pollId]);

    // Losing ideas go back to Saved; the winner moves on.
    const loserIdeaIds = tally.filter((o) => o.idea_id && o.id !== winner?.id).map((o) => o.idea_id);
    if (loserIdeaIds.length) {
      await db.query("UPDATE ideas SET status = 'saved' WHERE id = ANY($1) AND status = 'under_consideration'", [loserIdeaIds]);
    }
    let eventId = null;
    if (winner && poll.event_start_utc && poll.event_end_utc) {
      eventId = await createProposedEvent(db, {
        groupId: poll.group_id, title: winner.label, start: poll.event_start_utc, end: poll.event_end_utc,
        ideaId: winner.idea_id, pollId, createdBy: poll.created_by,
      });
    }
    if (winner?.idea_id) {
      await db.query("UPDATE ideas SET status = 'planned' WHERE id = $1 AND status <> 'completed'", [winner.idea_id]);
    }
    return { groupId: poll.group_id, eventId };
  });
  if (result) {
    emitGroupUpdate(result.groupId, 'poll');
    emitGroupUpdate(result.groupId, 'idea');
    if (result.eventId) emitGroupUpdate(result.groupId, 'event');
  }
  return result;
}

// Only the poll's creator can close it early. Everyone else waits for the deadline.
router.post('/polls/:pollId/close', async (req, res) => {
  const pollId = parseId(req.params.pollId, 'poll id');
  const groupId = await groupOf('polls', pollId);
  await assertMember(req.user.id, groupId);
  const { rows } = await query('SELECT created_by, closed FROM polls WHERE id = $1', [pollId]);
  if (rows[0].created_by !== req.user.id) throw new HttpError(403, 'Only the poll creator can close it early');
  if (rows[0].closed) throw new HttpError(400, 'This poll is already closed');
  const result = await closePoll(pollId);
  res.json({ ok: true, eventId: result?.eventId || null });
});

// Runs every 30 seconds: close polls whose deadline has passed.
function startPollSweeper() {
  const sweep = async () => {
    try {
      const { rows } = await query('SELECT id FROM polls WHERE NOT closed AND deadline <= now()');
      for (const r of rows) await closePoll(r.id);
    } catch (err) {
      console.error('Poll sweeper error:', err.message);
    }
  };
  sweep();
  return setInterval(sweep, 30_000);
}

module.exports = { router, listPolls, closePoll, startPollSweeper };
