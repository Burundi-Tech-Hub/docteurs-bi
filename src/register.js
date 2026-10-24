'use strict';
// Import of the CNOMB register (https://cnomb.bi/?page_id=75).
// The page renders two Ninja Tables whose rows come from WordPress admin-ajax.
const fs = require('node:fs');
const config = require('./config');
const phone = require('./phone');
const { tx } = require('./db');

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// Register names often carry the graduation date and university after the name,
// e.g. "NIZIGAMA Jean 08/02/1988 UB". Split those into notes.
function splitName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  const struckOff = /\(radi[ée]\)/i.test(s);
  s = s.replace(/\(radi[ée]\)/ig, '').trim();
  const m = s.match(/\s(?=(\d{1,2}\/|\d{4}\b|\d{8}\b|NOV\/|UB\b|UCB\b|UNG\b|UEA\b|U\.?\s|U$))/);
  let name = s;
  let notes = '';
  if (m) {
    name = s.slice(0, m.index).trim();
    notes = s.slice(m.index).trim();
  }
  // Glued forms such as "Arstide23/05/2011 U Marakech".
  const glued = name.match(/^(.*?[A-Za-zÀ-ÿ])(\d{1,2}\/.*)$/);
  if (glued) {
    name = glued[1].trim();
    notes = (glued[2] + ' ' + notes).trim();
  }
  return { name: name || s, notes, struckOff };
}

function cleanPhone(v) {
  const p = phone.normalize(v);
  return p && phone.isBurundi(p) ? p : null;
}

function cleanEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return EMAIL.test(s) ? s : null;
}

// Rows from table 274: { ndordre, nometprenom, email, telephone, ___id___ }
function fromDefinitive(v) {
  const raw = String(v.nometprenom || '').trim();
  if (!raw) return null;
  const { name, notes, struckOff } = splitName(raw);
  return {
    source_id: String(v.___id___),
    list: 'definitive',
    order_no: String(v.ndordre || '').replace(/\s+/g, ' ').trim(),
    raw_name: raw,
    name,
    notes,
    phone: cleanPhone(v.telephone),
    email: cleanEmail(v.email),
    struck_off: struckOff ? 1 : 0,
  };
}

// Rows from table 194: { ninja_column_1: order no, ninja_column_2: name, ___id___ }
function fromProvisional(v) {
  const order = String(v.ninja_column_1 || '').trim();
  const raw = String(v.ninja_column_2 || '').trim();
  if (!raw || /^n[°o]\s*ordre$/i.test(order) || /^nom et pr/i.test(raw)) return null;
  const { name, notes, struckOff } = splitName(raw);
  return {
    source_id: String(v.___id___),
    list: 'provisional',
    order_no: order,
    raw_name: raw,
    name,
    notes,
    phone: null,
    email: null,
    struck_off: struckOff ? 1 : 0,
  };
}

function upsert(db, entries) {
  const stmt = db.prepare(`
    INSERT INTO register_entries (source_id, list, order_no, raw_name, name, notes, phone, email, struck_off, imported_at)
    VALUES (:source_id, :list, :order_no, :raw_name, :name, :notes, :phone, :email, :struck_off, datetime('now'))
    ON CONFLICT (list, source_id) DO UPDATE SET
      order_no = excluded.order_no, raw_name = excluded.raw_name, name = excluded.name,
      notes = excluded.notes, phone = excluded.phone, email = excluded.email,
      struck_off = excluded.struck_off, imported_at = excluded.imported_at`);
  return tx(db, () => {
    let n = 0;
    for (const e of entries) {
      if (!e) continue;
      stmt.run(e);
      n++;
    }
    return n;
  });
}

// Load the bundled snapshot (pipe-separated, same columns as table 274).
function loadSnapshot(db, file) {
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [ndordre, nometprenom, email, telephone, id] = l.split('|');
      return fromDefinitive({ ndordre, nometprenom, email, telephone, ___id___: id });
    });
  const n = upsert(db, rows);
  setMeta(db, 'register_source', `snapshot (${n} rows)`);
  return n;
}

async function fetchTable(tableId, fetchImpl = fetch) {
  const url = new URL(config.cnomb.ajaxUrl);
  url.search = new URLSearchParams({
    action: 'wp_ajax_ninja_tables_public_action',
    table_id: tableId,
    target_action: 'get-all-data',
    default_sorting: 'old_first',
  }).toString();
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'MessDesDocteurs-Importer/1.0' } });
  if (!res.ok) throw new Error(`CNOMB table ${tableId}: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`CNOMB table ${tableId}: unexpected response`);
  return data.map((r) => r.value || r);
}

// Pull both live tables and upsert them. Returns counts per list.
async function importLive(db, fetchImpl) {
  const definitive = (await fetchTable(config.cnomb.definitiveTableId, fetchImpl)).map(fromDefinitive);
  const provisional = (await fetchTable(config.cnomb.provisionalTableId, fetchImpl)).map(fromProvisional);
  const out = { definitive: upsert(db, definitive), provisional: upsert(db, provisional) };
  setMeta(db, 'register_source', `cnomb.bi live import (${out.definitive} définitives, ${out.provisional} provisoires)`);
  return out;
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, value);
  db.prepare("INSERT INTO meta (key, value) VALUES ('register_updated_at', datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run();
}

module.exports = { splitName, fromDefinitive, fromProvisional, upsert, loadSnapshot, importLive, fetchTable };
