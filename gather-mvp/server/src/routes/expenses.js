const express = require('express');
const { z } = require('zod');
const { query, withTx } = require('../db');
const { HttpError, parse } = require('../http');
const { requireGroupMember } = require('../auth');
const { emitGroupUpdate } = require('../realtime');
const { equalSplit, netBalances, settle } = require('../lib/settle');

const router = express.Router();

async function memberIds(groupId) {
  const { rows } = await query(
    `SELECT u.id, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1 ORDER BY gm.joined_at`,
    [groupId]
  );
  return rows;
}

async function listExpenses(groupId) {
  const { rows: expenses } = await query(
    `SELECT e.id, e.description, e.amount_cents, e.paid_by, u.name AS paid_by_name, e.event_id,
            ev.title AS event_title, e.created_at
       FROM expenses e JOIN users u ON u.id = e.paid_by
       LEFT JOIN events ev ON ev.id = e.event_id
      WHERE e.group_id = $1 ORDER BY e.created_at DESC`,
    [groupId]
  );
  const { rows: splits } = expenses.length
    ? await query(
      `SELECT s.expense_id, s.user_id, s.share_cents, u.name FROM expense_splits s
         JOIN users u ON u.id = s.user_id WHERE s.expense_id = ANY($1)`,
      [expenses.map((e) => e.id)]
    )
    : { rows: [] };
  return expenses.map((e) => ({
    id: e.id,
    description: e.description,
    amountCents: e.amount_cents,
    paidBy: e.paid_by,
    paidByName: e.paid_by_name,
    eventId: e.event_id,
    eventTitle: e.event_title,
    createdAt: e.created_at,
    splits: splits.filter((s) => s.expense_id === e.id)
      .map((s) => ({ userId: s.user_id, name: s.name, shareCents: s.share_cents })),
  }));
}

async function computeBalances(groupId, userId) {
  const members = await memberIds(groupId);
  const expenses = await listExpenses(groupId);
  const { rows: settlementRows } = await query(
    `SELECT s.id, s.from_user, s.to_user, s.amount_cents, s.created_at, f.name AS from_name, t.name AS to_name
       FROM settlements s JOIN users f ON f.id = s.from_user JOIN users t ON t.id = s.to_user
      WHERE s.group_id = $1 ORDER BY s.created_at DESC`,
    [groupId]
  );
  const settlements = settlementRows.map((s) => ({
    id: s.id, fromUser: s.from_user, toUser: s.to_user, amountCents: s.amount_cents,
    fromName: s.from_name, toName: s.to_name, createdAt: s.created_at,
  }));
  const net = netBalances(members.map((m) => m.id), expenses, settlements);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const payments = settle(net).map((p) => ({ ...p, fromName: names.get(p.fromUser), toName: names.get(p.toUser) }));
  return {
    members: members.map((m) => ({ id: m.id, name: m.name, netCents: net.get(m.id) || 0 })),
    myNetCents: net.get(userId) || 0,
    payments,
    settlements,
    totalSpentCents: expenses.reduce((sum, e) => sum + e.amountCents, 0),
    mySpentCents: expenses.filter((e) => e.paidBy === userId).reduce((sum, e) => sum + e.amountCents, 0),
  };
}

router.get('/groups/:groupId/expenses', requireGroupMember, async (req, res) => {
  res.json({ expenses: await listExpenses(req.groupId) });
});

router.get('/groups/:groupId/balances', requireGroupMember, async (req, res) => {
  res.json(await computeBalances(req.groupId, req.user.id));
});

const expenseSchema = z.object({
  description: z.string().trim().min(1).max(100),
  amountCents: z.number().int().positive().max(10_000_000, 'Amount is too large'),
  paidBy: z.number().int().positive(),
  participantIds: z.array(z.number().int().positive()).min(1, 'Pick at least one person').max(20),
  eventId: z.number().int().positive().nullable().optional(),
});

router.post('/groups/:groupId/expenses', requireGroupMember, async (req, res) => {
  const b = parse(expenseSchema, req.body);
  const ids = new Set((await memberIds(req.groupId)).map((m) => m.id));
  const participants = [...new Set(b.participantIds)];
  // Server-side checks: payer and everyone splitting must be in this group.
  if (!ids.has(b.paidBy) || !participants.every((p) => ids.has(p))) {
    throw new HttpError(400, 'Everyone on an expense must be in this group');
  }
  if (b.eventId) {
    const { rows } = await query('SELECT 1 FROM events WHERE id = $1 AND group_id = $2', [b.eventId, req.groupId]);
    if (!rows[0]) throw new HttpError(400, 'That event is not in this group');
  }
  // The server computes the split; the client never sends share amounts.
  const splits = equalSplit(b.amountCents, participants);

  const id = await withTx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO expenses (group_id, description, amount_cents, paid_by, event_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.groupId, b.description, b.amountCents, b.paidBy, b.eventId || null, req.user.id]
    );
    for (const s of splits) {
      await db.query('INSERT INTO expense_splits (expense_id, user_id, share_cents) VALUES ($1, $2, $3)', [rows[0].id, s.userId, s.shareCents]);
    }
    return rows[0].id;
  });
  emitGroupUpdate(req.groupId, 'expense');
  res.status(201).json({ id });
});

const settlementSchema = z.object({
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  amountCents: z.number().int().positive().max(10_000_000),
}).refine((v) => v.fromUserId !== v.toUserId, 'Pick two different people');

// Record "X paid Y". Only the payer or the person paid can record it.
router.post('/groups/:groupId/settlements', requireGroupMember, async (req, res) => {
  const b = parse(settlementSchema, req.body);
  if (req.user.id !== b.fromUserId && req.user.id !== b.toUserId) {
    throw new HttpError(403, 'You can only record payments you made or received');
  }
  const ids = new Set((await memberIds(req.groupId)).map((m) => m.id));
  if (!ids.has(b.fromUserId) || !ids.has(b.toUserId)) throw new HttpError(400, 'Both people must be in this group');
  await query(
    `INSERT INTO settlements (group_id, from_user, to_user, amount_cents, recorded_by) VALUES ($1, $2, $3, $4, $5)`,
    [req.groupId, b.fromUserId, b.toUserId, b.amountCents, req.user.id]
  );
  emitGroupUpdate(req.groupId, 'expense');
  res.status(201).json({ ok: true });
});

module.exports = { router, computeBalances };
