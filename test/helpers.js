'use strict';
const http = require('node:http');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const chat = require('../src/chat');

async function startServer() {
  const db = open(':memory:');
  const { app, sessionMiddleware } = createApp(db);
  const server = http.createServer(app);
  const io = chat.attach(server, db, sessionMiddleware);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base, close: () => new Promise((r) => { io.close(); server.closeAllConnections(); server.close(r); }) };
}

// Minimal browser: keeps the session cookie and the CSRF token.
class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }

  async get(path) {
    const res = await fetch(this.base + path, { headers: { cookie: this.cookie }, redirect: 'manual' });
    this.keep(res);
    const html = await res.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, html, location: res.headers.get('location') };
  }

  async post(path, data = {}, { csrf = true } = {}) {
    if (csrf && !this.csrf) await this.get('/login');
    const body = new URLSearchParams(csrf ? { _csrf: this.csrf, ...data } : data);
    const res = await fetch(this.base + path, {
      method: 'POST', body, redirect: 'manual',
      headers: { cookie: this.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });
    this.keep(res);
    return { status: res.status, html: await res.text(), location: res.headers.get('location') };
  }

  keep(res) {
    const c = res.headers.get('set-cookie');
    if (c) this.cookie = c.split(';')[0];
  }
}

module.exports = { startServer, Client };
