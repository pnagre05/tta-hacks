// API tests against an in-memory database. They seed the demo data, which DELETES the demo group and
// @gather.test users, so they refuse to run if the app is pointed at a real database.
process.env.GATHER_DB = 'memory';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
delete process.env.SUPABASE_DB_URL;
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db'); // must load first, before dotenv runs in index.js
if (db.useRemote) throw new Error('Refusing to run API tests against a real database');
const { seed } = require('../src/seed');
const { app } = require('../src/index');

const DAY = 24 * 60 * 60 * 1000;
let server;
let base;
let cookie;
let groupId;

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json, headers: res.headers };
}

test.before(async () => {
  await db.migrate();
  await seed();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call('/api/auth/login', { method: 'POST', body: { email: 'alex@gather.test', password: 'password123' } });
  assert.strictEqual(login.status, 200);
  cookie = login.headers.getSetCookie()[0].split(';')[0];
  const me = await call('/api/auth/me');
  groupId = me.body.groups[0].id;
});

test.after(async () => {
  server?.close();
  await db.close();
});

test('availability: explicit from/to range works, and bad ranges are rejected', async () => {
  const now = Date.now();
  const ok = await call(`/api/groups/${groupId}/availability?from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now + 7 * DAY).toISOString())}`);
  assert.strictEqual(ok.status, 200);
  assert.ok(Array.isArray(ok.body.members) && Array.isArray(ok.body.busy));
  assert.ok(ok.body.busy.length > 0, 'seed data has busy blocks in the next week');

  const garbage = await call(`/api/groups/${groupId}/availability?from=nope&to=nada`);
  assert.strictEqual(garbage.status, 400);

  const backwards = await call(`/api/groups/${groupId}/availability?from=${new Date(now + DAY).toISOString()}&to=${new Date(now).toISOString()}`);
  assert.strictEqual(backwards.status, 400);

  const tooLong = await call(`/api/groups/${groupId}/availability?from=${new Date(now).toISOString()}&to=${new Date(now + 70 * DAY).toISOString()}`);
  assert.strictEqual(tooLong.status, 400);

  const legacy = await call(`/api/groups/${groupId}/availability?days=8`);
  assert.strictEqual(legacy.status, 200, 'the old ?days= form still works');
});

test('availability: saving a block in a later week shows up only in that range', async () => {
  const start = new Date(Date.now() + 10 * DAY);
  start.setHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const put = await call(`/api/groups/${groupId}/availability/me`, {
    method: 'PUT',
    body: {
      windowStart: new Date(start.getTime() - 60 * 60 * 1000).toISOString(),
      windowEnd: new Date(end.getTime() + 60 * 60 * 1000).toISOString(),
      busy: [{ start: start.toISOString(), end: end.toISOString() }],
    },
  });
  assert.strictEqual(put.status, 200);

  const later = await call(`/api/groups/${groupId}/availability?from=${new Date(start.getTime() - DAY).toISOString()}&to=${new Date(end.getTime() + DAY).toISOString()}`);
  assert.ok(later.body.busy.some((b) => b.userId === 1 && new Date(b.start).getTime() === start.getTime()));

  const earlier = await call(`/api/groups/${groupId}/availability?from=${new Date().toISOString()}&to=${new Date(Date.now() + 3 * DAY).toISOString()}`);
  assert.ok(!earlier.body.busy.some((b) => new Date(b.start).getTime() === start.getTime()));
});

test('events: any future time is accepted, and bad times are rejected', async () => {
  const path = `/api/groups/${groupId}/events`;
  const start = new Date(Date.now() + DAY);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

  const good = await call(path, { method: 'POST', body: { title: 'Custom time plan', start: start.toISOString(), end: end.toISOString() } });
  assert.strictEqual(good.status, 201);
  const list = await call(path);
  assert.ok(list.body.events.some((e) => e.title === 'Custom time plan'));

  const past = await call(path, { method: 'POST', body: { title: 'Old', start: '2020-01-01T10:00:00Z', end: '2020-01-01T11:00:00Z' } });
  assert.strictEqual(past.status, 400);
  assert.match(past.body.error, /already passed/);

  const reversed = await call(path, { method: 'POST', body: { title: 'Backwards', start: end.toISOString(), end: start.toISOString() } });
  assert.strictEqual(reversed.status, 400);

  const long = await call(path, { method: 'POST', body: { title: 'Forever', start: start.toISOString(), end: new Date(start.getTime() + 15 * DAY).toISOString() } });
  assert.strictEqual(long.status, 400);
  assert.match(long.body.error, /14 days/);
});

test('another group is still off limits', async () => {
  const res = await call('/api/groups/99999/availability?days=3');
  assert.strictEqual(res.status, 403);
});
