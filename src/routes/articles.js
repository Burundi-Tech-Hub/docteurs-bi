'use strict';
const express = require('express');
const config = require('../config');
const specialties = require('../specialties');
const { flash, requireUser, requireAdmin } = require('../app');

// Members' articles go through peer review. Reviewers are admins plus members an admin
// has named; nobody reviews their own article. Each submission round is reviewed afresh:
//   - any "revise" sends it back to the author, who edits and resubmits (next round);
//   - config.reviewsNeeded "accept"s publish it, the same number of "reject"s turn it down.
// Admins act as editors and can publish, reject or hide an article directly.
const DECISIONS = ['accept', 'revise', 'reject'];
const EDITOR_STATUSES = ['published', 'rejected', 'hidden', 'review'];

module.exports = function articleRoutes(db) {
  const router = express.Router();

  const withAuthor = 'SELECT a.*, u.full_name AS author FROM articles a JOIN users u ON u.id = a.user_id';
  const isReviewer = (user) => !!user && (user.role === 'admin' || !!db.prepare('SELECT 1 FROM reviewers WHERE user_id = ?').get(user.id));
  const reviewsOf = (a) => db.prepare('SELECT * FROM article_reviews WHERE article_id = ? ORDER BY round, id').all(a.id);
  const toReviewSql = `${withAuthor} WHERE a.status = 'review' AND a.user_id != :me
    AND NOT EXISTS (SELECT 1 FROM article_reviews r WHERE r.article_id = a.id AND r.round = a.round AND r.reviewer_id = :me)
    ORDER BY a.updated_at, a.id`;

  function readForm(b) {
    return {
      specialty: String(b.specialty || ''),
      title: String(b.title || '').trim().slice(0, 200),
      summary: String(b.summary || '').trim().slice(0, 1500),
      body: String(b.body || '').trim().slice(0, 30000),
      link: String(b.link || '').trim().slice(0, 500),
    };
  }

  function formError(form) {
    if (!specialties.bySlug.has(form.specialty)) return 'pub.err_specialty';
    if (!form.title || !form.summary) return 'pub.err_required';
    if (form.link && !/^https?:\/\/\S+$/i.test(form.link)) return 'pub.err_link';
    return null;
  }

  function renderForm(req, res, form, article = null) {
    res.render('publication-new', {
      title: req.t(article ? 'pub.edit_title' : 'pub.new_title'),
      medicine: specialties.medicine, surgery: specialties.surgery, form, article,
      reviews: article ? reviewsOf(article).filter((r) => r.round === article.round) : [],
    });
  }

  router.get('/publications', (req, res) => {
    const counts = Object.fromEntries(db.prepare("SELECT specialty, count(*) AS n FROM articles WHERE status = 'published' GROUP BY specialty").all().map((r) => [r.specialty, r.n]));
    const recent = db.prepare(`${withAuthor} WHERE a.status = 'published' ORDER BY a.decided_at DESC, a.id DESC LIMIT 6`).all();
    const mine = req.user ? db.prepare("SELECT * FROM articles WHERE user_id = ? AND status != 'published' ORDER BY id DESC").all(req.user.id) : [];
    const toReview = isReviewer(req.user) ? db.prepare(toReviewSql).all({ me: req.user.id }).length : 0;
    res.render('publications', { title: req.t('pub.title'), medicine: specialties.medicine, surgery: specialties.surgery, counts, recent, mine, toReview, bySlug: specialties.bySlug });
  });

  router.get('/publications/new', requireUser, (req, res) => {
    const draft = req.session.articleDraft || {};
    delete req.session.articleDraft;
    const form = { specialty: specialties.bySlug.has(req.query.s) ? req.query.s : '', title: '', summary: '', body: '', link: '', ...draft };
    renderForm(req, res, form);
  });

  router.post('/publications/new', requireUser, (req, res) => {
    const form = readForm(req.body);
    let error = formError(form);
    if (!error && db.prepare("SELECT count(*) AS n FROM articles WHERE user_id = ? AND created_at > datetime('now', '-1 day')").get(req.user.id).n >= 5) error = 'pub.err_rate';
    if (error) {
      req.session.articleDraft = form;
      flash(req, 'error', req.t(error));
      return res.redirect('/publications/new');
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO articles (user_id, specialty, title, summary, body, link) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, form.specialty, form.title, form.summary, form.body, form.link || null);
    flash(req, 'success', req.t('pub.submitted'));
    res.redirect(`/publications/a/${lastInsertRowid}`);
  });

  // The author edits an article that reviewers sent back, then resubmits it for a new round.
  router.get('/publications/a/:id/edit', requireUser, (req, res, next) => {
    const a = db.prepare('SELECT * FROM articles WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!a || !['revision', 'review'].includes(a.status)) return next();
    renderForm(req, res, { specialty: a.specialty, title: a.title, summary: a.summary, body: a.body, link: a.link || '' }, a);
  });

  router.post('/publications/a/:id/edit', requireUser, (req, res, next) => {
    const a = db.prepare('SELECT * FROM articles WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!a || !['revision', 'review'].includes(a.status)) return next();
    const form = readForm(req.body);
    const error = formError(form);
    if (error) {
      flash(req, 'error', req.t(error));
      return res.redirect(`/publications/a/${a.id}/edit`);
    }
    // Any change starts a new review round, so earlier verdicts never count for a text they didn't see.
    const round = a.round + 1;
    db.prepare("UPDATE articles SET specialty = ?, title = ?, summary = ?, body = ?, link = ?, status = 'review', round = ?, updated_at = datetime('now') WHERE id = ?")
      .run(form.specialty, form.title, form.summary, form.body, form.link || null, round, a.id);
    flash(req, 'success', req.t('pub.resubmitted'));
    res.redirect(`/publications/a/${a.id}`);
  });

  router.get('/publications/review', requireUser, (req, res) => {
    if (!isReviewer(req.user)) return res.status(403).render('error', { title: '403', message: req.t('pub.not_reviewer') });
    const list = db.prepare(toReviewSql).all({ me: req.user.id });
    res.render('publication-review', { title: req.t('pub.review_title'), list, bySlug: specialties.bySlug });
  });

  router.post('/publications/a/:id/review', requireUser, (req, res, next) => {
    const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(req.params.id));
    if (!a) return next();
    const decision = String(req.body.decision || '');
    const comments = String(req.body.comments || '').trim().slice(0, 5000);
    if (!isReviewer(req.user) || a.user_id === req.user.id || a.status !== 'review') {
      flash(req, 'error', req.t('pub.cannot_review'));
      return res.redirect(`/publications/a/${a.id}`);
    }
    if (!DECISIONS.includes(decision) || (decision !== 'accept' && !comments)) {
      flash(req, 'error', req.t('pub.err_review'));
      return res.redirect(`/publications/a/${a.id}#review`);
    }
    db.prepare(`INSERT INTO article_reviews (article_id, reviewer_id, round, decision, comments) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (article_id, reviewer_id, round) DO UPDATE SET decision = excluded.decision, comments = excluded.comments, created_at = datetime('now')`)
      .run(a.id, req.user.id, a.round, decision, comments);
    const tally = Object.fromEntries(db.prepare('SELECT decision, count(*) AS n FROM article_reviews WHERE article_id = ? AND round = ? GROUP BY decision').all(a.id, a.round).map((r) => [r.decision, r.n]));
    const next_ = tally.revise ? 'revision'
      : (tally.reject || 0) >= config.reviewsNeeded ? 'rejected'
      : (tally.accept || 0) >= config.reviewsNeeded ? 'published' : 'review';
    if (next_ !== 'review') db.prepare("UPDATE articles SET status = ?, decided_at = datetime('now') WHERE id = ?").run(next_, a.id);
    flash(req, 'success', req.t('pub.review_saved'));
    res.redirect('/publications/review');
  });

  router.get('/publications/s/:slug', (req, res, next) => {
    const s = specialties.bySlug.get(req.params.slug);
    if (!s) return next();
    const list = db.prepare(`${withAuthor} WHERE a.specialty = ? AND a.status = 'published' ORDER BY a.decided_at DESC, a.id DESC LIMIT 200`).all(s.slug);
    res.render('publication-specialty', { title: s.name[res.locals.lang] || s.name.fr, s, list });
  });

  router.get('/publications/a/:id', (req, res, next) => {
    const a = db.prepare(`${withAuthor} WHERE a.id = ?`).get(Number(req.params.id));
    if (!a) return next();
    const isAuthor = a.user_id === req.user?.id;
    const isAdmin = req.user?.role === 'admin';
    const reviewer = isReviewer(req.user) && !isAuthor;
    if (a.status !== 'published' && !isAuthor && !isAdmin && !(reviewer && a.status === 'review')) return next();
    // Reviews are blind: authors see the comments but not who wrote them; admins see names.
    const reviews = (isAuthor || isAdmin) ? db.prepare(`SELECT r.*, u.full_name AS reviewer FROM article_reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.article_id = ? ORDER BY r.round DESC, r.id`).all(a.id) : [];
    const mine = reviewer ? db.prepare('SELECT * FROM article_reviews WHERE article_id = ? AND round = ? AND reviewer_id = ?').get(a.id, a.round, req.user.id) : null;
    res.render('publication-article', {
      title: a.title, a, s: specialties.bySlug.get(a.specialty),
      isAuthor, isAdmin, canReview: reviewer && a.status === 'review', mine, reviews, reviewsNeeded: config.reviewsNeeded,
    });
  });

  router.get('/admin/articles', requireAdmin, (req, res) => {
    const list = db.prepare(`${withAuthor.replace('SELECT a.*', `SELECT a.*, (SELECT count(*) FROM article_reviews r WHERE r.article_id = a.id AND r.round = a.round AND r.decision = 'accept') AS accepts,
      (SELECT count(*) FROM article_reviews r WHERE r.article_id = a.id AND r.round = a.round) AS reviews_n`)}
      ORDER BY (a.status = 'review') DESC, a.id DESC LIMIT 300`).all();
    const reviewers = db.prepare("SELECT full_name FROM users WHERE role = 'admin' OR id IN (SELECT user_id FROM reviewers) ORDER BY full_name").all();
    res.render('admin-articles', { title: req.t('pub.admin_title'), list, reviewers, bySlug: specialties.bySlug, reviewsNeeded: config.reviewsNeeded });
  });

  router.post('/admin/articles/:id/:status', requireAdmin, (req, res) => {
    if (EDITOR_STATUSES.includes(req.params.status)) {
      db.prepare("UPDATE articles SET status = ?, decided_at = datetime('now') WHERE id = ?").run(req.params.status, Number(req.params.id));
    }
    res.redirect('/admin/articles');
  });

  return router;
};
