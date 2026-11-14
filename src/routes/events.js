'use strict';
const express = require('express');
const { flash, requireAdmin } = require('../app');

// Admins keep the list of congresses in Burundi and the region shown on /congres.
const FORMATS = ['onsite', 'online', 'hybrid'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function eventRoutes(db) {
  const router = express.Router();
  router.use(requireAdmin);

  const empty = { title: '', start_date: '', end_date: '', city: '', country: '', format: 'onsite', link: '', notes: '' };

  router.get('/', (req, res) => {
    const list = db.prepare(`SELECT *, coalesce(end_date, start_date) < date('now') AS past FROM events
      ORDER BY past, start_date, id LIMIT 300`).all();
    const edit = req.query.edit ? db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.query.edit)) : null;
    const form = req.session.eventDraft || edit || empty;
    delete req.session.eventDraft;
    res.render('admin-events', { title: req.t('conf.manage'), list, edit, form, formats: FORMATS });
  });

  function read(b) {
    const f = {
      title: String(b.title || '').trim().slice(0, 200),
      start_date: String(b.start_date || '').trim(),
      end_date: String(b.end_date || '').trim() || null,
      city: String(b.city || '').trim().slice(0, 80),
      country: String(b.country || '').trim().slice(0, 80),
      format: FORMATS.includes(b.format) ? b.format : 'onsite',
      link: String(b.link || '').trim().slice(0, 500) || null,
      notes: String(b.notes || '').trim().slice(0, 600),
    };
    let error = null;
    if (!f.title || !DATE.test(f.start_date)) error = 'conf.err_required';
    else if (f.end_date && (!DATE.test(f.end_date) || f.end_date < f.start_date)) error = 'conf.err_dates';
    else if (f.link && !/^https?:\/\/\S+$/i.test(f.link)) error = 'pub.err_link';
    return { f, error };
  }

  router.post('/', (req, res) => {
    const { f, error } = read(req.body);
    if (error) { req.session.eventDraft = f; flash(req, 'error', req.t(error)); return res.redirect('/admin/congres'); }
    db.prepare(`INSERT INTO events (title, start_date, end_date, city, country, format, link, notes, created_by)
      VALUES (:title, :start_date, :end_date, :city, :country, :format, :link, :notes, :uid)`).run({ ...f, uid: req.user.id });
    flash(req, 'success', req.t('conf.saved'));
    res.redirect('/admin/congres');
  });

  router.post('/:id', (req, res) => {
    const id = Number(req.params.id);
    const { f, error } = read(req.body);
    if (error) { flash(req, 'error', req.t(error)); return res.redirect(`/admin/congres?edit=${id}`); }
    db.prepare(`UPDATE events SET title = :title, start_date = :start_date, end_date = :end_date, city = :city, country = :country,
      format = :format, link = :link, notes = :notes WHERE id = :id`).run({ ...f, id });
    flash(req, 'success', req.t('conf.saved'));
    res.redirect('/admin/congres');
  });

  router.post('/:id/delete', (req, res) => {
    db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id));
    res.redirect('/admin/congres');
  });

  return router;
};
