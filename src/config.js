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
  appNameEn: env.APP_NAME_EN || 'Doctor\'s Mess',
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

  // Photo behind the home page banner (shown tinted blue).
  homeImage: env.HOME_IMAGE || '/static/img/home.jpg',
  // Changes on every deploy so browsers fetch fresh CSS, JS and images instead of week-old cached copies.
  assetVersion: (env.RENDER_GIT_COMMIT || Date.now().toString(36)).slice(0, 8),
  practice: {
    // Comma-separated RSS feeds shown on "Improve your practice"; Medscape Medical News by default.
    feeds: (env.PRACTICE_FEEDS || 'https://www.medscape.com/cx/rssfeeds/2700.xml').split(',').map((s) => s.trim()).filter(Boolean),
    cacheMinutes: Number(env.PRACTICE_CACHE_MINUTES || 30),
    // Photo beside the page title: a file in public/img/ or a full URL, plus its licence credit.
    image: env.PRACTICE_IMAGE || (require('node:fs').existsSync(path.join(__dirname, '..', 'public', 'img', 'practice.jpg')) ? '/static/img/practice.jpg' : ''),
    imageCredit: env.PRACTICE_IMAGE_CREDIT || '',
    // Optional DeepL key: Medscape headlines and summaries are then shown in French by default.
    deeplKey: env.DEEPL_API_KEY || '',
  },
  cnomb: {
    ajaxUrl: env.CNOMB_AJAX_URL || 'https://cnomb.bi/wp-admin/admin-ajax.php',
    definitiveTableId: env.CNOMB_TABLE_DEFINITIVE || '274',
    provisionalTableId: env.CNOMB_TABLE_PROVISIONAL || '194',
  },
};
