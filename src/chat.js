'use strict';
// Member chat: public channels plus one-to-one conversations, over Socket.IO.
const { Server } = require('socket.io');

const MAX_LEN = 2000;
const HISTORY = 100;

function channelsFor(db, userId) {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT u.full_name FROM channel_members cm2 JOIN users u ON u.id = cm2.user_id
        WHERE cm2.channel_id = c.id AND cm2.user_id != :uid) AS other_name,
      (SELECT count(*) FROM messages m WHERE m.channel_id = c.id AND m.user_id != :uid
        AND m.id > COALESCE((SELECT last_read_id FROM channel_members WHERE channel_id = c.id AND user_id = :uid), 0)) AS unread
    FROM channels c
    WHERE c.is_dm = 0 OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = :uid)
    ORDER BY c.is_dm, c.id`).all({ uid: userId });
  return rows.map((r) => ({ ...r, label: r.is_dm ? (r.other_name || '?') : `# ${r.name}` }));
}

function canAccess(db, userId, slug) {
  const ch = db.prepare('SELECT * FROM channels WHERE slug = ?').get(slug);
  if (!ch) return null;
  if (!ch.is_dm) return ch;
  return db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, userId) ? ch : null;
}

function directChannel(db, a, b) {
  const [x, y] = a < b ? [a, b] : [b, a];
  const slug = `dm-${x}-${y}`;
  db.prepare("INSERT OR IGNORE INTO channels (slug, name, is_dm) VALUES (?, 'dm', 1)").run(slug);
  const ch = db.prepare('SELECT * FROM channels WHERE slug = ?').get(slug);
  const add = db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)');
  add.run(ch.id, x);
  add.run(ch.id, y);
  return ch;
}

function markRead(db, channelId, userId, messageId) {
  db.prepare(`INSERT INTO channel_members (channel_id, user_id, last_read_id) VALUES (?, ?, ?)
    ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_id = max(last_read_id, excluded.last_read_id)`)
    .run(channelId, userId, messageId);
}

function attach(httpServer, db, sessionMiddleware) {
  const io = new Server(httpServer, { serveClient: true });
  require('./alerts').setIo(io);
  io.engine.use(sessionMiddleware);
  const userById = db.prepare("SELECT id, full_name, status FROM users WHERE id = ? AND status = 'active'");
  const insert = db.prepare('INSERT INTO messages (channel_id, user_id, body) VALUES (?, ?, ?)');

  io.use((socket, next) => {
    const uid = socket.request.session?.userId;
    const user = uid && userById.get(uid);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(`user:${me.id}`);
    let current = null;
    let sentTimes = [];

    socket.on('join', (slug, ack) => {
      const ch = canAccess(db, me.id, String(slug));
      if (!ch) return ack?.({ error: 'forbidden' });
      if (current) socket.leave(`ch:${current.id}`);
      current = ch;
      socket.join(`ch:${ch.id}`);
      const history = db.prepare(`SELECT * FROM (
          SELECT m.id, m.body, m.created_at, m.user_id, u.full_name AS author
          FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT ${HISTORY}) ORDER BY id`).all(ch.id);
      if (history.length) markRead(db, ch.id, me.id, history[history.length - 1].id);
      ack?.({ channel: { slug: ch.slug, name: ch.name, is_dm: ch.is_dm }, history, me: me.id });
    });

    socket.on('message', (body, ack) => {
      if (!current) return ack?.({ error: 'no channel' });
      const text = String(body || '').trim().slice(0, MAX_LEN);
      if (!text) return ack?.({ error: 'empty' });
      const now = Date.now();
      sentTimes = sentTimes.filter((t) => now - t < 10e3);
      if (sentTimes.length >= 10) return ack?.({ error: 'rate' });
      sentTimes.push(now);
      // Re-check: a member may have been suspended while connected.
      if (!userById.get(me.id)) return socket.disconnect(true);
      const id = Number(insert.run(current.id, me.id, text).lastInsertRowid);
      const msg = { id, body: text, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19), user_id: me.id, author: me.full_name };
      markRead(db, current.id, me.id, id);
      io.to(`ch:${current.id}`).emit('message', { slug: current.slug, ...msg });
      if (current.is_dm) {
        for (const { user_id: uid } of db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ? AND user_id != ?').all(current.id, me.id)) {
          io.to(`user:${uid}`).emit('notify', { slug: current.slug, author: me.full_name });
        }
      } else {
        socket.broadcast.emit('notify', { slug: current.slug });
      }
      ack?.({ ok: true, id });
    });

    socket.on('read', (id) => {
      if (current && Number.isInteger(id)) markRead(db, current.id, me.id, id);
    });
  });

  return io;
}

module.exports = { attach, channelsFor, directChannel, canAccess };
