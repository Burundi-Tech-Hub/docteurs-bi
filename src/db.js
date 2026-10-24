'use strict';
const fs = require('node:fs');
const path = require('node:path');

// node:sqlite prints an experimental warning once; it is stable enough for this use.
process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Doctors listed by the Conseil National de l'Ordre des Médecins du Burundi (CNOMB).
CREATE TABLE IF NOT EXISTS register_entries (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  list TEXT NOT NULL CHECK (list IN ('definitive','provisional')),
  order_no TEXT NOT NULL DEFAULT '',
  raw_name TEXT NOT NULL,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  phone TEXT,            -- E.164, used only to match members to their entry
  email TEXT,            -- kept private, never shown publicly
  struck_off INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (list, source_id)
);
CREATE INDEX IF NOT EXISTS idx_register_name ON register_entries(name);
CREATE INDEX IF NOT EXISTS idx_register_phone ON register_entries(phone);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  phone_verified_at TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  specialty TEXT NOT NULL DEFAULT '',
  workplace TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  register_entry_id INTEGER UNIQUE REFERENCES register_entries(id),
  register_link TEXT NOT NULL DEFAULT 'none' CHECK (register_link IN ('none','auto','claimed','approved')),
  invited_by INTEGER REFERENCES users(id),
  lang TEXT NOT NULL DEFAULT 'fr',
  sms_alerts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, purpose);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  inviter_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  sms_sent INTEGER NOT NULL DEFAULT 0,
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  address TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','active','rejected','error')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_dm INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);

-- Public health alerts (pandemics, outbreaks, emergencies), optionally broadcast by SMS.
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'warning' CHECK (level IN ('info','warning','emergency')),
  category TEXT NOT NULL DEFAULT 'other',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  ended_at TEXT,
  sms_audience TEXT NOT NULL DEFAULT 'none' CHECK (sms_audience IN ('none','members','members_register')),
  sms_total INTEGER NOT NULL DEFAULT 0,
  sms_sent INTEGER NOT NULL DEFAULT 0,
  sms_failed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

const DEFAULT_CHANNELS = [
  ['general', 'Général', 'Discussions entre confrères / General discussion'],
  ['cas-cliniques', 'Cas cliniques', 'Avis sur des cas (anonymisés) / Case discussions, anonymised'],
  ['emplois', 'Emplois & formations', 'Postes, gardes, formations / Jobs and training'],
];

const fold = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Accent- and case-insensitive text for name searches ("andre" finds "André").
  db.function('fold', { deterministic: true }, (v) => fold(v));
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO channels (slug, name, description) VALUES (?, ?, ?)');
  for (const c of DEFAULT_CHANNELS) ins.run(...c);
  return db;
}

// Run fn inside a transaction.
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { fold, open, tx };
