// GATHER AI. The server gathers ONLY this group's data (for the logged-in member),
// hands it to the model, and tells it to answer from that data alone.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { query } = require('../db');
const { parse } = require('../http');
const { requireGroupMember } = require('../auth');
const { listEvents } = require('./events');
const { listPolls } = require('./polls');
const { listIdeas } = require('./ideas');
const { computeBalances } = require('./expenses');
const { formatRange, formatDateTime } = require('../lib/time');

const router = express.Router();

const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Slow down: 10 questions per minute.' } });

const dollars = (cents) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

// Everything the assistant may know. Group and user come from the session, never from the question.
async function buildSnapshot(groupId, user) {
  const { rows: g } = await query('SELECT name, timezone FROM groups WHERE id = $1', [groupId]);
  const tz = g[0].timezone;
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const events = (await listEvents(groupId, user.id, { daysBack: 0 }))
    .filter((e) => new Date(e.start) < in14)
    .map((e) => ({
      title: e.title,
      when: formatRange(new Date(e.start), new Date(e.end), tz),
      status: e.status, // "proposed" or "confirmed"
      yes: e.counts.yes, no: e.counts.no, maybe: e.counts.maybe,
      myResponse: e.myResponse,
      notResponded: e.notResponded,
    }));
  const polls = (await listPolls(groupId, user.id)).map((p) => ({
    question: p.question,
    status: p.closed ? 'closed' : 'open',
    deadline: formatDateTime(new Date(p.deadline), tz),
    options: p.options.map((o) => ({ label: o.label, votes: o.votes })),
    winner: p.closed ? p.options.find((o) => o.id === p.winnerOptionId)?.label || 'no votes' : null,
    iVoted: Boolean(p.myOptionId),
  }));
  const ideas = (await listIdeas(groupId, user.id)).slice(0, 8).map((i) => ({
    title: i.title, category: i.category, interested: i.interestCount, status: i.status,
    budgetPerPerson: i.budgetCents != null ? dollars(i.budgetCents) : null,
  }));
  const b = await computeBalances(groupId, user.id);
  const money = {
    myNet: b.myNetCents === 0 ? 'settled up' : b.myNetCents > 0 ? `owed ${dollars(b.myNetCents)}` : `owes ${dollars(b.myNetCents)}`,
    iPaidInTotal: dollars(b.mySpentCents),
    groupTotalSpent: dollars(b.totalSpentCents),
    suggestedPayments: b.payments.map((p) => `${p.fromName} pays ${p.toName} ${dollars(p.amountCents)}`),
  };
  return {
    group: g[0].name,
    me: user.name,
    now: formatDateTime(now, tz),
    timezone: tz,
    events, polls, ideas, money,
  };
}

const SYSTEM_PROMPT = `You are GATHER AI, the assistant for a private friend group.
Answer ONLY from the JSON data you are given. Never invent events, times, poll results, ideas, or money amounts.
If the answer is not in the data, say you don't see it.
Always say whether a plan is "proposed" or "confirmed". "me" in the data is the person asking; address them as "you".
Be brief and friendly: 1-5 short sentences or a short list. Use the times exactly as written in the data.`;

async function askModel(question, snapshot) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-haiku-5-5',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Group data:\n${JSON.stringify(snapshot)}\n\nQuestion: ${question}` }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`LLM API returned ${res.status}`);
  const data = await res.json();
  return data.content?.map((c) => c.text || '').join('').trim();
}

// Works with no API key at all, so the demo never depends on the network.
function offlineAnswer(question, s) {
  const q = question.toLowerCase();
  const lines = [];
  const confirmed = s.events.filter((e) => e.status === 'confirmed');
  const proposed = s.events.filter((e) => e.status === 'proposed');
  const openPolls = s.polls.filter((p) => p.status === 'open');
  const wants = (...words) => words.some((w) => q.includes(w));
  const all = wants('summar', 'week', 'brief', 'everything', 'update') || !wants(
    'owe', 'money', 'balance', 'spent', 'pay', 'poll', 'vote', 'decide', 'idea', 'want to', 'suggest', 'plan', 'event', 'free', 'weekend', 'saturday', 'sunday', 'friday',
  );

  if (all || wants('plan', 'event', 'weekend', 'saturday', 'sunday', 'friday', 'free', 'doing')) {
    lines.push(confirmed.length
      ? `Confirmed: ${confirmed.map((e) => `${e.title} (${e.when})`).join('; ')}.`
      : 'Nothing is confirmed yet.');
    if (proposed.length) {
      lines.push(`Proposed: ${proposed.map((e) => `${e.title} (${e.when}, ${e.yes} yes${e.notResponded.length ? `; waiting on ${e.notResponded.join(', ')}` : ''})`).join('; ')}.`);
    }
  }
  if (all || wants('poll', 'vote', 'decide')) {
    lines.push(openPolls.length
      ? `Open polls: ${openPolls.map((p) => `"${p.question}" closes ${p.deadline}${p.iVoted ? '' : ' (you haven\'t voted)'}`).join('; ')}.`
      : 'No polls are open.');
    const closed = s.polls.filter((p) => p.status === 'closed').slice(0, 2);
    if (closed.length && !all) lines.push(`Recent results: ${closed.map((p) => `"${p.question}" → ${p.winner}`).join('; ')}.`);
  }
  if (all || wants('idea', 'want to', 'suggest')) {
    const top = s.ideas.filter((i) => i.status !== 'completed').slice(0, 3);
    if (top.length) lines.push(`Most wanted ideas: ${top.map((i) => `${i.title} (${i.interested} interested)`).join(', ')}.`);
  }
  if (all || wants('owe', 'money', 'balance', 'spent', 'pay')) {
    lines.push(`Money: you're ${s.money.myNet}; you've paid ${s.money.iPaidInTotal} for the group.`);
    const mine = s.money.suggestedPayments.filter((p) => p.includes(s.me));
    if (mine.length) lines.push(`To settle: ${mine.join('; ')}.`);
  }
  return lines.join('\n');
}

const askSchema = z.object({ question: z.string().trim().min(1).max(500) });

router.post('/groups/:groupId/ai/ask', aiLimiter, requireGroupMember, async (req, res) => {
  const { question } = parse(askSchema, req.body);
  const snapshot = await buildSnapshot(req.groupId, req.user);
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const answer = await askModel(question, snapshot);
      if (answer) return res.json({ answer, source: 'llm' });
    } catch (err) {
      console.warn('LLM call failed, using offline answer:', err.message);
    }
  }
  res.json({ answer: offlineAnswer(question, snapshot), source: 'offline' });
});

module.exports = { router, buildSnapshot, offlineAnswer };
