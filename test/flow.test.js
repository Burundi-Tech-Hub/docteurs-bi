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
    ({ client: admin } = await signUp(srv.base, '62 22 22 22', { full_name: 'MASABO Admin' }));
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
    const short = await (await fetch(srv.base + '/api/register?q=SI')).json();
    assert.equal(short.rows.length, 0, 'too short to search');
    const oneWord = await (await fetch(srv.base + '/api/register?q=simbananiye')).json();
    assert.equal(oneWord.rows.length, 1, 'one name is enough');
    const withTitle = await (await fetch(srv.base + '/api/register?q=Dr.%20Simbananiye')).json();
    assert.equal(withTitle.rows.length, 1, 'a leading Dr is ignored');
    const firstName = await (await fetch(srv.base + '/api/register?q=Andr%C3%A9')).json();
    assert.ok(firstName.rows.length >= 1, 'a first name alone finds doctors');
    assert.ok(firstName.rows.every((r) => /andr/i.test(r.name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))));
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
    const home = (await new Client(srv.base).get('/')).html;
    assert.match(home, /href="\/actualites\/ebola-bundibugyo-oms-6-novembre-2026"/, 'lead article on the home page and ticker');
    const article = await new Client(srv.base).get('/actualites/ebola-bundibugyo-oms-6-novembre-2026');
    assert.equal(article.status, 200);
    assert.match(article.html, /10 668 cas confirmés/);
    assert.match(article.html, /who\.int\/emergencies\/disease-outbreak-news\/item\/2026-DON625/);
    assert.match(home, /Publications médicales évaluées par les pairs/);
    assert.doesNotMatch(home, /membres sur le réseau|adresses e-mail professionnelles</, 'the ticker shows no site statistics');
    const pub = (await new Client(srv.base).get('/publications')).html;
    assert.match(pub, /id="medecine"/);
    assert.match(pub, /id="chirurgie"/);
    assert.match(pub, /Neurochirurgie/);
    assert.match(pub, /pubmed\.ncbi\.nlm\.nih\.gov/);
    const conf = await new Client(srv.base).get('/congres');
    assert.equal(conf.status, 200);
    assert.match(conf.html, /href="https:\/\/medcal\.fr\/"/);
    assert.match(conf.html, /medcal\.fr\/\?debut=\d{4}-\d{2}/);
    assert.match(home, /href="\/congres"/, 'in the menu');
    assert.match((await new Client(srv.base).get('/contact?topic=event')).html, /value="event" selected/);
  });

  await t.test('visitors and members can send a question; admins see it', async () => {
    const visitor = new Client(srv.base);
    await visitor.get('/contact');
    const bad = await visitor.post('/contact', { name: 'Jean', reply_to: 'nope', topic: 'general', body: 'Bonjour' });
    assert.equal(bad.location, '/contact');
    const ok = await visitor.post('/contact', { name: 'Jean Visiteur', reply_to: '79 11 22 33', topic: 'register', body: 'Comment rejoindre le réseau ?' });
    assert.equal(ok.location, '/contact?sent=1');
    await visitor.post('/contact', { name: 'Bot', reply_to: 'bot@spam.com', body: 'spam', website: 'http://spam' });
    const rows = srv.db.prepare('SELECT * FROM contact_messages ORDER BY id').all();
    assert.equal(rows.length, 1, 'honeypot message dropped');
    assert.equal(rows[0].reply_to, '+25779112233');
    assert.equal(rows[0].user_id, null);
    await bea.get('/contact');
    await bea.post('/contact', { name: 'SIMBANANIYE Béatrice', reply_to: 'bea@example.com', topic: 'email', body: 'Question sur ma boîte mail' });
    assert.ok(srv.db.prepare('SELECT user_id FROM contact_messages WHERE id = 2').get().user_id);
    const inbox = await admin.get('/admin/messages');
    assert.match(inbox.html, /Comment rejoindre le réseau/);
    assert.match(inbox.html, /Question sur ma boîte mail/);
    assert.equal((await bea.get('/admin/messages')).status === 200 && /Comment rejoindre/.test((await bea.get('/admin/messages')).html), false, 'members cannot read the inbox');
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
    assert.equal(m.author, 'MASABO Admin');

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
    assert.match((await bea.get(`/chat?c=${slug}`)).html, /MASABO Admin/);
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

test('admins commission peer review of articles received by email', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const { client: admin } = await signUp(srv.base, '62 33 33 33', { full_name: 'MASABO Editeur' });
  const { client: author } = await signUp(srv.base, '62 44 44 44', { full_name: 'KANEZA Auteur' });
  const { client: peer } = await signUp(srv.base, '62 55 55 55', { full_name: 'NIYONZIMA Relecteur' });
  const id = (phone) => srv.db.prepare('SELECT id FROM users WHERE phone = ?').get(phone).id;

  // Members submit by email: there is no publishing form for them.
  const submit = await author.get('/publications/submit');
  assert.match(submit.html, /contact\?topic=publication/);
  assert.equal((await author.get('/admin/articles/new')).status, 403);

  await admin.get('/admin/articles/new');
  let r = await admin.post('/admin/articles/new', { author_id: id('+25762444444'), author_name: '', specialty: 'cardiology', title: 'Hypertension à Bujumbura', summary: 'Étude transversale.', body: 'Texte', link: '' });
  const pid = Number(r.location.split('/').pop());
  const row = () => srv.db.prepare('SELECT * FROM publications WHERE id = ?').get(pid);
  assert.equal(row().author_name, 'KANEZA Auteur');
  assert.equal(row().status, 'review');
  assert.equal((await new Client(srv.base).get(`/publications/a/${pid}`)).status, 404, 'unpublished articles are confidential');
  assert.equal((await peer.get(`/publications/a/${pid}`)).status, 404, 'members who are not commissioned cannot see it');

  // The author cannot be appointed; a commissioned reviewer sees it and reviews it.
  await admin.get(`/admin/articles/${pid}`);
  await admin.post(`/admin/articles/${pid}/reviewers`, { reviewer_id: id('+25762444444') });
  await admin.post(`/admin/articles/${pid}/reviewers`, { reviewer_id: id('+25762555555') });
  assert.equal(srv.db.prepare('SELECT count(*) AS n FROM publication_reviewers').get().n, 1);
  assert.match((await peer.get('/publications')).html, /À évaluer \(1\)/);
  await peer.get(`/publications/a/${pid}`);
  r = await peer.post(`/publications/a/${pid}/review`, { decision: 'revise', comments: '' });
  assert.equal(srv.db.prepare('SELECT count(*) AS n FROM publication_reviews').get().n, 0, 'a comment is required to ask for changes');
  await peer.post(`/publications/a/${pid}/review`, { decision: 'revise', comments: 'Préciser la méthode.' });
  assert.equal(row().status, 'review', 'reviews advise; the admin decides');
  assert.match((await admin.get(`/admin/articles/${pid}`)).html, /Préciser la méthode/);

  // Revised version received by email: a new round, reviewers commissioned again, then published.
  await admin.post(`/admin/articles/${pid}/status/revision`, {});
  await admin.post(`/admin/articles/${pid}/edit`, { author_id: id('+25762444444'), author_name: 'KANEZA Auteur', specialty: 'cardiology', title: 'Hypertension à Bujumbura', summary: 'Méthode précisée.', body: 'Texte', link: '', new_round: '1' });
  assert.equal(row().round, 2);
  assert.equal(row().status, 'review');
  assert.equal((await peer.get(`/publications/a/${pid}`)).status, 404, 'a new round needs a new commission');
  await admin.post(`/admin/articles/${pid}/reviewers`, { reviewer_id: id('+25762555555') });
  await peer.get(`/publications/a/${pid}`);
  await peer.post(`/publications/a/${pid}/review`, { decision: 'accept', comments: '' });
  await admin.post(`/admin/articles/${pid}/status/published`, {});
  assert.match((await new Client(srv.base).get('/publications/s/cardiology')).html, /Hypertension à Bujumbura/);
  assert.match((await new Client(srv.base).get('/publications')).html, /Articles des membres \(1\)/);
  assert.match((await admin.get('/admin/articles')).html, /Hypertension à Bujumbura/);
});

test('Santé publique gathers WHO alerts, disease alerts and communicable-disease articles', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const { client: admin } = await signUp(srv.base, '62 33 33 33', { full_name: 'MASABO Editeur' });
  const page = () => new Client(srv.base).get('/sante-publique');

  let r = await page();
  assert.equal(r.status, 200);
  assert.match(r.html, /href="\/sante-publique"/, 'in the menu');
  assert.match(r.html, /href="\/actualites\/ebola-bundibugyo-oms-6-novembre-2026"/, 'WHO alerts are cross-published');

  // Disease alerts appear; a non-disease alert does not.
  await admin.get('/admin/alerts');
  await admin.post('/admin/alerts', { title: 'Choléra à Bujumbura', body: 'Cas confirmés à Buterere.', level: 'warning', category: 'other', sms_audience: 'none' });
  await admin.post('/admin/alerts', { title: 'Inondations à Gatumba', body: 'Routes coupées.', level: 'info', category: 'disaster', sms_audience: 'none' });
  srv.db.exec("UPDATE alerts SET ended_at = datetime('now')"); // past alerts, so no banner on every page
  r = await page();
  assert.match(r.html, /Choléra à Bujumbura/);
  assert.doesNotMatch(r.html, /Inondations à Gatumba/);

  // Members' articles: communicable diseases are cross-published automatically, others are not unless ticked.
  const publish = async (data) => {
    await admin.get('/admin/articles/new');
    const res = await admin.post('/admin/articles/new', { author_id: '', author_name: 'Dr Masabo', body: '', link: '', ...data });
    await admin.post(`${res.location}/status/published`, {});
  };
  await publish({ specialty: 'pediatrics', title: 'Rougeole chez l’enfant à Ngozi', summary: 'Série de cas.' });
  await publish({ specialty: 'cardiology', title: 'Hypertension à Gitega', summary: 'Étude transversale.' });
  await publish({ specialty: 'orthopedics', title: 'Traumatismes et santé communautaire', summary: 'Données hospitalières.', public_health: 'on' });
  r = await page();
  assert.match(r.html, /Rougeole chez l’enfant à Ngozi|Rougeole chez l&#39;enfant à Ngozi/);
  assert.doesNotMatch(r.html, /Hypertension à Gitega/);
  assert.match(r.html, /Traumatismes et santé communautaire/);
});

test('mailing list to register emails: test send, opt-out respected, admin only', async (t) => {
  const config = require('../src/config');
  const mailing = require('../src/mailing');
  const email = require('../src/drivers/email');
  const srv = await startServer();
  t.after(() => srv.close());
  const { client: admin } = await signUp(srv.base, '62 33 33 33', { full_name: 'MASABO Editeur' });
  const { client: member } = await signUp(srv.base, '62 44 44 44', { full_name: 'KANEZA Membre' });
  const ins = srv.db.prepare("INSERT INTO register_entries (source_id, list, raw_name, name, email, struck_off) VALUES (?, 'definitive', ?, ?, ?, ?)");
  ins.run('m1', 'NDIKUMANA Ali', 'NDIKUMANA Ali', 'ali@exemple.bi', 0);
  ins.run('m2', 'BIGIRIMANA Eva', 'BIGIRIMANA Eva', 'Eva@Exemple.bi', 0);
  ins.run('m3', 'BIGIRIMANA Eva bis', 'BIGIRIMANA Eva', 'eva@exemple.bi ', 0);
  ins.run('m4', 'RADIE Paul', 'RADIE Paul', 'paul@exemple.bi', 1);

  assert.equal((await member.get('/admin/mailing')).status, 403);
  const page = await admin.get('/admin/mailing');
  assert.equal(page.status, 200);
  assert.match(page.html, /Invitation : rejoignez/);
  assert.deepEqual(mailing.audience(srv.db).map((r) => r.email), ['ali@exemple.bi', 'eva@exemple.bi'], 'distinct, struck-off excluded');

  // Test email carries the personal link and the reason.
  await admin.post('/admin/mailing/test', { subject: 'Bonjour {nom}', body: 'Rejoignez-nous : {inscription}\nConfirmer : {confirmer}', audience: 'all', test_to: 'jc@exemple.bi' });
  const last = email.sent.at(-1);
  assert.equal(last.to, 'jc@exemple.bi');
  assert.match(last.text, /\/liste\/[\w-]+\.[\w-]+/);
  assert.match(last.text, /tableau public de l’Ordre/);

  // No provider configured: sending to the list is refused.
  await admin.post('/admin/mailing/send', { subject: 's', body: 'b', audience: 'all', confirm: 'on' });
  assert.equal(srv.db.prepare('SELECT count(*) AS n FROM mailings').get().n, 0);

  // A doctor unsubscribes through the personal link; tampered links are refused.
  const link = `/liste/${mailing.token('eva@exemple.bi')}`;
  const visitor = new Client(srv.base);
  assert.match((await visitor.get(link)).html, /eva@exemple\.bi/);
  await visitor.post(link, { action: 'unsubscribe' });
  assert.equal(mailing.statusOf(srv.db, 'EVA@exemple.bi'), 'unsubscribed');
  assert.equal((await visitor.get(link.slice(0, -2) + 'xx')).status, 404);
  const ali = new Client(srv.base);
  await ali.get(`/liste/${mailing.token('ali@exemple.bi')}`);
  await ali.post(`/liste/${mailing.token('ali@exemple.bi')}`, { action: 'subscribe' });

  // With a provider, the list skips unsubscribed addresses.
  const saved = { ...config.email };
  Object.assign(config.email, { driver: 'brevo', from: 'contact@medecins.bi', perMinute: 0 });
  t.after(() => Object.assign(config.email, saved));
  const sentTo = [];
  const { total, done } = mailing.start(srv.db, 1, { subject: 'Nouvelles', body: 'Bonjour {nom}', audience: 'all' }, async (m) => { sentTo.push(m.to); });
  await done;
  assert.equal(total, 1);
  assert.deepEqual(sentTo, ['ali@exemple.bi']);
  assert.equal(mailing.audience(srv.db, 'confirmed').length, 1);
  assert.match((await admin.get('/admin/mailing')).html, /1\/1 envoyés/);
});

test('diaspora doctors register with a foreign number and wait for approval', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const { client: admin } = await signUp(srv.base, '62 33 33 33', { full_name: 'MASABO Admin' });

  const c = new Client(srv.base);
  await c.get('/register');
  await c.post('/register/phone', { phone: '+32 470 12 34 56', diaspora: 'on' });
  await c.post('/register/verify', { code: lastCode('+32470123456') });
  const form = await c.get('/register');
  assert.match(form.html, /name="licence_no"/);
  let r = await c.post('/register/complete', { full_name: 'IRAKOZE Diaspora', password: 'secret123', password2: 'secret123', declaration: 'on', country: 'Belgique' });
  assert.equal(r.status, 400, 'diaspora details are required');
  r = await c.post('/register/complete', {
    full_name: 'IRAKOZE Diaspora', password: 'secret123', password2: 'secret123', declaration: 'on',
    country: 'Belgique', licence_body: 'Ordre des médecins de Belgique', licence_no: '1-23456-78-901', origin: 'Né à Gitega',
  });
  assert.match(r.html, /Demande envoyée/);
  const u = srv.db.prepare("SELECT u.role, d.status FROM users u JOIN diaspora_profiles d ON d.user_id = u.id WHERE u.phone = '+32470123456'").get();
  assert.deepEqual({ ...u }, { role: 'member', status: 'pending' });

  const login = new Client(srv.base);
  await login.get('/login');
  r = await login.post('/login', { phone: '+32470123456', password: 'secret123' });
  assert.equal(r.status, 401);
  assert.match(r.html, /en cours de vérification/);

  assert.match((await admin.get('/admin')).html, /Ordre des médecins de Belgique/);
  const id = srv.db.prepare("SELECT id FROM users WHERE phone = '+32470123456'").get().id;
  await admin.post(`/admin/diaspora/${id}/approve`, {});
  assert.ok(sms.sent.some((m) => m.to === '+32470123456' && /validé/.test(m.text)));
  await login.get('/login');
  r = await login.post('/login', { phone: '+32470123456', password: 'secret123' });
  assert.equal(r.location, '/');
});
