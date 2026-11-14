// Google Calendar: OAuth + free/busy only. GATHER never requests or stores event titles.
const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const { query, withTx } = require('../db');
const { HttpError } = require('../http');
const { requireAuth } = require('../auth');
const { encrypt, decrypt } = require('../crypto');
const { emitToUserGroups } = require('../realtime');

const router = express.Router();

// The narrowest scope that can answer "when is this person busy?"
const SCOPES = ['https://www.googleapis.com/auth/calendar.events.freebusy'];
const SYNC_DAYS = 14;

function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function appUrl(path) {
  return `${(process.env.APP_URL || '').replace(/\/$/, '')}${path}`;
}

// Pull busy times for the next 14 days and replace this user's Google rows.
async function syncUser(userId) {
  const { rows } = await query('SELECT encrypted_refresh_token FROM calendar_connections WHERE user_id = $1', [userId]);
  if (!rows[0]) throw new HttpError(400, 'Calendar is not connected');
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: decrypt(rows[0].encrypted_refresh_token) });
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + SYNC_DAYS * 24 * 60 * 60 * 1000);
  const { data } = await calendar.freebusy.query({
    requestBody: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: 'primary' }] },
  });
  const busy = data.calendars?.primary?.busy || [];

  await withTx(async (db) => {
    await db.query("DELETE FROM availability WHERE user_id = $1 AND source = 'google'", [userId]);
    for (const b of busy) {
      await db.query(
        "INSERT INTO availability (user_id, start_utc, end_utc, source) VALUES ($1, $2, $3, 'google')",
        [userId, b.start, b.end]
      );
    }
    await db.query('UPDATE calendar_connections SET last_synced_at = now() WHERE user_id = $1', [userId]);
  });
  await emitToUserGroups(userId, 'availability');
  return busy.length;
}

router.get('/calendar/status', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT connected_at, last_synced_at FROM calendar_connections WHERE user_id = $1', [req.user.id]
  );
  res.json({ configured: configured(), connection: rows[0] || null });
});

// Step 1: the client asks for a Google sign-in URL and sends the browser there.
router.get('/calendar/connect', requireAuth, async (req, res) => {
  if (!configured()) throw new HttpError(503, 'Google Calendar is not set up on the server yet');
  const state = crypto.randomBytes(32).toString('hex');
  await query("DELETE FROM oauth_states WHERE expires_at < now()");
  await query(
    "INSERT INTO oauth_states (state, user_id, expires_at) VALUES ($1, $2, now() + interval '10 minutes')",
    [state, req.user.id]
  );
  const url = oauthClient().generateAuthUrl({
    access_type: 'offline', // gives us a refresh token
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
  res.json({ url });
});

// Step 2: Google sends the browser back here. This may arrive on the tunnel URL, where the
// session cookie isn't present, so the one-time "state" value identifies the user instead.
router.get('/calendar/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const back = (status) => res.redirect(appUrl(`/?calendar=${status}#group`));
  if (error || typeof code !== 'string' || typeof state !== 'string') return back('cancelled');

  const { rows } = await query(
    'DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING user_id', [state]
  );
  if (!rows[0]) return back('expired');
  const userId = rows[0].user_id;

  try {
    const { tokens } = await oauthClient().getToken(code);
    if (!tokens.refresh_token) return back('error');
    await query(
      `INSERT INTO calendar_connections (user_id, encrypted_refresh_token) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, connected_at = now()`,
      [userId, encrypt(tokens.refresh_token)]
    );
    await syncUser(userId);
    back('connected');
  } catch (err) {
    console.error('Google callback failed:', err.message);
    back('error');
  }
});

router.post('/calendar/sync', requireAuth, async (req, res) => {
  try {
    const count = await syncUser(req.user.id);
    res.json({ ok: true, busyBlocks: count });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Google sync failed:', err.message);
    throw new HttpError(502, 'Could not reach Google Calendar. Try reconnecting.');
  }
});

// Revoke Google's access and delete everything we got from it.
router.post('/calendar/disconnect', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT encrypted_refresh_token FROM calendar_connections WHERE user_id = $1', [req.user.id]);
  if (rows[0] && configured()) {
    try {
      await oauthClient().revokeToken(decrypt(rows[0].encrypted_refresh_token));
    } catch (err) {
      console.warn('Token revoke failed (deleting locally anyway):', err.message);
    }
  }
  await query('DELETE FROM calendar_connections WHERE user_id = $1', [req.user.id]);
  await query("DELETE FROM availability WHERE user_id = $1 AND source = 'google'", [req.user.id]);
  await emitToUserGroups(req.user.id, 'availability');
  res.json({ ok: true });
});

module.exports = router;
