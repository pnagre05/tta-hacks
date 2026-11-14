// Socket.IO: one room per group. The server only ever tells clients WHAT changed
// ("poll", "idea", ...); clients refetch through the normal, permission-checked API.
const { Server } = require('socket.io');
const cookie = require('cookie');
const { COOKIE_NAME, verifySession, isMember } = require('./auth');
const { query } = require('./db');

let io = null;

function initRealtime(httpServer) {
  io = new Server(httpServer, { serveClient: false });

  // Authenticate the socket with the same session cookie as the REST API.
  io.use((socket, next) => {
    const cookies = cookie.parse(socket.handshake.headers.cookie || '');
    const uid = verifySession(cookies[COOKIE_NAME]);
    if (!uid) return next(new Error('unauthorized'));
    socket.data.userId = uid;
    next();
  });

  io.on('connection', (socket) => {
    // Simple flood protection: at most 20 messages per 10 seconds per socket.
    let count = 0;
    const reset = setInterval(() => (count = 0), 10_000);
    socket.use((packet, next) => (++count > 20 ? next(new Error('rate limited')) : next()));
    socket.on('error', () => {});
    socket.on('disconnect', () => clearInterval(reset));

    socket.on('join', async (groupId, ack = () => {}) => {
      const id = Number(groupId);
      if (!Number.isInteger(id) || !(await isMember(socket.data.userId, id))) {
        return ack({ ok: false, error: 'not a member' });
      }
      for (const room of socket.rooms) if (room.startsWith('group:')) socket.leave(room);
      socket.join(`group:${id}`);
      ack({ ok: true });
    });
  });

  return io;
}

function emitGroupUpdate(groupId, type) {
  if (io) io.to(`group:${groupId}`).emit('group:updated', { type });
}

// Availability belongs to a user, so tell every group they're in.
async function emitToUserGroups(userId, type) {
  const { rows } = await query('SELECT group_id FROM group_members WHERE user_id = $1', [userId]);
  rows.forEach((r) => emitGroupUpdate(r.group_id, type));
}

module.exports = { initRealtime, emitGroupUpdate, emitToUserGroups };
