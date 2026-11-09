'use strict';
const express = require('express');
const config = require('../config');
const specialties = require('../specialties');
const publicHealth = require('../public-health');
const { flash, requireUser, requireAdmin } = require('../app');

// Publications. Members email their articles; an admin enters each one, commissions peer
// reviewers for the current round, reads their reviews and makes the editorial decision.
// A revised manuscript (sent by email again) starts a new round with fresh reviews.
const DECISIONS = ['accept', 'revise', 'reject'];
const EDITOR_STATUSES = ['published', 'revision', 'rejected', 'hidden'];

module.exports = function articleRoutes(db) {
  const router = express.Router();

  const get = (id) => db.prepare('SELECT * FROM publications WHERE id = ?').get(Number(id));
  const isAssigned = (p, user) => !!user && !!db.prepare('SELECT 1 FROM publication_reviewers WHERE publication_id = ? AND reviewer_id = ? AND round = ?').get(p.id, user.id, p.round);
  const toReviewSql = `SELECT p.* FROM publications p JOIN publication_reviewers a ON a.publication_id = p.id AND a.round = p.round
    WHERE a.reviewer_id = :me AND p.status = 'review'
      AND NOT EXISTS (SELECT 1 FROM publication_reviews r WHERE r.publication_id = p.id AND r.round = p.round AND r.reviewer_id = :me)
    ORDER BY a.assigned_at, p.id`;
  const dateOf = (p) => p.decided_at || p.created_at;

  router.get('/publications', (req, res) => {
    const counts = Object.fromEntries(db.prepare("SELECT specialty, count(*) AS n FROM publications WHERE status = 'published' GROUP BY specialty").all().map((r) => [r.specialty, r.n]));
    const recent = db.prepare("SELECT * FROM publications WHERE status = 'published' ORDER BY decided_at DESC, id DESC LIMIT 6").all();
    const toReview = req.user ? db.prepare(toReviewSql).all({ me: req.user.id }).length : 0;
    res.render('publications', { title: req.t('pub.title'), medicine: specialties.medicine, surgery: specialties.surgery, counts, recent, toReview, bySlug: specialties.bySlug, dateOf });
  });

  router.get('/publications/submit', (req, res) => {
    res.render('publication-submit', { title: req.t('pub.submit_title'), email: config.publicationsEmail });
  });

  router.get('/publications/s/:slug', (req, res, next) => {
    const s = specialties.bySlug.get(req.params.slug);
    if (!s) return next();
    const list = db.prepare("SELECT * FROM publications WHERE specialty = ? AND status = 'published' ORDER BY decided_at DESC, id DESC LIMIT 200").all(s.slug);
    res.render('publication-specialty', { title: s.name[res.locals.lang] || s.name.fr, s, list, dateOf });
  });

  // Published articles are public; an article under review is visible to the admins and its commissioned reviewers.
  router.get('/publications/a/:id', (req, res, next) => {
    const p = get(req.params.id);
    if (!p) return next();
    const isAdmin = req.user?.role === 'admin';
    const assigned = isAssigned(p, req.user);
    if (p.status !== 'published' && !isAdmin && !assigned) return next();
    const mine = assigned ? db.prepare('SELECT * FROM publication_reviews WHERE publication_id = ? AND round = ? AND reviewer_id = ?').get(p.id, p.round, req.user.id) : null;
    res.render('publication-article', { title: p.title, p, s: specialties.bySlug.get(p.specialty), isAdmin, canReview: assigned && p.status === 'review', mine, dateOf });
  });

  router.get('/publications/review', requireUser, (req, res) => {
    const list = db.prepare(toReviewSql).all({ me: req.user.id });
    res.render('publication-review', { title: req.t('pub.review_title'), list, bySlug: specialties.bySlug });
  });

  router.post('/publications/a/:id/review', requireUser, (req, res, next) => {
    const p = get(req.params.id);
    if (!p) return next();
    if (!isAssigned(p, req.user) || p.status !== 'review') {
      flash(req, 'error', req.t('pub.cannot_review'));
      return res.redirect('/publications/review');
    }
    const decision = String(req.body.decision || '');
    const comments = String(req.body.comments || '').trim().slice(0, 5000);
    if (!DECISIONS.includes(decision) || (decision !== 'accept' && !comments)) {
      flash(req, 'error', req.t('pub.err_review'));
      return res.redirect(`/publications/a/${p.id}#review`);
    }
    db.prepare(`INSERT INTO publication_reviews (publication_id, reviewer_id, round, decision, comments) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (publication_id, reviewer_id, round) DO UPDATE SET decision = excluded.decision, comments = excluded.comments, created_at = datetime('now')`)
      .run(p.id, req.user.id, p.round, decision, comments);
    flash(req, 'success', req.t('pub.review_saved'));
    res.redirect('/publications/review');
  });

  // Editorial desk.
  const admin = express.Router();
  admin.use(requireAdmin);

  function readForm(b) {
    return {
      author_id: Number(b.author_id) || null,
      author_name: String(b.author_name || '').trim().slice(0, 160),
      specialty: String(b.specialty || ''),
      title: String(b.title || '').trim().slice(0, 200),
      summary: String(b.summary || '').trim().slice(0, 1500),
      body: String(b.body || '').trim().slice(0, 30000),
      link: String(b.link || '').trim().slice(0, 500),
      public_health: b.public_health === 'on',
    };
  }

  function checkForm(form) {
    if (form.author_id) {
      const u = db.prepare('SELECT full_name FROM users WHERE id = ?').get(form.author_id);
      if (!u) form.author_id = null;
      else if (!form.author_name) form.author_name = u.full_name;
    }
    if (!form.author_name) return 'pub.err_author';
    if (!specialties.bySlug.has(form.specialty)) return 'pub.err_specialty';
    if (!form.title || !form.summary) return 'pub.err_required';
    if (form.link && !/^https?:\/\/\S+$/i.test(form.link)) return 'pub.err_link';
    return null;
  }

  const members = () => db.prepare("SELECT id, full_name FROM users WHERE status = 'active' ORDER BY full_name").all();

  admin.get('/', (req, res) => {
    const list = db.prepare(`SELECT p.*,
        (SELECT count(*) FROM publication_reviewers a WHERE a.publication_id = p.id AND a.round = p.round) AS assigned_n,
        (SELECT count(*) FROM publication_reviews r WHERE r.publication_id = p.id AND r.round = p.round) AS reviews_n
      FROM publications p ORDER BY (p.status IN ('review', 'revision')) DESC, p.id DESC LIMIT 300`).all();
    res.render('admin-articles', { title: req.t('pub.admin_title'), list, bySlug: specialties.bySlug, email: config.publicationsEmail });
  });

  admin.get('/new', (req, res) => {
    const form = { author_id: null, author_name: '', specialty: '', title: '', summary: '', body: '', link: '', public_health: false, ...(req.session.articleDraft || {}) };
    delete req.session.articleDraft;
    res.render('admin-article-form', { title: req.t('pub.new_title'), form, p: null, members: members(), medicine: specialties.medicine, surgery: specialties.surgery });
  });

  admin.post('/new', (req, res) => {
    const form = readForm(req.body);
    const error = checkForm(form);
    if (error) {
      req.session.articleDraft = form;
      flash(req, 'error', req.t(error));
      return res.redirect('/admin/articles/new');
    }
    const { lastInsertRowid } = db.prepare(`INSERT INTO publications (author_name, author_id, specialty, title, summary, body, link, public_health, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(form.author_name, form.author_id, form.specialty, form.title, form.summary, form.body, form.link || null,
      publicHealth.flagArticle(form, form.public_health), req.user.id);
    flash(req, 'success', req.t('pub.created'));
    res.redirect(`/admin/articles/${lastInsertRowid}`);
  });

  admin.get('/:id', (req, res, next) => {
    const p = get(req.params.id);
    if (!p) return next();
    const assigned = db.prepare(`SELECT a.round, u.id, u.full_name,
        (SELECT decision FROM publication_reviews r WHERE r.publication_id = a.publication_id AND r.reviewer_id = a.reviewer_id AND r.round = a.round) AS decision
      FROM publication_reviewers a JOIN users u ON u.id = a.reviewer_id WHERE a.publication_id = ? AND a.round = ? ORDER BY a.assigned_at`).all(p.id, p.round);
    const reviews = db.prepare(`SELECT r.*, u.full_name AS reviewer FROM publication_reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.publication_id = ? ORDER BY r.round DESC, r.id`).all(p.id);
    const candidates = members().filter((m) => m.id !== p.author_id && !assigned.some((a) => a.id === m.id));
    res.render('admin-article', {
      title: p.title, p, s: specialties.bySlug.get(p.specialty), assigned, reviews, candidates, members: members(),
      form: p, medicine: specialties.medicine, surgery: specialties.surgery,
    });
  });

  admin.post('/:id/edit', (req, res, next) => {
    const p = get(req.params.id);
    if (!p) return next();
    const form = readForm(req.body);
    const error = checkForm(form);
    if (error) {
      flash(req, 'error', req.t(error));
      return res.redirect(`/admin/articles/${p.id}`);
    }
    // A revised manuscript starts a new round: reviewers are commissioned again and earlier verdicts stay on record.
    const newRound = req.body.new_round === '1';
    db.prepare(`UPDATE publications SET author_name = ?, author_id = ?, specialty = ?, title = ?, summary = ?, body = ?, link = ?, public_health = ?,
        round = round + ?, status = CASE WHEN ? THEN 'review' ELSE status END, updated_at = datetime('now') WHERE id = ?`)
      .run(form.author_name, form.author_id, form.specialty, form.title, form.summary, form.body, form.link || null,
        publicHealth.flagArticle(form, form.public_health), newRound ? 1 : 0, newRound ? 1 : 0, p.id);
    flash(req, 'success', req.t(newRound ? 'pub.new_round_started' : 'pub.saved'));
    res.redirect(`/admin/articles/${p.id}`);
  });

  admin.post('/:id/reviewers', (req, res, next) => {
    const p = get(req.params.id);
    if (!p) return next();
    const reviewerId = Number(req.body.reviewer_id);
    if (reviewerId && reviewerId !== p.author_id && db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(reviewerId)) {
      db.prepare('INSERT OR IGNORE INTO publication_reviewers (publication_id, reviewer_id, round) VALUES (?, ?, ?)').run(p.id, reviewerId, p.round);
      flash(req, 'success', req.t('pub.reviewer_added'));
    }
    res.redirect(`/admin/articles/${p.id}`);
  });

  admin.post('/:id/reviewers/:uid/remove', (req, res, next) => {
    const p = get(req.params.id);
    if (!p) return next();
    db.prepare('DELETE FROM publication_reviewers WHERE publication_id = ? AND reviewer_id = ? AND round = ?').run(p.id, Number(req.params.uid), p.round);
    res.redirect(`/admin/articles/${p.id}`);
  });

  admin.post('/:id/status/:status', (req, res, next) => {
    const p = get(req.params.id);
    if (!p) return next();
    if (EDITOR_STATUSES.includes(req.params.status)) {
      db.prepare("UPDATE publications SET status = ?, decided_at = datetime('now') WHERE id = ?").run(req.params.status, p.id);
      flash(req, 'success', req.t('pub.status_set', { status: req.t('pub.status_' + req.params.status) }));
    }
    res.redirect(`/admin/articles/${p.id}`);
  });

  router.use('/admin/articles', admin);
  return router;
};
