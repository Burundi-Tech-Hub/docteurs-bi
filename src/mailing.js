'use strict';
// Mailing list to the doctors whose email address is on the CNOMB register.
// These doctors did not sign up for it, so every email says why they receive it and carries
// a personal link to confirm or unsubscribe; unsubscribed addresses are never mailed again.
const crypto = require('node:crypto');
const config = require('./config');
const email = require('./drivers/email');

const AUDIENCES = ['all', 'confirmed'];

const norm = (e) => String(e || '').trim().toLowerCase();

// Personal link token: the address plus a signature, so nobody can unsubscribe someone else.
function sign(addr) {
  return crypto.createHmac('sha256', config.sessionSecret).update(`mailing:${norm(addr)}`).digest('base64url').slice(0, 22);
}
function token(addr) {
  return `${Buffer.from(norm(addr)).toString('base64url')}.${sign(addr)}`;
}
function readToken(t) {
  const [b64, sig] = String(t || '').split('.');
  if (!b64 || !sig) return null;
  const addr = Buffer.from(b64, 'base64url').toString('utf8');
  const good = sign(addr);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? addr : null;
}
const prefsUrl = (addr) => `${config.baseUrl}/liste/${token(addr)}`;

function setStatus(db, addr, status) {
  db.prepare(`INSERT INTO mailing_prefs (email, status) VALUES (?, ?)
    ON CONFLICT (email) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`).run(norm(addr), status);
}
const statusOf = (db, addr) => db.prepare('SELECT status FROM mailing_prefs WHERE email = ?').get(norm(addr))?.status || null;

// One row per distinct address on the register (not struck off), minus unsubscribed ones.
function audience(db, which = 'all') {
  const rows = db.prepare(`SELECT lower(trim(r.email)) AS email, min(r.name) AS name
    FROM register_entries r LEFT JOIN mailing_prefs p ON p.email = lower(trim(r.email))
    WHERE r.email IS NOT NULL AND r.email != '' AND r.struck_off = 0
      AND coalesce(p.status, '') != 'unsubscribed' ${which === 'confirmed' ? "AND p.status = 'subscribed'" : ''}
    GROUP BY lower(trim(r.email)) ORDER BY 1`).all();
  return rows;
}

