'use strict';
const express = require('express');
const mailing = require('../mailing');
const email = require('../drivers/email');
const config = require('../config');
const { flash, requireAdmin } = require('../app');

// Public page behind every email's personal link (/liste/:token), and the admin mailing desk.
module.exports = function mailingRoutes(db) {
  const router = express.Router();

  router.get('/liste/:token', (req, res, next) => {
    const addr = mailing.readToken(req.params.token);
    if (!addr) return next();
    res.render('mailing-prefs', { title: req.t('ml.prefs_title'), addr, status: mailing.statusOf(db, addr), token: req.params.token });
  });

  router.post('/liste/:token', (req, res, next) => {
    const addr = mailing.readToken(req.params.token);
    if (!addr) return next();
    const status = req.body.action === 'subscribe' ? 'subscribed' : 'unsubscribed';
    mailing.setStatus(db, addr, status);
    flash(req, 'success', req.t(status === 'subscribed' ? 'ml.confirmed' : 'ml.unsubscribed'));
    res.redirect(`/liste/${req.params.token}`);
  });

  const admin = express.Router();
  router.use('/admin/mailing', admin);
  admin.use(requireAdmin);

  admin.get('/', (req, res) => {
    const list = db.prepare(`SELECT m.*,
        (SELECT count(*) FROM mailing_recipients r WHERE r.mailing_id = m.id) AS total,
        (SELECT count(*) FROM mailing_recipients r WHERE r.mailing_id = m.id AND r.status = 'sent') AS sent,
        (SELECT count(*) FROM mailing_recipients r WHERE r.mailing_id = m.id AND r.status = 'failed') AS failed,
        (SELECT count(*) FROM mailing_recipients r WHERE r.mailing_id = m.id AND r.status = 'pending') AS pending
      FROM mailings m ORDER BY m.id DESC LIMIT 50`).all();
    const draft = req.session.mailingDraft || { ...mailing.INVITATION, audience: 'all', test_to: '' };
    res.render('admin-mailing', { title: req.t('ml.title'), stats: mailing.stats(db), list, draft, ready: email.ready(), driver: config.email.driver, from: config.email.from });
  });

  const readDraft = (b) => ({
    subject: String(b.subject || '').trim().slice(0, 200),
    body: String(b.body || '').trim().slice(0, 20000),
    audience: mailing.AUDIENCES.includes(b.audience) ? b.audience : 'all',
    test_to: String(b.test_to || '').trim().slice(0, 200),
  });

  admin.post('/test', async (req, res) => {
    const d = readDraft(req.body);
    req.session.mailingDraft = d;
    if (!d.subject || !d.body) { flash(req, 'error', req.t('ml.err_required')); return res.redirect('/admin/mailing'); }
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(d.test_to)) { flash(req, 'error', req.t('ml.err_test_to')); return res.redirect('/admin/mailing'); }
    try {
      await email.send(mailing.render(d, { email: d.test_to, name: req.user.full_name }));
      flash(req, 'success', req.t('ml.test_sent', { to: d.test_to }));
    } catch (e) {
      flash(req, 'error', req.t('ml.err_send', { error: e.message }));
    }
    res.redirect('/admin/mailing');
  });

  admin.post('/send', (req, res) => {
    const d = readDraft(req.body);
    req.session.mailingDraft = d;
    if (!d.subject || !d.body) { flash(req, 'error', req.t('ml.err_required')); return res.redirect('/admin/mailing'); }
    if (!email.ready()) { flash(req, 'error', req.t('ml.err_not_ready')); return res.redirect('/admin/mailing'); }
    if (req.body.confirm !== 'on') { flash(req, 'error', req.t('ml.err_confirm')); return res.redirect('/admin/mailing'); }
    const { total } = mailing.start(db, req.user.id, d);
    delete req.session.mailingDraft;
    flash(req, 'success', req.t('ml.started', { n: total }));
    res.redirect('/admin/mailing');
  });

  admin.post('/reset', (req, res) => {
    delete req.session.mailingDraft;
    res.redirect('/admin/mailing');
  });

  return router;
};
