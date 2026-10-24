'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const phone = require('../src/phone');
const register = require('../src/register');
const mail = require('../src/mail');
const { open } = require('../src/db');

test('phone numbers are normalised to +257', () => {
  assert.equal(phone.normalize('79 92 11 73'), '+25779921173');
  assert.equal(phone.normalize('25779921173'), '+25779921173');
  assert.equal(phone.normalize('0025779921173'), '+25779921173');
  assert.equal(phone.normalize('+257 79-92-11-73'), '+25779921173');
  assert.equal(phone.normalize('+33612345678'), '+33612345678');
  assert.equal(phone.normalize('71 600'), null);
  assert.ok(phone.isBurundi('+25779921173'));
  assert.ok(!phone.isBurundi('+33612345678'));
  assert.ok(!phone.isBurundi('+25712345678'));
  assert.equal(phone.format('+25779921173'), '+257 79 92 11 73');
});

test('register names are split from graduation notes', () => {
  assert.deepEqual(register.splitName('NIZIGAMA Jean 08/02/1988 UB'), { name: 'NIZIGAMA Jean', notes: '08/02/1988 UB', struckOff: false });
  assert.deepEqual(register.splitName('NINTIJE Jérémie (Radié)'), { name: 'NINTIJE Jérémie', notes: '', struckOff: true });
  assert.equal(register.splitName('MBONIHANKUYE Arstide23/05/2011 U Marakech').name, 'MBONIHANKUYE Arstide');
  assert.equal(register.splitName('BIZIMANA Paul UB 11/07/2003').name, 'BIZIMANA Paul');
  assert.equal(register.splitName('NITUNGA Nestor').notes, '');
});

test('register rows keep only valid +257 phones and emails', () => {
  const r = register.fromDefinitive({ ndordre: 'OM 157', nometprenom: 'SAHABO Christophe 28/02/1996', email: 'Roumanie', telephone: '70 400', ___id___: 1 });
  assert.equal(r.order_no, 'OM 157');
  assert.equal(r.phone, null);
  assert.equal(r.email, null);
  const ok = register.fromDefinitive({ ndordre: 'OM1', nometprenom: 'NITUNGA Nestor', email: 'Nes@Yahoo.fr', telephone: '78837160', ___id___: 2 });
  assert.equal(ok.phone, '+25778837160');
  assert.equal(ok.email, 'nes@yahoo.fr');
});

test('live import reads both Ninja Tables', async () => {
  const db = open(':memory:');
  const fakeFetch = async (url) => {
    const id = new URL(url).searchParams.get('table_id');
    const rows = id === '274'
      ? [{ options: {}, value: { ndordre: 'OM1', nometprenom: 'NITUNGA Nestor', email: '', telephone: '78837160', ___id___: 28881 } }]
      : [{ value: { ninja_column_1: 'N° ORDRE', ninja_column_2: 'NOM ET PRENOM', ___id___: 8031 } },
        { value: { ninja_column_1: 'OMP3', ninja_column_2: 'Fayek Fouad', ___id___: 8034 } },
        { value: { ninja_column_1: '', ninja_column_2: '', ___id___: 8314 } }];
    return { ok: true, json: async () => rows };
  };
  const out = await register.importLive(db, fakeFetch);
  assert.deepEqual(out, { definitive: 1, provisional: 1 });
  // Re-running updates instead of duplicating.
  await register.importLive(db, fakeFetch);
  assert.equal(db.prepare('SELECT count(*) n FROM register_entries').get().n, 2);
});

test('mailbox names are suggested from register-style names', () => {
  assert.equal(mail.suggestLocalPart('NIZIGAMA Jean Pierre'), 'jean.pierre.nizigama');
  assert.equal(mail.suggestLocalPart('Béatrice SIMBANANIYE'), 'beatrice.simbananiye');
  assert.ok(mail.validateLocalPart('jean.nizigama'));
  assert.ok(!mail.validateLocalPart('admin'));
  assert.ok(!mail.validateLocalPart('a..b'));
});

test('alert SMS text stays within three SMS parts', () => {
  const alerts = require('../src/alerts');
  const text = alerts.smsText({ id: 7, level: 'emergency', title: 'Pandémie', body: 'x'.repeat(2000) });
  assert.ok(text.length <= 459, String(text.length));
  assert.match(text, /^\[URGENCE SANTÉ\] Pandémie: x+… http\S+\/alerts\/7$/);
});

test('phone numbers are stripped from public register notes', () => {
  const { hideNumbers } = require('../src/routes/public');
  assert.equal(hideNumbers('09/07/2004 UB 78825736'), '09/07/2004 UB');
  assert.equal(hideNumbers('71759624'), '');
  assert.equal(hideNumbers('16/3/2010 UB 75 79 77 28'), '16/3/2010 UB');
  assert.equal(hideNumbers('28/06/1977 U L B'), '28/06/1977 U L B');
});

test('practice headlines come from the RSS feed, newest first, and keep the last good copy', async () => {
  const practice = require('../src/practice');
  practice.reset();
  const xml = `<rss><channel><title>Medscape Medical News</title>
    <item><title>Older</title><link>https://www.medscape.com/viewarticle/1</link><pubDate>Thu, 23 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Malaria &amp; pregnancy]]></title><link>https://www.medscape.com/viewarticle/2</link>
      <description>&lt;p&gt;New WHO guidance.&lt;/p&gt;</description><pubDate>Fri, 24 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>No link</title></item></channel></rss>`;
  const ok = async () => ({ ok: true, text: async () => xml });
  const first = await practice.articles(ok);
  assert.deepEqual(first.articles.map((a) => a.title), ['Malaria & pregnancy', 'Older']);
  assert.equal(first.articles[0].summary, 'New WHO guidance.');
  assert.equal(first.articles[0].source, 'Medscape Medical News');
  practice.reset();
  const down = async () => { throw new Error('offline'); };
  assert.equal((await practice.articles(down)).articles.length, 0);
});
