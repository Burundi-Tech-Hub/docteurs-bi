'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const sms = require('../src/drivers/sms');
const register = require('../src/register');
const { startServer, Client } = require('./helpers');

const lastCode = (phone) => [...sms.sent].reverse().find((m) => m.to === phone)?.text.match(/(\d{6})/)[1];

async function signUp(base, local, fields = {}) {
  const c = new Client(base);
  await c.get('/register');
  let r = await c.post('/register/phone', { phone: local });
  assert.equal(r.location, '/register');
  const e164 = '+257' + local.replace(/\s/g, '');
  r = await c.post('/register/verify', { code: lastCode(e164) });
  const page = await c.get('/register');
  assert.match(page.html, /\+257/);
  r = await c.post('/register/complete', {
    full_name: 'Test Doctor', password: 'secret123', password2: 'secret123', declaration: 'on', ...fields,
  });
  assert.equal(r.location, '/welcome', r.html.slice(0, 300));
  return { client: c, page };
}

test('full member journey', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  register.upsert(srv.db, [register.fromDefinitive({ ndordre: 'OM151', nometprenom: 'SIMBANANIYE Béatrice 23/11/1994 UB', email: 'beasimba2003@yahoo.fr', telephone: '79644529', ___id___: 29032 }),
    register.fromDefinitive({ ndordre: 'OM9', nometprenom: 'GAKWAVU André 25/10/1991', email: '', telephone: '', ___id___: 28889 })]);

  await t.test('forms without the CSRF token are refused', async () => {
    const c = new Client(srv.base);
    const r = await c.post('/login', { phone: '79000000', password: 'x' }, { csrf: false });
    assert.equal(r.status, 403);
  });

  await t.test('non +257 numbers cannot register', async () => {
    const c = new Client(srv.base);
    await c.get('/register');
    await c.post('/register/phone', { phone: '+33612345678' });
    const page = await c.get('/register');
    assert.match(page.html, /Seuls les numéros burundais/);
    assert.ok(!sms.sent.some((m) => m.to === '+33612345678'));
  });

  let admin;
  await t.test('first member becomes admin; wrong code is rejected', async () => {
    const c = new Client(srv.base);
    await c.get('/register');
    await c.post('/register/phone', { phone: '61 11 11 11' });
    await c.post('/register/verify', { code: '000000' === lastCode('+25761111111') ? '111111' : '000000' });
    assert.match((await c.get('/register')).html, /Code incorrect/);
    ({ client: admin } = await signUp(srv.base, '62 22 22 22', { full_name: 'NDAYISHIMIYE Admin' }));
    const u = srv.db.prepare("SELECT * FROM users WHERE phone = '+25762222222'").get();
    assert.equal(u.role, 'admin');
  });

  let bea;
  await t.test('a phone on the CNOMB register links the entry automatically', async () => {
    const c = new Client(srv.base);
    await c.get('/register');
    await c.post('/register/phone', { phone: '79644529' });
    await c.post('/register/verify', { code: lastCode('+25779644529') });
    const page = await c.get('/register');
    assert.match(page.html, /OM151/);
    await c.post('/register/complete', { full_name: 'SIMBANANIYE Béatrice', password: 'secret123', password2: 'secret123', declaration: 'on' });
    const u = srv.db.prepare("SELECT * FROM users WHERE phone = '+25779644529'").get();
    assert.equal(u.register_link, 'auto');
    assert.equal(u.role, 'member');
    bea = c;
  });

  await t.test('directory hides contacts from visitors and shows +257 numbers to members', async () => {
    const browse = await new Client(srv.base).get('/directory');
    assert.doesNotMatch(browse.html, /NITUNGA/, 'visitors cannot browse the list');
    const anon = await new Client(srv.base).get('/directory?q=SIMBANANIYE+B%C3%A9atrice');
    assert.match(anon.html, /SIMBANANIYE/);
    assert.doesNotMatch(anon.html, /79 64 45 29/);
    const member = await bea.get('/directory?q=SIMBANANIYE');
    assert.match(member.html, /\+257 79 64 45 29/);
    const byOrder = await bea.get('/directory?q=om9');
    assert.match(byOrder.html, /GAKWAVU/);
  });

  await t.test('public register feed for the Wix site has CORS and no contact details', async () => {
    const browse = await (await fetch(srv.base + '/api/register')).json();
    assert.equal(browse.rows.length, 0);
    assert.equal(browse.needsName, true);
    const oneWord = await (await fetch(srv.base + '/api/register?q=SIMBANANIYE')).json();
    assert.equal(oneWord.rows.length, 0, 'a single name is not enough');
    const byOrder = await (await fetch(srv.base + '/api/register?q=OM%20151')).json();
    assert.equal(byOrder.rows.length, 0, 'order numbers cannot be enumerated publicly');
    const unaccented = await (await fetch(srv.base + '/api/register?q=beatrice%20simbananiye')).json();
    assert.equal(unaccented.rows.length, 1, 'accents and case are ignored');
    const res = await fetch(srv.base + '/api/register?q=B%C3%A9atrice%20SIMBANANIYE');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const data = await res.json();
    assert.ok(data.total >= 1);
    assert.match(data.rows[0].name, /SIMBANANIYE/);
    const text = JSON.stringify(data);
    assert.doesNotMatch(text, /79 ?64 ?45 ?29|phone|email/);
  });

  await t.test('the app is installable: manifest, service worker and install page', async () => {
    const m = await (await fetch(srv.base + '/manifest.webmanifest')).json();
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.sizes === '512x512'));
    for (const i of m.icons) assert.equal((await fetch(srv.base + i.src)).status, 200);
    const sw = await fetch(srv.base + '/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get('content-type'), /javascript/);
    const page = await new Client(srv.base).get('/install');
    assert.match(page.html, /rel="manifest"/);
    assert.match(page.html, /Télécharger l’application/);
    assert.equal((await new Client(srv.base).get('/offline')).status, 200);
    assert.match((await new Client(srv.base).get('/practice')).html, /uptodate\.com\/contents\/search/);
  });

  await t.test('claiming another order number needs admin approval', async () => {
    const { client } = await signUp(srv.base, '68 33 33 33', { order_no: 'OM 9' });
    const u = srv.db.prepare("SELECT * FROM users WHERE phone = '+25768333333'").get();
    assert.equal(u.register_link, 'claimed');
    assert.match((await admin.get('/admin')).html, /GAKWAVU/);
    await admin.get('/admin');
    await admin.post(`/admin/claims/${u.id}/approve`);
    assert.equal(srv.db.prepare('SELECT register_link FROM users WHERE id = ?').get(u.id).register_link, 'approved');
    assert.match((await client.get('/profile')).html, /OM9/);
  });

  await t.test('invitations go by SMS and are marked accepted', async () => {
    await bea.get('/invite');
    await bea.post('/invite', { name: 'Dr Colleague', phone: '75 44 44 44' });
    const msg = [...sms.sent].reverse().find((m) => m.to === '+25775444444');
    assert.ok(msg, 'invite SMS sent');
    const link = msg.text.match(/(http\S+\/i\/\S+)/)[1];
    const c = new Client(srv.base);
    const landing = await c.get(new URL(link).pathname);
    assert.equal(landing.location, '/register');
    const page = await c.get('/register');
    assert.match(page.html, /75444444/);
    await c.post('/register/phone', { phone: '75444444' });
    await c.post('/register/verify', { code: lastCode('+25775444444') });
    await c.get('/register');
    await c.post('/register/complete', { full_name: 'Colleague', password: 'secret123', password2: 'secret123', declaration: 'on' });
    const inv = srv.db.prepare("SELECT * FROM invites WHERE phone = '+25775444444'").get();
    assert.ok(inv.accepted_by);
    const invited = srv.db.prepare('SELECT invited_by FROM users WHERE id = ?').get(inv.accepted_by);
    assert.equal(invited.invited_by, srv.db.prepare("SELECT id FROM users WHERE phone = '+25779644529'").get().id);
    assert.match((await bea.get('/invite')).html, /Acceptée/);
  });

  await t.test('professional email: request, admin approval, SMS with password', async () => {
    await bea.get('/email');
    await bea.post('/email', { local: 'admin' });
    assert.match((await bea.get('/email')).html, /Adresse invalide/);
    await bea.post('/email', { local: 'beatrice.simbananiye' });
    assert.match((await bea.get('/email')).html, /en attente/);
    const box = srv.db.prepare("SELECT * FROM mailboxes WHERE address = 'beatrice.simbananiye@medecins.bi'").get();
    await admin.get('/admin');
    await admin.post(`/admin/mailboxes/${box.id}/approve`);
    assert.equal(srv.db.prepare('SELECT status FROM mailboxes WHERE id = ?').get(box.id).status, 'active');
    assert.ok(sms.sent.some((m) => m.to === '+25779644529' && /beatrice\.simbananiye@medecins\.bi/.test(m.text)));
    assert.match((await bea.get('/email')).html, /est active/);
  });

  await t.test('login, logout and password reset', async () => {
    const c = new Client(srv.base);
    await c.get('/login');
    let r = await c.post('/login', { phone: '+257 79 64 45 29', password: 'wrongpass' });
    assert.equal(r.status, 401);
    r = await c.post('/login', { phone: '79644529', password: 'secret123' });
    assert.equal(r.location, '/');
    await c.get('/');
    await c.post('/logout');
    assert.equal((await c.get('/chat')).location, '/login');
    await c.get('/forgot');
    await c.post('/forgot/phone', { phone: '79644529' });
    await c.get('/forgot');
    await c.post('/forgot/complete', { code: lastCode('+25779644529'), password: 'newpass123', password2: 'newpass123' });
    await c.get('/login');
    r = await c.post('/login', { phone: '79644529', password: 'newpass123' });
    assert.equal(r.location, '/chat'); // back to the page that asked for a login
  });

  await t.test('chat delivers channel and direct messages, members only', async () => {
    const connect = (client) => io(srv.base, { extraHeaders: { cookie: client.cookie }, transports: ['websocket'], forceNew: true });
    const anon = io(srv.base, { transports: ['websocket'], forceNew: true });
    const err = await new Promise((r) => anon.on('connect_error', (e) => r(e.message)));
    assert.equal(err, 'unauthorized');
    anon.close();

    const a = connect(admin);
    const b = connect(bea);
    const sockets = [a, b];
    const join = (s, slug) => new Promise((r) => s.emit('join', slug, r));
    assert.ok((await join(a, 'general')).channel);
    await join(b, 'general');
    const got = new Promise((r) => b.on('message', r));
    const ack = await new Promise((r) => a.emit('message', 'Bonjour confrères', r));
    assert.ok(ack.ok);
    const m = await got;
    assert.equal(m.body, 'Bonjour confrères');
    assert.equal(m.author, 'NDAYISHIMIYE Admin');

    // Direct conversation, then a third member cannot read it.
    const beaId = srv.db.prepare("SELECT id FROM users WHERE phone = '+25779644529'").get().id;
    await admin.get('/directory?list=members');
    const r = await admin.post(`/chat/dm/${beaId}`);
    const slug = new URL(r.location, srv.base).searchParams.get('c');
    assert.match(slug, /^dm-/);
    assert.ok((await join(a, slug)).channel);
    assert.ok((await join(b, slug)).channel);
    const { client: other } = await signUp(srv.base, '69 55 55 55');
    const o = connect(other);
    sockets.push(o);
    assert.equal((await join(o, slug)).error, 'forbidden');
    assert.match((await bea.get(`/chat?c=${slug}`)).html, /NDAYISHIMIYE Admin/);
    sockets.forEach((s) => s.close());
  });

  await t.test('health alerts: banner, live push and SMS to members who opted in', async () => {
    // A member opts out of alert texts.
    await bea.get('/profile');
    await bea.post('/profile', { full_name: 'SIMBANANIYE Béatrice' });
    assert.equal(srv.db.prepare("SELECT sms_alerts FROM users WHERE phone = '+25779644529'").get().sms_alerts, 0);

    // Members cannot publish.
    await bea.get('/alerts');
    assert.equal((await bea.post('/admin/alerts', { title: 'x', body: 'y' })).status, 403);

    const live = io(srv.base, { extraHeaders: { cookie: bea.cookie }, transports: ['websocket'], forceNew: true });
    await new Promise((r) => live.on('connect', r));
    const pushed = new Promise((r) => live.on('alert', r));

    const before = sms.sent.length;
    await admin.get('/admin/alerts');
    const r = await admin.post('/admin/alerts', {
      title: 'Choléra à Bujumbura', body: 'Cas confirmés. Renforcez la surveillance des diarrhées aiguës.',
      level: 'emergency', category: 'outbreak', expires_hours: '168', sms_audience: 'members_register',
    });
    assert.equal(r.location, '/admin/alerts');
    assert.equal((await pushed).title, 'Choléra à Bujumbura');
    live.close();

    const home = await new Client(srv.base).get('/');
    assert.match(home.html, /alert-emergency/);
    assert.match(home.html, /Choléra à Bujumbura/);

    await new Promise((r) => setTimeout(r, 100));
    const texts = sms.sent.slice(before).filter((m) => /URGENCE SANTÉ/.test(m.text));
    const to = texts.map((m) => m.to);
    assert.ok(to.includes('+25762222222'), 'admin gets it');
    assert.ok(!to.includes('+25779644529'), 'opted-out member does not');
    assert.equal(new Set(to).size, to.length, 'no duplicates');
    const alert = srv.db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 1').get();
    assert.equal(alert.sms_sent, to.length);

    await admin.post(`/admin/alerts/${alert.id}/end`);
    assert.doesNotMatch((await new Client(srv.base).get('/')).html, /alert-emergency/);
    assert.match((await new Client(srv.base).get('/alerts')).html, /Choléra/);
  });

  await t.test('suspended members are logged out', async () => {
    const id = srv.db.prepare("SELECT id FROM users WHERE phone = '+25769555555'").get().id;
    await admin.get('/admin');
    await admin.post(`/admin/users/${id}/suspend`);
    const c = new Client(srv.base);
    await c.get('/login');
    const r = await c.post('/login', { phone: '69555555', password: 'secret123' });
    assert.equal(r.status, 401);
    assert.match(r.html, /suspendu/);
  });
});
