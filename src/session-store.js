'use strict';
// express-session store backed by the app's SQLite database.
const session = require('express-session');

class SqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.setStmt = db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`);
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now()), 3600e3).unref();
  }

  expiry(sess) {
    const maxAge = sess?.cookie?.maxAge;
    return Date.now() + (typeof maxAge === 'number' ? maxAge : 86400e3);
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess));
      cb?.(null);
    } catch (e) { cb?.(e); }
  }

  touch(sid, sess, cb) { this.set(sid, sess, cb); }

  destroy(sid, cb) {
    try {
      this.delStmt.run(sid);
      cb?.(null);
    } catch (e) { cb?.(e); }
  }
}

module.exports = SqliteStore;
