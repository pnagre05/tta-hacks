require('dotenv').config();
// Local defaults so no .env is needed. Set JWT_SECRET in server/.env for anything beyond local testing.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'local-dev-secret-not-for-production';
  console.warn('JWT_SECRET not set: using a local development default.');
}
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { migrate, query, dbInfo } = require('./db');
const { seed } = require('./seed');
const { HttpError } = require('./http');
const { requireAuth } = require('./auth');
const { initRealtime } = require('./realtime');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const availabilityRoutes = require('./routes/availability');
const { router: eventRoutes } = require('./routes/events');
const { router: ideaRoutes } = require('./routes/ideas');
const { router: pollRoutes, startPollSweeper } = require('./routes/polls');
const { router: expenseRoutes } = require('./routes/expenses');
const { router: aiRoutes } = require('./routes/ai');

const app = express();
app.set('trust proxy', 1); // correct client IPs behind ngrok/cloudflared for rate limiting

app.use(helmet({
  contentSecurityPolicy: {
    // Don't force https: on a LAN the app runs over plain http.
    directives: { upgradeInsecureRequests: null },
  },
  hsts: process.env.COOKIE_SECURE === 'true',
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// General API rate limit: 300 requests per minute per IP.
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Slow down a little.' } }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);

// Everything below needs a logged-in user.
app.use('/api', requireAuth, groupRoutes, availabilityRoutes, eventRoutes, ideaRoutes, pollRoutes, expenseRoutes, aiRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React app (after `npm run build` in /client) so phones only need one address.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Errors: known ones get their message; anything else is logged and hidden from the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

async function start() {
  console.log(`Database: ${dbInfo}`);
  await migrate();
  // First run: load the demo group so there is something to log in to.
  const { rows } = await query('SELECT COUNT(*) AS n FROM users');
  if (rows[0].n === 0) await seed();
  const server = http.createServer(app);
  initRealtime(server);
  startPollSweeper();
  const port = Number(process.env.PORT) || 4000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`GATHER server running on port ${port}`);
    console.log(`  This computer:  http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`  Phones on Wi-Fi: http://${net.address}:${port}`);
      }
    }
    if (!fs.existsSync(clientDist)) console.log('  (React app not built yet: run the client with `npm run dev` in /client)');
  });
  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { app, start };
