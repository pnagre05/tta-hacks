const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { query } = require('../db');
const { HttpError, parse } = require('../http');
const { setSessionCookie, clearSessionCookie, requireAuth } = require('../auth');

const router = express.Router();

// Slow down password guessing: 20 FAILED attempts per 15 minutes per IP (successful logins don't count).
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' } });

const registerSchema = z.object({
  name: z.string().trim().min(1).max(50),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

router.post('/register', authLimiter, async (req, res) => {
  const { name, email, password } = parse(registerSchema, req.body);
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id, name, email`,
    [name, email, hash]
  );
  if (!rows[0]) throw new HttpError(409, 'That email is already registered');
  setSessionCookie(res, rows[0].id);
  res.status(201).json({ user: rows[0] });
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const { rows } = await query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
  const user = rows[0];
  // Same message either way, so attackers can't tell which emails exist.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  setSessionCookie(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows: groups } = await query(
    `SELECT g.id, g.name, g.timezone, gm.role
       FROM groups g JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = $1 ORDER BY gm.joined_at`,
    [req.user.id]
  );
  const { rows: cal } = await query(
    'SELECT connected_at, last_synced_at FROM calendar_connections WHERE user_id = $1',
    [req.user.id]
  );
  res.json({ user: req.user, groups, calendar: cal[0] || null });
});

module.exports = router;
