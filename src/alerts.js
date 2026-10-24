'use strict';
// Public health alerts: shown on every page while active, pushed live to connected
// members, and optionally broadcast by SMS.
const config = require('./config');
const sms = require('./drivers/sms');

const LEVELS = ['info', 'warning', 'emergency'];
const CATEGORIES = ['pandemic', 'outbreak', 'vaccination', 'disaster', 'other'];
const SMS_CONCURRENCY = 5;

let io = null; // set by chat.attach so new alerts reach open pages

const ACTIVE_WHERE = "ended_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))";

function active(db) {
  return db.prepare(`SELECT * FROM alerts WHERE ${ACTIVE_WHERE}
    ORDER BY CASE level WHEN 'emergency' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, id DESC`).all();
}

// Phone numbers for an SMS audience, without duplicates.
function recipients(db, audience) {
  if (audience === 'none') return [];
  const phones = new Set(db.prepare("SELECT phone FROM users WHERE status = 'active' AND sms_alerts = 1").all().map((r) => r.phone));
  if (audience === 'members_register') {
    // Register doctors who are not members yet; members who opted out stay excluded.
    const optedOut = new Set(db.prepare('SELECT phone FROM users WHERE sms_alerts = 0 OR status != \'active\'').all().map((r) => r.phone));
    for (const { phone } of db.prepare('SELECT DISTINCT phone FROM register_entries WHERE phone IS NOT NULL AND struck_off = 0').all()) {
      if (!optedOut.has(phone)) phones.add(phone);
    }
  }
  return [...phones];
}

function smsText(alert) {
  const tag = alert.level === 'emergency' ? 'URGENCE SANTÉ' : 'ALERTE SANTÉ';
  const link = `${config.baseUrl}/alerts/${alert.id}`;
  const room = 459 - tag.length - alert.title.length - link.length - 8; // stay within 3 SMS parts
  const body = alert.body.length > room ? alert.body.slice(0, Math.max(0, room - 1)) + '…' : alert.body;
  return `[${tag}] ${alert.title}: ${body} ${link}`;
}

async function broadcast(db, alertId, sendImpl = sms.send) {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
  const phones = recipients(db, alert.sms_audience);
  db.prepare('UPDATE alerts SET sms_total = ? WHERE id = ?').run(phones.length, alertId);
  const text = smsText(alert);
  const sent = db.prepare('UPDATE alerts SET sms_sent = sms_sent + 1 WHERE id = ?');
  const failed = db.prepare('UPDATE alerts SET sms_failed = sms_failed + 1 WHERE id = ?');
  let next = 0;
  const worker = async () => {
    while (next < phones.length) {
      const to = phones[next++];
      try {
        await sendImpl(to, text);
        sent.run(alertId);
      } catch (e) {
        console.error(`alert ${alertId} sms to ${to} failed:`, e.message);
        failed.run(alertId);
      }
    }
  };
  await Promise.all(Array.from({ length: SMS_CONCURRENCY }, worker));
}

// Creates the alert, pushes it to open pages and starts the SMS broadcast in the background.
function publish(db, userId, input) {
  const hours = Number(input.expires_hours);
  const info = db.prepare(`INSERT INTO alerts (title, body, level, category, created_by, expires_at, sms_audience)
    VALUES (?, ?, ?, ?, ?, CASE WHEN ? > 0 THEN datetime('now', '+' || ? || ' hours') END, ?)`)
    .run(input.title, input.body, input.level, input.category, userId, hours || 0, hours || 0, input.sms_audience);
  const id = Number(info.lastInsertRowid);
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  io?.emit('alert', { id, title: alert.title, level: alert.level });
  const done = alert.sms_audience === 'none' ? Promise.resolve() : broadcast(db, id).catch((e) => console.error(e));
  return { alert, done };
}

function end(db, id) {
  db.prepare("UPDATE alerts SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL").run(id);
}

function setIo(server) { io = server; }

module.exports = { LEVELS, CATEGORIES, ACTIVE_WHERE, active, recipients, smsText, broadcast, publish, end, setIo };
