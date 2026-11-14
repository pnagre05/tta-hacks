const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { parse, parseId } = require('../http');
const { requireGroupMember, assertMember, groupOf } = require('../auth');
const { emitGroupUpdate } = require('../realtime');

const router = express.Router();

const CATEGORIES = ['restaurants', 'outdoor', 'entertainment', 'at_home', 'travel', 'events', 'other'];
const STATUSES = ['saved', 'under_consideration', 'planned', 'completed', 'archived'];

async function listIdeas(groupId, userId) {
  const { rows } = await query(
    `SELECT i.id, i.title, i.description, i.category, i.location, i.budget_cents, i.status, i.created_at,
            u.name AS added_by_name,
            COUNT(ii.user_id) AS interest_count,
            BOOL_OR(ii.user_id = $2) AS i_am_interested
       FROM ideas i
       LEFT JOIN users u ON u.id = i.added_by
       LEFT JOIN idea_interests ii ON ii.idea_id = i.id
      WHERE i.group_id = $1 AND i.status <> 'archived'
      GROUP BY i.id, u.name
      ORDER BY COUNT(ii.user_id) DESC, i.created_at DESC`,
    [groupId, userId]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    location: r.location,
    budgetCents: r.budget_cents,
    status: r.status,
    addedByName: r.added_by_name,
    createdAt: r.created_at,
    interestCount: r.interest_count,
    iAmInterested: Boolean(r.i_am_interested),
  }));
}

router.get('/groups/:groupId/ideas', requireGroupMember, async (req, res) => {
  res.json({ ideas: await listIdeas(req.groupId, req.user.id) });
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default(''),
  category: z.enum(CATEGORIES),
  location: z.string().trim().max(120).optional().default(''),
  budgetCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

router.post('/groups/:groupId/ideas', requireGroupMember, async (req, res) => {
  const b = parse(createSchema, req.body);
  const { rows } = await query(
    `INSERT INTO ideas (group_id, title, description, category, location, budget_cents, added_by)
     VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7) RETURNING id`,
    [req.groupId, b.title, b.description, b.category, b.location, b.budgetCents ?? null, req.user.id]
  );
  // The person who adds an idea is interested in it.
  await query('INSERT INTO idea_interests (idea_id, user_id) VALUES ($1, $2)', [rows[0].id, req.user.id]);
  emitGroupUpdate(req.groupId, 'idea');
  res.status(201).json({ id: rows[0].id });
});

// Toggle "I'm interested".
router.post('/ideas/:ideaId/interest', async (req, res) => {
  const ideaId = parseId(req.params.ideaId, 'idea id');
  const groupId = await groupOf('ideas', ideaId);
  await assertMember(req.user.id, groupId);
  const { rowCount } = await query('DELETE FROM idea_interests WHERE idea_id = $1 AND user_id = $2', [ideaId, req.user.id]);
  if (rowCount === 0) {
    await query('INSERT INTO idea_interests (idea_id, user_id) VALUES ($1, $2)', [ideaId, req.user.id]);
  }
  emitGroupUpdate(groupId, 'idea');
  res.json({ interested: rowCount === 0 });
});

const statusSchema = z.object({ status: z.enum(STATUSES) });

router.patch('/ideas/:ideaId/status', async (req, res) => {
  const ideaId = parseId(req.params.ideaId, 'idea id');
  const groupId = await groupOf('ideas', ideaId);
  await assertMember(req.user.id, groupId);
  const { status } = parse(statusSchema, req.body);
  await query('UPDATE ideas SET status = $1 WHERE id = $2', [status, ideaId]);
  emitGroupUpdate(groupId, 'idea');
  res.json({ ok: true });
});

module.exports = { router, listIdeas, CATEGORIES };
