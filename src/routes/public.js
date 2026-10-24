'use strict';
const path = require('node:path');
const express = require('express');
const config = require('../config');
const alerts = require('../alerts');
const practice = require('../practice');

const PAGE_SIZE = 50;

// Some register notes carry a phone number; strip it wherever contacts are hidden.
const hideNumbers = (s) => (s || '').replace(/(?:\+?257[\s.]?)?\b\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}\b/g, '').replace(/\s{2,}/g, ' ').trim();

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

  // Installable web app: manifest, service worker, install guide and offline page.
  router.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').json({
      name: config.appName,
      short_name: 'Docteurs',
      description: req.t('install.lead'),
      lang: res.locals.lang,
      start_url: '/?source=app',
      scope: '/',
      display: 'standalone',
      background_color: '#f2f3f7',
      theme_color: '#2a4a9e',
      icons: [
        { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/static/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });
  router.get('/sw.js', (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'sw.js'));
  });
  router.get('/practice', async (req, res) => {
    const feed = await practice.articles();
    const articles = res.locals.lang === 'fr' ? await practice.translate(feed.articles) : feed.articles;
    res.render('practice', { title: req.t('practice.title'), feed: { ...feed, articles } });
  });

  router.get('/install', (req, res) => res.render('install', { title: req.t('install.title') }));
  router.get('/offline', (req, res) => res.render('error', { title: req.t('install.offline_title'), message: req.t('install.offline') }));

  // Shared by the directory page and the public JSON feed used by the Wix site.
  function search(query) {
    const q = String(query.q || '').trim().slice(0, 80);
    const list = ['definitive', 'provisional', 'members'].includes(query.list) ? query.list : 'all';
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);

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
    const updated = db.prepare("SELECT value FROM meta WHERE key = 'register_updated_at'").get()?.value;
    return { q, list, page, rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), updated };
  }

  router.get('/directory', (req, res) => {
    const result = search(req.query);
    // Contact details are for signed-in members only.
    if (!req.user) for (const r of result.rows) { r.phone = null; r.email = null; r.notes = hideNumbers(r.notes); }
    res.render('directory', { title: req.t('dir.title'), ...result });
  });

  // Public, read-only feed for the Wix site. Never includes contact details.
  router.get('/api/register', (req, res) => {
    const { q, list, page, rows, total, pages, updated } = search(req.query);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      q, list, page, pages, total, updated,
      rows: rows.map((r) => ({
        order_no: r.order_no, name: r.name, notes: hideNumbers(r.notes), list: r.list, struck_off: !!r.struck_off,
        member: r.member_id != null, specialty: r.specialty || null, city: r.city || null,
      })),
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
module.exports.hideNumbers = hideNumbers;
