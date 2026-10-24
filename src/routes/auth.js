'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const phone = require('../phone');
const otp = require('../otp');
const { flash } = require('../app');

const devCodes = () => config.sms.driver === 'console' && !config.isProd;
const normOrder = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

module.exports = function authRoutes(db) {
  const router = express.Router();
  const userByPhone = db.prepare('SELECT * FROM users WHERE phone = ?');
  const inviteByToken = db.prepare(`SELECT i.*, u.full_name AS inviter_name FROM invites i
    JOIN users u ON u.id = i.inviter_id WHERE i.token = ?`);

  // Validate a phone field; returns E.164 or sets an error message.
  function readPhone(req, field = 'phone') {
    const p = phone.normalize(req.body[field]);
    if (!p) return { error: req.t('err.phone_invalid') };
    if (!phone.isBurundi(p)) return { error: req.t('err.phone_not_bi') };
    return { phone: p };
  }

  async function sendCode(req, p, purpose) {
    try {
      const code = await otp.issue(db, p, purpose, config.appName);
      if (devCodes()) flash(req, 'info', `DEV — SMS code: ${code}`);
      return null;
    } catch (e) {
      if (e instanceof otp.OtpError) return req.t(e.message);
      console.error(e);
      return req.t('otp.send_failed');
    }
  }

  // Invitation links: /i/<token>
  router.get('/i/:token', (req, res) => {
    const inv = inviteByToken.get(req.params.token);
    if (!inv || inv.accepted_by) return res.redirect('/register');
    req.session.inviteToken = inv.token;
    req.session.reg = { phone: inv.phone, verified: false };
    flash(req, 'info', req.t('inv.landing', { inviter: inv.inviter_name }));
    res.redirect('/register');
  });

  router.get('/register', (req, res) => {
    if (req.user) return res.redirect('/');
    const reg = req.session.reg || null;
    const invite = req.session.inviteToken ? inviteByToken.get(req.session.inviteToken) : null;
    let match = null;
    if (reg?.verified) {
      match = db.prepare(`SELECT r.* FROM register_entries r
        WHERE r.phone = ? AND NOT EXISTS (SELECT 1 FROM users u WHERE u.register_entry_id = r.id) LIMIT 1`).get(reg.phone);
    }
    res.render('register', { title: req.t('reg.title'), reg, invite, match, error: null, form: {} });
  });

  router.post('/register/phone', async (req, res) => {
    const { phone: p, error } = readPhone(req);
    const fail = (msg) => {
      flash(req, 'error', msg);
      res.redirect('/register');
    };
    if (error) return fail(error);
    if (userByPhone.get(p)) return fail(req.t('err.phone_taken'));
    const sendError = await sendCode(req, p, 'register');
    req.session.reg = { phone: p, verified: false, codeSent: !sendError };
    if (sendError) return fail(sendError);
    res.redirect('/register');
  });

  router.post('/register/verify', (req, res) => {
    const reg = req.session.reg;
    if (!reg) return res.redirect('/register');
    if (otp.verify(db, reg.phone, 'register', req.body.code)) reg.verified = true;
    else flash(req, 'error', req.t('err.code_invalid'));
    res.redirect('/register');
  });

  router.post('/register/reset', (req, res) => {
    delete req.session.reg;
    res.redirect('/register');
  });

  router.post('/register/complete', async (req, res) => {
    const reg = req.session.reg;
    if (!reg?.verified) return res.redirect('/register');
    const b = req.body;
    const form = {
      full_name: String(b.full_name || '').trim().slice(0, 120),
      order_no: String(b.order_no || '').trim().slice(0, 20),
      specialty: String(b.specialty || '').trim().slice(0, 80),
      workplace: String(b.workplace || '').trim().slice(0, 120),
      city: String(b.city || '').trim().slice(0, 80),
    };
    const invite = req.session.inviteToken ? inviteByToken.get(req.session.inviteToken) : null;
    const match = db.prepare(`SELECT r.* FROM register_entries r
      WHERE r.phone = ? AND NOT EXISTS (SELECT 1 FROM users u WHERE u.register_entry_id = r.id) LIMIT 1`).get(reg.phone);

    let error = null;
    if (!form.full_name) error = req.t('err.name_required');
    else if (String(b.password || '').length < 8) error = req.t('err.password_short');
    else if (b.password !== b.password2) error = req.t('err.password_mismatch');
    else if (b.declaration !== 'on') error = req.t('err.declaration');
    else if (userByPhone.get(reg.phone)) error = req.t('err.phone_taken');

    // Register entry: automatic when the phone matches, otherwise a claim for admin review.
    let entryId = null;
    let link = 'none';
    if (!error && match) {
      entryId = match.id;
      link = 'auto';
    } else if (!error && form.order_no) {
      const entry = db.prepare("SELECT * FROM register_entries WHERE replace(upper(order_no), ' ', '') = ? ORDER BY list LIMIT 1")
        .get(normOrder(form.order_no));
      if (!entry) error = req.t('err.order_unknown');
      else if (db.prepare('SELECT 1 FROM users WHERE register_entry_id = ?').get(entry.id)) error = req.t('err.order_taken');
      else { entryId = entry.id; link = 'claimed'; }
    }
    if (error) {
      return res.status(400).render('register', { title: req.t('reg.title'), reg, invite, match, error, form });
    }

    const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
    const role = config.adminPhones.includes(reg.phone) || !hasAdmin ? 'admin' : 'member';
    const hash = await bcrypt.hash(b.password, 11);
    const info = db.prepare(`INSERT INTO users (full_name, phone, phone_verified_at, password_hash, role, specialty,
        workplace, city, register_entry_id, register_link, invited_by, lang)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(form.full_name, reg.phone, hash, role, form.specialty, form.workplace, form.city,
        entryId, link, invite && !invite.accepted_by ? invite.inviter_id : null, res.locals.lang);
    const userId = Number(info.lastInsertRowid);
    if (invite && !invite.accepted_by) {
      db.prepare("UPDATE invites SET accepted_by = ?, accepted_at = datetime('now') WHERE id = ?").run(userId, invite.id);
    }
    db.prepare("UPDATE invites SET accepted_by = ?, accepted_at = datetime('now') WHERE phone = ? AND accepted_by IS NULL")
      .run(userId, reg.phone);

    delete req.session.reg;
    delete req.session.inviteToken;
    req.session.regenerate((err) => {
      if (err) return res.status(500).end();
      req.session.userId = userId;
      req.session.lang = res.locals.lang;
      res.redirect('/welcome');
    });
  });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('login', { title: req.t('login.title'), error: null, phoneValue: '' });
  });

  router.post('/login', async (req, res) => {
    const p = phone.normalize(req.body.phone);
    const user = p ? userByPhone.get(p) : null;
    const ok = user && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
    if (!ok || user.status !== 'active') {
      const error = ok ? req.t('err.suspended') : req.t('err.login');
      return res.status(401).render('login', { title: req.t('login.title'), error, phoneValue: req.body.phone || '' });
    }
    const returnTo = req.session.returnTo;
    const lang = res.locals.lang;
    req.session.regenerate((err) => {
      if (err) return res.status(500).end();
      req.session.userId = user.id;
      req.session.lang = lang;
      res.redirect(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/');
    });
  });

  router.post('/logout', (req, res) => {
    const lang = res.locals.lang;
    req.session.regenerate(() => {
      req.session.lang = lang;
      res.redirect('/');
    });
  });

  // Password reset with an SMS code.
  router.get('/forgot', (req, res) => {
    res.render('forgot', { title: req.t('reset.title'), reset: req.session.reset || null, error: null });
  });

  router.post('/forgot/phone', async (req, res) => {
    const { phone: p, error } = readPhone(req);
    if (error || !userByPhone.get(p)) {
      flash(req, 'error', error || req.t('err.no_account'));
      return res.redirect('/forgot');
    }
    const sendError = await sendCode(req, p, 'reset');
    if (sendError) flash(req, 'error', sendError);
    else req.session.reset = { phone: p };
    res.redirect('/forgot');
  });

  router.post('/forgot/complete', async (req, res) => {
    const reset = req.session.reset;
    if (!reset) return res.redirect('/forgot');
    let error = null;
    if (String(req.body.password || '').length < 8) error = req.t('err.password_short');
    else if (req.body.password !== req.body.password2) error = req.t('err.password_mismatch');
    else if (!otp.verify(db, reset.phone, 'reset', req.body.code)) error = req.t('err.code_invalid');
    if (error) return res.status(400).render('forgot', { title: req.t('reset.title'), reset, error });
    const hash = await bcrypt.hash(req.body.password, 11);
    db.prepare('UPDATE users SET password_hash = ? WHERE phone = ?').run(hash, reset.phone);
    delete req.session.reset;
    flash(req, 'success', req.t('profile.saved'));
    res.redirect('/login');
  });

  return router;
};
