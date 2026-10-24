'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const SqliteStore = require('./session-store');
const { translator, languages } = require('./i18n');
const phone = require('./phone');
const alerts = require('./alerts');

function createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));

  const sessionMiddleware = session({
    store: new SqliteStore(db),
    secret: config.sessionSecret,
    name: 'mdd.sid',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 86400e3 },
  });
  app.use(sessionMiddleware);

  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const countStmt = {
    register: db.prepare('SELECT count(*) AS n FROM register_entries WHERE struck_off = 0'),
    members: db.prepare("SELECT count(*) AS n FROM users WHERE status = 'active'"),
    mailboxes: db.prepare("SELECT count(*) AS n FROM mailboxes WHERE status = 'active'"),
  };

  // Locals shared by every view.
  app.use((req, res, next) => {
    const lang = languages.includes(req.session.lang) ? req.session.lang : 'fr';
    const user = req.session.userId ? userById.get(req.session.userId) : null;
    if (user && user.status !== 'active') {
      delete req.session.userId;
    }
    req.user = user && user.status === 'active' ? user : null;
    req.t = translator(lang);
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(18).toString('base64url');
    Object.assign(res.locals, {
      t: req.t,
      lang,
      user: req.user,
      csrf: req.session.csrf,
      config,
      appName: lang === 'en' ? config.appNameEn : config.appName,
      fmtPhone: phone.format,
      path: req.path,
      flash: req.session.flash || null,
      activeAlerts: alerts.active(db),
      stats: {
        register: countStmt.register.get().n,
        members: countStmt.members.get().n,
        mailboxes: countStmt.mailboxes.get().n,
      },
    });
    delete req.session.flash;
    next();
  });

  // CSRF check for every form post.
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    if (req.body?._csrf !== req.session.csrf) {
      return res.status(403).render('error', { title: req.t('err.csrf'), message: req.t('err.csrf') });
    }
    next();
  });

  app.get('/lang/:lang', (req, res) => {
    if (languages.includes(req.params.lang)) req.session.lang = req.params.lang;
    const back = req.get('referer');
    res.redirect(back && new URL(back, config.baseUrl).host === req.get('host') ? back : '/');
  });

  app.use(require('./routes/public')(db));
  app.use(require('./routes/contact')(db));
  app.use(require('./routes/auth')(db));
  app.use(require('./routes/member')(db));
  app.use('/admin', require('./routes/admin')(db));

  app.use((req, res) => res.status(404).render('error', { title: '404', message: req.t('err.not_found') }));
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).render('error', { title: 'Erreur', message: config.isProd ? 'Erreur interne / Internal error' : err.message });
  });

  return { app, sessionMiddleware };
}

// Helpers for routes.
function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireUser(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(403).render('error', { title: '403', message: req.t('err.forbidden') });
}

module.exports = { createApp, flash, requireUser, requireAdmin };
