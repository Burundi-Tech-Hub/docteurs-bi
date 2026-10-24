'use strict';
const express = require('express');
const register = require('../register');
const mail = require('../mail');
const alerts = require('../alerts');
const { flash, requireAdmin } = require('../app');

module.exports = function adminRoutes(db) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => {
    const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
    const counts = db.prepare(`SELECT list, count(*) AS n FROM register_entries GROUP BY list`).all();
    const mailRequests = db.prepare(`SELECT m.*, u.full_name, u.phone FROM mailboxes m JOIN users u ON u.id = m.user_id
      WHERE m.status IN ('requested','error') ORDER BY m.id`).all();
    const claims = db.prepare(`SELECT u.id, u.full_name, u.phone, r.order_no, r.name AS register_name, r.notes, r.phone AS register_phone
      FROM users u JOIN register_entries r ON r.id = u.register_entry_id WHERE u.register_link = 'claimed' ORDER BY u.id`).all();
    const q = String(req.query.q || '').trim();
    const users = db.prepare(`SELECT u.*, r.order_no, inv.full_name AS inviter_name,
        (SELECT address FROM mailboxes WHERE user_id = u.id AND status = 'active') AS mailbox
      FROM users u LEFT JOIN register_entries r ON r.id = u.register_entry_id
      LEFT JOIN users inv ON inv.id = u.invited_by
      WHERE (:q = '' OR u.full_name LIKE :like OR u.phone LIKE :like)
      ORDER BY u.id DESC LIMIT 200`).all({ q, like: `%${q}%` });
    const importResult = req.session.importResult || null;
    delete req.session.importResult;
    const newMessages = db.prepare("SELECT count(*) AS n FROM contact_messages WHERE status = 'new'").get().n;
    res.render('admin', { title: req.t('admin.title'), meta, counts, mailRequests, claims, users, q, importResult, newMessages });
  });

  router.post('/import', async (req, res) => {
    try {
      const out = await register.importLive(db);
      flash(req, 'success', req.t('admin.import_ok', out));
    } catch (e) {
      console.error(e);
      flash(req, 'error', req.t('admin.import_fail', { error: e.message }));
    }
    res.redirect('/admin');
  });

  router.post('/mailboxes/:id/approve', async (req, res) => {
    await mail.provision(db, Number(req.params.id));
    res.redirect('/admin');
  });

  router.post('/mailboxes/:id/reject', (req, res) => {
    db.prepare("UPDATE mailboxes SET status = 'rejected' WHERE id = ?").run(Number(req.params.id));
    res.redirect('/admin');
  });

  router.post('/claims/:userId/approve', (req, res) => {
    db.prepare("UPDATE users SET register_link = 'approved' WHERE id = ? AND register_link = 'claimed'").run(Number(req.params.userId));
    res.redirect('/admin');
  });

  router.post('/claims/:userId/reject', (req, res) => {
    db.prepare("UPDATE users SET register_link = 'none', register_entry_id = NULL WHERE id = ? AND register_link = 'claimed'")
      .run(Number(req.params.userId));
    res.redirect('/admin');
  });

  router.post('/users/:id/:action', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.redirect('/admin');
    const sql = {
      suspend: "UPDATE users SET status = 'suspended' WHERE id = ?",
      activate: "UPDATE users SET status = 'active' WHERE id = ?",
      'make-admin': "UPDATE users SET role = 'admin' WHERE id = ?",
    }[req.params.action];
    if (sql) db.prepare(sql).run(id);
    if (req.params.action === 'suspend') db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(id);
    res.redirect('/admin');
  });

  router.get('/messages', (req, res) => {
    const list = db.prepare(`SELECT c.*, u.full_name AS member FROM contact_messages c LEFT JOIN users u ON u.id = c.user_id
      ORDER BY (c.status = 'done'), c.id DESC LIMIT 200`).all();
    res.render('admin-messages', { title: req.t('contact.admin_title'), list });
  });

  router.post('/messages/:id/:status', (req, res) => {
    if (['new', 'done'].includes(req.params.status)) {
      db.prepare('UPDATE contact_messages SET status = ? WHERE id = ?').run(req.params.status, Number(req.params.id));
    }
    res.redirect('/admin/messages');
  });

  router.get('/alerts', (req, res) => {
    const list = db.prepare(`SELECT a.*, u.full_name AS author, (${alerts.ACTIVE_WHERE}) AS is_active
      FROM alerts a JOIN users u ON u.id = a.created_by ORDER BY a.id DESC LIMIT 100`).all();
    const reach = {
      members: alerts.recipients(db, 'members').length,
      members_register: alerts.recipients(db, 'members_register').length,
    };
    res.render('admin-alerts', { title: req.t('alert.title'), list, reach, levels: alerts.LEVELS, categories: alerts.CATEGORIES });
  });

  router.post('/alerts', (req, res) => {
    const b = req.body;
    const input = {
      title: String(b.title || '').trim().slice(0, 120),
      body: String(b.body || '').trim().slice(0, 2000),
      level: alerts.LEVELS.includes(b.level) ? b.level : 'warning',
      category: alerts.CATEGORIES.includes(b.category) ? b.category : 'other',
      expires_hours: Math.max(0, Math.min(24 * 90, Number.parseInt(b.expires_hours, 10) || 0)),
      sms_audience: ['members', 'members_register'].includes(b.sms_audience) ? b.sms_audience : 'none',
    };
    if (!input.title || !input.body) {
      flash(req, 'error', req.t('alert.err_required'));
      return res.redirect('/admin/alerts');
    }
    const { alert } = alerts.publish(db, req.user.id, input);
    const n = alerts.recipients(db, alert.sms_audience).length;
    flash(req, 'success', alert.sms_audience === 'none' ? req.t('alert.published') : req.t('alert.published_sms', { n }));
    res.redirect('/admin/alerts');
  });

  router.post('/alerts/:id/end', (req, res) => {
    alerts.end(db, Number(req.params.id));
    res.redirect('/admin/alerts');
  });

  return router;
};
