'use strict';
// Loads the full CNOMB register from cnomb.bi into the database.
// Usage: npm run import:cnomb            (live, needs internet access to cnomb.bi)
//        npm run import:cnomb -- --snapshot   (bundled snapshot only)
const path = require('node:path');
const config = require('../src/config');
const { open } = require('../src/db');
const register = require('../src/register');

(async () => {
  const db = open(config.dbFile);
  if (process.argv.includes('--snapshot')) {
    const n = register.loadSnapshot(db, path.join(__dirname, '..', 'data', 'cnomb-snapshot.psv'));
    console.log(`Loaded ${n} entries from the snapshot.`);
    return;
  }
  const out = await register.importLive(db);
  console.log(`Imported ${out.definitive} full and ${out.provisional} provisional registrations from cnomb.bi.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
