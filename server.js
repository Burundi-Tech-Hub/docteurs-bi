'use strict';
const http = require('node:http');
const path = require('node:path');
const config = require('./src/config');
const { open } = require('./src/db');
const register = require('./src/register');
const { createApp } = require('./src/app');
const chat = require('./src/chat');

const db = open(config.dbFile);
if (!db.prepare('SELECT 1 FROM register_entries LIMIT 1').get()) {
  const n = register.loadSnapshot(db, path.join(__dirname, 'data', 'cnomb-snapshot.psv'));
  console.log(`Seeded ${n} register entries from the bundled snapshot. Run "npm run import:cnomb" for the full live register.`);
}

const { app, sessionMiddleware } = createApp(db);
const server = http.createServer(app);
chat.attach(server, db, sessionMiddleware);
server.listen(config.port, () => console.log(`${config.appName} listening on ${config.baseUrl}`));
