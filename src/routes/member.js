'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const phone = require('../phone');
const sms = require('../drivers/sms');
const mail = require('../mail');
const chat = require('../chat');
const { flash, requireUser } = require('../app');

const normOrder = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

module.exports = function memberRoutes(db) {
  const router = express.Router();

  router.get('/welcome', requireUser, (req, res) => {
    const entry = req.user.register_entry_id
      ? db.prepare('SELECT * FROM register_entries WHERE id = ?').get(req.user.register_entry_id) : null;
    res.render('welcome', { title: req.t('nav.profile'), entry });
  });

  router.get('/profile', requireUser, (req, res) => {
    const entry = req.user.register_entry_id
      ? db.prepare('SELECT * FROM register_entries WHERE id = ?').get(req.user.register_entry_id) : null;
    res.render('profile', { title: req.t('profile.title'), entry, error: null });
  });

  router.post('/profile', requireUser, (req, res) => {
    const b = req.body;
    const name = String(b.full_name || '').trim().slice(0, 120);
    if (!name) {
      flash(req, 'error', req.t('err.name_required'));
      return res.redirect('/profile');
    }
    db.prepare('UPDATE users SET full_name = ?, specialty = ?, workplace = ?, city = ?, sms_alerts = ? WHERE id = ?').run(
      name, String(b.specialty || '').trim().slice(0, 80), String(b.workplace || '').trim().slice(0, 120),
      String(b.city || '').trim().slice(0, 80), b.sms_alerts === 'on' ? 1 : 0, req.user.id);
    flash(req, 'success', req.t('profile.saved'));
    res.redirect('/profile');
  });

  router.post('/profile/claim', requireUser, (req, res) => {
    if (['auto', 'approved'].includes(req.user.register_link)) return res.redirect('/profile');
    const entry = db.prepare("SELECT * FROM register_entries WHERE replace(upper(order_no), ' ', '') = ? ORDER BY list LIMIT 1")
      .get(normOrder(req.body.order_no));
    if (!entry) flash(req, 'error', req.t('err.order_unknown'));
    else if (db.prepare('SELECT 1 FROM users WHERE register_entry_id = ? AND id != ?').get(entry.id, req.user.id)) {
      flash(req, 'error', req.t('err.order_taken'));
    } else {
      // Phone on the register matches the member's verified phone: link straight away.
      const link = entry.phone && entry.phone === req.user.phone ? 'auto' : 'claimed';
      db.prepare('UPDATE users SET register_entry_id = ?, register_link = ? WHERE id = ?').run(entry.id, link, req.user.id);
    }
    res.redirect('/profile');
  });

  // Professional email
  router.get('/email', requireUser, (req, res) => {
    const box = db.prepare('SELECT * FROM mailboxes WHERE user_id = ?').get(req.user.id);
    const oneTimePassword = req.session.mailPassword || null;
    delete req.session.mailPassword;
    res.render('email', {
      title: req.t('mail.title'), box, oneTimePassword,
      suggestion: mail.suggestLocalPart(req.user.full_name),
    });
  });

  router.post('/email', requireUser, async (req, res) => {
    const existing = db.prepare('SELECT * FROM mailboxes WHERE user_id = ?').get(req.user.id);
    if (existing && existing.status !== 'rejected') return res.redirect('/email');
    const local = String(req.body.local || '').trim().toLowerCase();
    if (!mail.validateLocalPart(local)) {
      flash(req, 'error', req.t('mail.invalid'));
      return res.redirect('/email');
    }
    const address = `${local}@${config.mail.domain}`;
    if (db.prepare('SELECT 1 FROM mailboxes WHERE address = ? AND user_id != ?').get(address, req.user.id)) {
      flash(req, 'error', req.t('mail.taken'));
      return res.redirect('/email');
    }
    if (existing) db.prepare("UPDATE mailboxes SET address = ?, status = 'requested', error = NULL WHERE id = ?").run(address, existing.id);
    else db.prepare('INSERT INTO mailboxes (user_id, address) VALUES (?, ?)').run(req.user.id, address);
    if (config.mail.autoApprove) {
      const id = db.prepare('SELECT id FROM mailboxes WHERE user_id = ?').get(req.user.id).id;
      const pw = await mail.provision(db, id);
      if (pw) req.session.mailPassword = pw;
    }
    res.redirect('/email');
  });

  // Invitations
  router.get('/invite', requireUser, (req, res) => {
    const invites = db.prepare(`SELECT i.*, u.full_name AS accepted_name FROM invites i
      LEFT JOIN users u ON u.id = i.accepted_by WHERE i.inviter_id = ? ORDER BY i.id DESC`).all(req.user.id);
    const last = req.session.lastInvite || null;
    delete req.session.lastInvite;
    res.render('invite', { title: req.t('inv.title'), invites, last });
  });

  router.post('/invite', requireUser, async (req, res) => {
    const p = phone.normalize(req.body.phone);
    if (!p || !phone.isBurundi(p)) {
      flash(req, 'error', req.t(p ? 'err.phone_not_bi' : 'err.phone_invalid'));
      return res.redirect('/invite');
    }
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(p)) {
      flash(req, 'error', req.t('err.phone_taken'));
      return res.redirect('/invite');
    }
    const recent = db.prepare("SELECT count(*) AS n FROM invites WHERE inviter_id = ? AND created_at > datetime('now', '-1 day')")
      .get(req.user.id).n;
    if (recent >= 20) {
      flash(req, 'error', req.t('otp.too_many'));
      return res.redirect('/invite');
    }
    const token = crypto.randomBytes(12).toString('base64url');
    const name = String(req.body.name || '').trim().slice(0, 120);
    db.prepare('INSERT INTO invites (token, inviter_id, name, phone) VALUES (?, ?, ?, ?)').run(token, req.user.id, name, p);
    const link = `${config.baseUrl}/i/${token}`;
    const text = req.t('inv.sms_text', { inviter: `Dr ${req.user.full_name}`, app: res.locals.appName, link });
    try {
      await sms.send(p, text);
      db.prepare('UPDATE invites SET sms_sent = 1 WHERE token = ?').run(token);
      flash(req, 'success', req.t('inv.sent', { phone: phone.format(p) }));
    } catch (e) {
      console.error(e);
      flash(req, 'error', req.t('otp.send_failed'));
    }
    req.session.lastInvite = { link, text };
    res.redirect('/invite');
  });

  // Chat
  router.get('/chat', requireUser, (req, res) => {
    const channels = chat.channelsFor(db, req.user.id);
    const current = channels.find((c) => c.slug === req.query.c) || channels[0];
    res.render('chat', { title: req.t('chat.title'), channels, current });
  });

  router.post('/chat/dm/:userId', requireUser, (req, res) => {
    const other = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(Number(req.params.userId));
    if (!other || other.id === req.user.id) return res.redirect('/chat');
    const ch = chat.directChannel(db, req.user.id, other.id);
    res.redirect(`/chat?c=${encodeURIComponent(ch.slug)}`);
  });

  return router;
};
