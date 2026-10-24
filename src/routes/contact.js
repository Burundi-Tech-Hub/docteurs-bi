'use strict';
const express = require('express');
const phone = require('../phone');
const { flash } = require('../app');

const TOPICS = ['general', 'register', 'email', 'technical', 'other'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

module.exports = function contactRoutes(db) {
  const router = express.Router();

  router.get('/contact', (req, res) => {
    const draft = req.session.contactDraft || {};
    delete req.session.contactDraft;
    res.render('contact', {
      title: req.t('contact.title'),
      topics: TOPICS,
      form: {
        name: draft.name ?? req.user?.full_name ?? '',
        reply_to: draft.reply_to ?? (req.user ? phone.format(req.user.phone) : ''),
        topic: draft.topic || 'general',
        body: draft.body || '',
      },
    });
  });

  router.post('/contact', (req, res) => {
    const b = req.body;
    // Bots fill the hidden "website" field; pretend success and drop it.
    if (b.website) return res.redirect('/contact?sent=1');
    const form = {
      name: String(b.name || '').trim().slice(0, 120),
      reply_to: String(b.reply_to || '').trim().slice(0, 120),
      topic: TOPICS.includes(b.topic) ? b.topic : 'other',
      body: String(b.body || '').trim().slice(0, 4000),
    };
    const asPhone = phone.normalize(form.reply_to);
    const replyOk = EMAIL.test(form.reply_to) || (asPhone && phone.isBurundi(asPhone)) || /^\+\d{8,15}$/.test(form.reply_to.replace(/[\s.-]/g, ''));
    let error = null;
    if (!form.name || !form.body) error = 'contact.err_required';
    else if (!replyOk) error = 'contact.err_reply';
    else if (db.prepare("SELECT count(*) AS n FROM contact_messages WHERE ip = ? AND created_at > datetime('now', '-1 hour')").get(req.ip).n >= 5) error = 'contact.err_rate';
    if (error) {
      req.session.contactDraft = form;
      flash(req, 'error', req.t(error));
      return res.redirect('/contact');
    }
    if (asPhone && phone.isBurundi(asPhone)) form.reply_to = asPhone;
    db.prepare('INSERT INTO contact_messages (user_id, name, reply_to, topic, body, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user?.id ?? null, form.name, form.reply_to, form.topic, form.body, req.ip);
    flash(req, 'success', req.t('contact.sent'));
    res.redirect('/contact?sent=1');
  });

  return router;
};

module.exports.TOPICS = TOPICS;
