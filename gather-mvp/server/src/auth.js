const jwt = require('jsonwebtoken');
const { query } = require('./db');
const { HttpError, parseId } = require('./http');

const COOKIE_NAME = 'gather_session';
const SESSION_DAYS = 7;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET must be set to a long random string');
  return s;
}

function signSession(userId) {
  return jwt.sign({ uid: userId }, secret(), { expiresIn: `${SESSION_DAYS}d` });
}

function verifySession(token) {
  try {
    const payload = jwt.verify(token, secret());
    return Number.isInteger(payload.uid) ? payload.uid : null;
  } catch {
    return null;
  }
}

// httpOnly: JavaScript in the page can't read the cookie (protects against XSS token theft).
// sameSite lax: the cookie isn't sent on cross-site POSTs (protects against CSRF).
function setSessionCookie(res, userId) {
  res.cookie(COOKIE_NAME, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

async function requireAuth(req, res, next) {
  const uid = verifySession(req.cookies?.[COOKIE_NAME]);
  if (!uid) throw new HttpError(401, 'Please log in');
  const { rows } = await query('SELECT id, name, email FROM users WHERE id = $1', [uid]);
  if (!rows[0]) throw new HttpError(401, 'Please log in');
  req.user = rows[0];
  next();
}

async function isMember(userId, groupId) {
  const { rows } = await query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return rows.length > 0;
}

// Throws 403 unless the user belongs to the group. Every group-scoped route uses this.
async function assertMember(userId, groupId) {
  if (!(await isMember(userId, groupId))) {
    throw new HttpError(403, 'You are not a member of this group');
  }
}

// For routes shaped /groups/:groupId/...
async function requireGroupMember(req, res, next) {
  const groupId = parseId(req.params.groupId, 'group id');
  await assertMember(req.user.id, groupId);
  req.groupId = groupId;
  next();
}

// For routes on a single record (/polls/:pollId/...): look up its group, then check membership.
async function groupOf(table, id) {
  const allowed = ['events', 'ideas', 'polls', 'expenses'];
  if (!allowed.includes(table)) throw new Error('bad table');
  const { rows } = await query(`SELECT group_id FROM ${table} WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Not found');
  return rows[0].group_id;
}

module.exports = {
  COOKIE_NAME,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireGroupMember,
  assertMember,
  isMember,
  groupOf,
};
