'use strict';
const path = require('node:path');

// Minimal .env loader so the app runs without extra dependencies.
function loadDotEnv(file) {
  const fs = require('node:fs');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  appName: env.APP_NAME || 'Mess des Docteurs',
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  isProd: env.NODE_ENV === 'production',
  sessionSecret: env.SESSION_SECRET || 'dev-only-change-me',
  dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'app.db'),
  // Phone numbers (E.164) that become admins when they register.
  adminPhones: list(env.ADMIN_PHONES),

  sms: {
    driver: env.SMS_DRIVER || 'console', // console | africastalking | twilio
    senderId: env.SMS_SENDER_ID || '',
    atUsername: env.AT_USERNAME || '',
    atApiKey: env.AT_API_KEY || '',
    twilioSid: env.TWILIO_ACCOUNT_SID || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: env.TWILIO_FROM || '',
  },

  mail: {
    driver: env.MAIL_DRIVER || 'console', // console | mailcow
    domain: env.MAIL_DOMAIN || 'medecins.bi',
    webmailUrl: env.WEBMAIL_URL || '',
    autoApprove: env.MAIL_AUTO_APPROVE === 'true',
    quotaMb: Number(env.MAIL_QUOTA_MB || 2048),
    mailcowUrl: (env.MAILCOW_URL || '').replace(/\/$/, ''),
    mailcowApiKey: env.MAILCOW_API_KEY || '',
  },

  cnomb: {
    ajaxUrl: env.CNOMB_AJAX_URL || 'https://cnomb.bi/wp-admin/admin-ajax.php',
    definitiveTableId: env.CNOMB_TABLE_DEFINITIVE || '274',
    provisionalTableId: env.CNOMB_TABLE_PROVISIONAL || '194',
  },
};
