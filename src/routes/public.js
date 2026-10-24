'use strict';
const express = require('express');
const alerts = require('../alerts');

const PAGE_SIZE = 50;

// One row shape for register entries and members, so the directory can mix both.
const DIRECTORY_SQL = `
  SELECT 'register' AS kind, r.list, r.order_no, r.name, r.notes, r.struck_off,
         COALESCE(u.phone, r.phone) AS phone, COALESCE(m.address, r.email) AS email,
         u.id AS member_id, u.specialty, u.workplace, u.city
  FROM register_entries r
  LEFT JOIN users u ON u.register_entry_id = r.id AND u.register_link IN ('auto','approved') AND u.status = 'active'
  LEFT JOIN mailboxes m ON m.user_id = u.id AND m.status = 'active'
  UNION ALL
  SELECT 'member', 'member', '', u.full_name, '', 0, u.phone, m.address, u.id, u.specialty, u.workplace, u.city
  FROM users u
  LEFT JOIN mailboxes m ON m.user_id = u.id AND m.status = 'active'
  WHERE u.status = 'active' AND (u.register_entry_id IS NULL OR u.register_link NOT IN ('auto','approved'))
`;

module.exports = function publicRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => res.render('home', { title: null }));

  router.get('/directory', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const list = ['definitive', 'provisional', 'members'].includes(req.query.list) ? req.query.list : 'all';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

    const where = [];
    const params = {};
    if (list === 'members') where.push('member_id IS NOT NULL');
    else if (list !== 'all') { where.push('list = :list'); params.list = list; }
    if (q) {
      where.push("(name LIKE :q OR replace(order_no, ' ', '') LIKE :qo OR specialty LIKE :q OR workplace LIKE :q)");
      params.q = `%${q}%`;
      params.qo = `%${q.replace(/\s+/g, '')}%`;
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT count(*) AS n FROM (${DIRECTORY_SQL}) ${filter}`).get(params).n;
    const rows = db.prepare(`SELECT * FROM (${DIRECTORY_SQL}) ${filter}
      ORDER BY (member_id IS NULL), CASE WHEN order_no = '' THEN 1 ELSE 0 END,
               CAST(substr(replace(order_no, ' ', ''), 3) AS INTEGER), name
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).all(params);

    // Contact details are for signed-in members only.
    if (!req.user) for (const r of rows) { r.phone = null; r.email = null; }

    const updated = db.prepare("SELECT value FROM meta WHERE key = 'register_updated_at'").get()?.value;
    res.render('directory', {
      title: req.t('dir.title'), q, list, page, rows, total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), updated,
    });
  });

  router.get('/alerts', (req, res) => {
    const past = db.prepare(`SELECT * FROM alerts WHERE NOT (${alerts.ACTIVE_WHERE}) ORDER BY id DESC LIMIT 50`).all();
    res.render('alerts', { title: req.t('alert.title'), current: res.locals.activeAlerts, past });
  });

  router.get('/alerts/:id', (req, res, next) => {
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(Number(req.params.id));
    if (!alert) return next();
    res.render('alert', { title: alert.title, alert });
  });

  return router;
};

module.exports.DIRECTORY_SQL = DIRECTORY_SQL;
