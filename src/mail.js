'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const mailbox = require('./drivers/mailbox');
const sms = require('./drivers/sms');

const RESERVED = new Set(['admin', 'administrator', 'postmaster', 'abuse', 'info', 'contact', 'support', 'noreply',
  'no-reply', 'webmaster', 'hostmaster', 'root', 'security', 'cnomb', 'ordre', 'secretariat', 'president']);
const LOCAL = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.')
  .replace(/^\.+|\.+$/g, '');

// "NIZIGAMA Jean Pierre" -> "jean.pierre.nizigama" (register names put the surname first, in capitals).
function suggestLocalPart(fullName) {
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const surname = words.filter((w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w));
  const given = words.filter((w) => !surname.includes(w));
  const parts = surname.length && given.length ? [...given, ...surname] : words;
  return fold(parts.join(' ')).slice(0, 40) || 'docteur';
}

function validateLocalPart(local) {
  return local.length >= 3 && local.length <= 40 && LOCAL.test(local) && !RESERVED.has(local);
}

// Creates the mailbox at the provider and texts the member a temporary password.
async function provision(db, mailboxId) {
  const row = db.prepare(`SELECT m.*, u.full_name, u.phone FROM mailboxes m JOIN users u ON u.id = m.user_id
    WHERE m.id = ?`).get(mailboxId);
  if (!row) throw new Error('mailbox not found');
  const password = crypto.randomBytes(9).toString('base64url');
  try {
    await mailbox.createMailbox({ localPart: row.address.split('@')[0], name: row.full_name, password });
    db.prepare("UPDATE mailboxes SET status = 'active', error = NULL, activated_at = datetime('now') WHERE id = ?").run(row.id);
    const where = config.mail.webmailUrl ? ` ${config.mail.webmailUrl}` : '';
    await sms.send(row.phone, `${config.appName}: ${row.address} est active / is active. Mot de passe provisoire / temporary password: ${password}${where}`)
      .catch((e) => console.error('mailbox sms failed', e));
    return password;
  } catch (e) {
    console.error(e);
    db.prepare("UPDATE mailboxes SET status = 'error', error = ? WHERE id = ?").run(String(e.message).slice(0, 500), row.id);
    return null;
  }
}

module.exports = { suggestLocalPart, validateLocalPart, provision };
