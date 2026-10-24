'use strict';
// One-time SMS codes for phone verification and password reset.
const crypto = require('node:crypto');
const sms = require('./drivers/sms');

const TTL_MS = 10 * 60e3;
const RESEND_MS = 60e3;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');

class OtpError extends Error {}

async function issue(db, phone, purpose, appName) {
  const now = Date.now();
  const recent = db.prepare('SELECT created_at FROM otp_codes WHERE phone = ? AND created_at > ? ORDER BY created_at DESC')
    .all(phone, now - 3600e3);
  if (recent.length && now - recent[0].created_at < RESEND_MS) throw new OtpError('otp.wait');
  if (recent.length >= MAX_PER_HOUR) throw new OtpError('otp.too_many');

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ? AND expires_at < ?').run(phone, purpose, now);
  db.prepare('INSERT INTO otp_codes (phone, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(phone, purpose, hash(code), now + TTL_MS, now);
  await sms.send(phone, `${appName}: votre code est ${code} (valide 10 min). Your code is ${code}.`);
  return code;
}

// Returns true when the code matches the latest unexpired code; consumes it.
function verify(db, phone, purpose, code) {
  const row = db.prepare(`SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1`).get(phone, purpose, Date.now());
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;
  const given = hash(String(code || '').replace(/\D/g, ''));
  const ok = crypto.timingSafeEqual(Buffer.from(given), Buffer.from(row.code_hash));
  if (ok) db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ?').run(phone, purpose);
  else db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  return ok;
}

module.exports = { issue, verify, OtpError };
