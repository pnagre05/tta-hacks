// Demo data: 6 members, ideas, busy times (everyone free Saturday afternoon), a poll, expenses.
// Run with: npm run seed   (log in as alex@gather.test / password123, invite code DEMO42)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query, migrate } = require('./db');
const { zonedToUtc, localParts } = require('./lib/time');
const { equalSplit } = require('./lib/settle');

const TZ = 'America/Chicago';
const PASSWORD = 'password123';
const PEOPLE = ['Alex', 'Sam', 'Priya', 'Jordan', 'Maya', 'Chris'];

const IDEAS = [
  ['Painting Night', 'at_home', 'Canvas + snacks at someone\'s place', 1500],
  ['Italian Restaurant', 'restaurants', 'That new place downtown', 3500],
  ['Bowling', 'entertainment', 'Cosmic bowling', 2000],
  ['Movie Marathon', 'at_home', 'Lord of the Rings extended', 500],
  ['Weekend Road Trip', 'travel', 'Hill Country, 2 nights', 15000],
  ['Pottery Class', 'events', 'Beginner wheel class', 4500],
  ['Picnic at the Park', 'outdoor', 'Bring a speaker and frisbee', 1000],
  ['Escape Room', 'entertainment', 'Try the hardest room', 3000],
];
// How many people (from the start of PEOPLE) are interested in each idea.
const INTEREST = [5, 4, 3, 6, 4, 2, 3, 4];

function addDays(date, n) {
  return new Date(date.getTime() + n * 24 * 60 * 60 * 1000);
}

async function main() {
  await migrate();
  await query("DELETE FROM groups WHERE invite_code = 'DEMO42'");
  await query("DELETE FROM users WHERE email LIKE '%@gather.test'");

  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = [];
  for (const name of PEOPLE) {
    const { rows } = await query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name',
      [name, `${name.toLowerCase()}@gather.test`, hash]
    );
    users.push(rows[0]);
  }
  const { rows: g } = await query(
    "INSERT INTO groups (name, invite_code, timezone, created_by) VALUES ('Weekend Crew', 'DEMO42', $1, $2) RETURNING id",
    [TZ, users[0].id]
  );
  const groupId = g[0].id;
  for (const [i, u] of users.entries()) {
    await query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)', [groupId, u.id, i === 0 ? 'owner' : 'member']);
  }

  const ideaIds = [];
  for (const [i, [title, category, description, budget]] of IDEAS.entries()) {
    const { rows } = await query(
      `INSERT INTO ideas (group_id, title, description, category, budget_cents, added_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [groupId, title, description, category, budget, users[i % users.length].id]
    );
    ideaIds.push(rows[0].id);
    for (const u of users.slice(0, INTEREST[i])) {
      await query('INSERT INTO idea_interests (idea_id, user_id) VALUES ($1, $2)', [rows[0].id, u.id]);
    }
  }

  // Busy times for the next 14 days. Everyone is busy weekday mornings/afternoons (class/work)
  // and some evenings, but Saturday 2-5 PM is left free for all six.
  const today = localParts(new Date(), TZ);
  const base = zonedToUtc(today.year, today.month, today.day, 0, 0, TZ);
  for (let d = 0; d < 14; d++) {
    // Noon of day d, so DST changes can't push us into the wrong date.
    const day = localParts(new Date(addDays(base, d).getTime() + 12 * 3600 * 1000), TZ);
    const block = async (userId, startH, endH) => {
      const s = zonedToUtc(day.year, day.month, day.day, startH, 0, TZ);
      const e = zonedToUtc(day.year, day.month, day.day, endH, 0, TZ);
      await query("INSERT INTO availability (user_id, start_utc, end_utc, source) VALUES ($1, $2, $3, 'manual')", [userId, s, e]);
    };
    for (const [i, u] of users.entries()) {
      if (day.weekday === 'Sat') {
        if (i % 2 === 0) await block(u.id, 9, 13);       // mornings busy for some
        if (i === 1 || i === 4) await block(u.id, 18, 22); // two busy Saturday night
      } else if (day.weekday === 'Sun') {
        if (i < 4) await block(u.id, 10, 14);
        if (i === 5) await block(u.id, 15, 20);
      } else {
        await block(u.id, 9, 17);                            // weekdays: class/work
        if ((d + i) % 3 === 0) await block(u.id, 18, 21);    // some evenings
      }
    }
  }

  // An open poll (closes in 2 hours) built from three ideas.
  const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const { rows: p } = await query(
    `INSERT INTO polls (group_id, question, deadline, created_by) VALUES ($1, 'What should we do Saturday?', $2, $3) RETURNING id`,
    [groupId, deadline, users[0].id]
  );
  const optionIds = [];
  for (const idx of [0, 2, 3]) {
    const { rows } = await query('INSERT INTO poll_options (poll_id, label, idea_id) VALUES ($1, $2, $3) RETURNING id', [p[0].id, IDEAS[idx][0], ideaIds[idx]]);
    optionIds.push(rows[0].id);
    await query("UPDATE ideas SET status = 'under_consideration' WHERE id = $1", [ideaIds[idx]]);
  }
  await query('INSERT INTO votes (poll_id, user_id, option_id) VALUES ($1, $2, $3), ($1, $4, $5)', [p[0].id, users[1].id, optionIds[1], users[2].id, optionIds[2]]);

  // Two past expenses.
  const expenses = [
    ['Dinner at Pho Place', 12000, 0, [0, 1, 2, 3]],
    ['Parking', 4000, 1, [0, 1, 2, 3]],
    ['Snacks for movie night', 2000, 2, [0, 1, 2, 3, 4, 5]],
  ];
  for (const [desc, amount, payer, who] of expenses) {
    const { rows } = await query(
      'INSERT INTO expenses (group_id, description, amount_cents, paid_by, created_by) VALUES ($1, $2, $3, $4, $4) RETURNING id',
      [groupId, desc, amount, users[payer].id]
    );
    for (const s of equalSplit(amount, who.map((i) => users[i].id))) {
      await query('INSERT INTO expense_splits (expense_id, user_id, share_cents) VALUES ($1, $2, $3)', [rows[0].id, s.userId, s.shareCents]);
    }
  }

  console.log('Seeded "Weekend Crew" (invite code DEMO42).');
  console.log(`Log in as any of: ${PEOPLE.map((n) => `${n.toLowerCase()}@gather.test`).join(', ')}`);
  console.log(`Password for all: ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
