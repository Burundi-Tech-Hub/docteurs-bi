'use strict';
// Writes wix-site/register.json: the bundled register snapshot without contact
// details, used by the Wix site when the app can't be reached.
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('../src/db');
const register = require('../src/register');
const { hideNumbers } = require('../src/routes/public');

const db = open(':memory:');
register.loadSnapshot(db, path.join(__dirname, '..', 'seed', 'cnomb-snapshot.psv'));
const rows = db.prepare(`SELECT order_no, name, notes, list, struck_off FROM register_entries
  ORDER BY CAST(substr(replace(order_no, ' ', ''), 3) AS INTEGER), name`).all()
  .map((r) => [r.order_no, r.name, hideNumbers(r.notes), r.struck_off ? 1 : 0]);
const out = path.join(__dirname, '..', 'wix-site', 'register.json');
fs.writeFileSync(out, JSON.stringify({ taken: '2026-10-24', rows }));
console.log(`Wrote ${rows.length} entries to ${out}`);