function stats(db) {
  const c = (sql) => db.prepare(sql).get().n;
  return {
    onRegister: c("SELECT count(DISTINCT lower(trim(email))) AS n FROM register_entries WHERE email IS NOT NULL AND email != '' AND struck_off = 0"),
    all: audience(db, 'all').length,
    confirmed: audience(db, 'confirmed').length,
    unsubscribed: c("SELECT count(*) AS n FROM mailing_prefs WHERE status = 'unsubscribed'"),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Fills {nom}, {inscription} and {confirmer}, and appends the footer every email must carry.
function render(m, to) {
  const link = prefsUrl(to.email);
  const fill = (s) => s
    .replaceAll('{nom}', to.name ? `Dr ${to.name}` : 'Docteur')
    .replaceAll('{inscription}', `${config.baseUrl}/register`)
    .replaceAll('{confirmer}', link);
  const subject = fill(m.subject);
  const body = fill(m.body);
  const footer = `—\nVous recevez ce message car votre adresse figure au tableau public de l’Ordre des Médecins du Burundi (cnomb.bi). `
    + `Rester inscrit ou se désinscrire : ${link}\n`
    + `You are receiving this because your address is on the public register of the Burundi Medical Council (cnomb.bi). `
    + `Stay subscribed or unsubscribe: ${link}`;
  const text = `${body}\n\n${footer}`;
  const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a2350;max-width:620px">${linkify(body)}`
    + `<p style="margin-top:28px;font-size:12px;color:#6b7091">${linkify(footer)}</p></div>`;
  return { to: to.email, name: to.name, subject, text, html, unsubscribeUrl: link };
}

const running = new Set();

// Sends the pending recipients of a mailing at the configured pace. Safe to call again (resumes).
async function run(db, mailingId, sendImpl = email.send) {
  if (running.has(mailingId)) return;
  running.add(mailingId);
  try {
    const m = db.prepare('SELECT * FROM mailings WHERE id = ?').get(mailingId);
    const pending = db.prepare("SELECT * FROM mailing_recipients WHERE mailing_id = ? AND status = 'pending' ORDER BY email").all(mailingId);
    const mark = db.prepare("UPDATE mailing_recipients SET status = ?, error = ?, sent_at = datetime('now') WHERE mailing_id = ? AND email = ?");
    const gap = config.email.perMinute > 0 ? 60e3 / config.email.perMinute : 0;
    for (const r of pending) {
      // Someone may have unsubscribed after the mailing started.
      if (statusOf(db, r.email) === 'unsubscribed') { mark.run('skipped', null, mailingId, r.email); continue; }
      try {
        await sendImpl(render(m, r));
        mark.run('sent', null, mailingId, r.email);
      } catch (e) {
        mark.run('failed', String(e.message).slice(0, 300), mailingId, r.email);
      }
      if (gap) await new Promise((ok) => setTimeout(ok, gap));
    }
    db.prepare("UPDATE mailings SET status = 'sent', finished_at = datetime('now') WHERE id = ?").run(mailingId);
  } finally {
    running.delete(mailingId);
  }
}

// Creates the mailing with a frozen recipient list and starts sending in the background.
function start(db, userId, { subject, body, audience: which }, sendImpl) {
  const list = audience(db, which);
  const { lastInsertRowid } = db.prepare('INSERT INTO mailings (subject, body, audience, created_by) VALUES (?, ?, ?, ?)').run(subject, body, which, userId);
  const id = Number(lastInsertRowid);
  const ins = db.prepare('INSERT OR IGNORE INTO mailing_recipients (mailing_id, email, name) VALUES (?, ?, ?)');
  for (const r of list) ins.run(id, r.email, r.name || '');
  const done = run(db, id, sendImpl).catch((e) => console.error('mailing', id, e));
  return { id, total: list.length, done };
}

// After a restart, finish mailings that were cut off.
function resume(db) {
  for (const { id } of db.prepare("SELECT id FROM mailings WHERE status = 'sending'").all()) {
    run(db, id).catch((e) => console.error('mailing', id, e));
  }
}

const INVITATION = {
  subject: 'Invitation : rejoignez Mess des Docteurs, le réseau des médecins du Burundi / Join Doctor’s Mess',
  body: `Cher confrère, chère consœur,

Mess des Docteurs est un réseau indépendant réservé aux médecins du Burundi inscrits à l’Ordre. Vous y trouverez :
- l’annuaire des médecins inscrits au tableau du CNOMB ;
- une adresse e-mail professionnelle à votre nom ;
- des discussions confidentielles entre confrères ;
- des publications médicales évaluées par les pairs ;
- les alertes de santé publique (OMS, épidémies dans la région).

L’inscription est gratuite, avec votre numéro de téléphone : {inscription}

Pour continuer à recevoir nos nouvelles par e-mail, confirmez votre inscription. Pour ne plus rien recevoir, désinscrivez-vous en un clic : {confirmer}

Confraternellement,
L’équipe Mess des Docteurs

---

Dear colleague,

Doctor’s Mess is an independent network for Burundi’s doctors on the Medical Council register: the CNOMB directory, a professional email address, private discussions between colleagues, peer-reviewed publications and public health alerts.

Joining is free, with your phone number: {inscription}

To keep receiving our news by email, please confirm. To receive nothing more, unsubscribe in one click: {confirmer}`,
};

module.exports = { AUDIENCES, token, readToken, prefsUrl, setStatus, statusOf, audience, stats, render, run, start, resume, INVITATION, norm };
