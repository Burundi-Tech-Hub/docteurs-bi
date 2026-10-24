'use strict';
// Headlines for "Improve your practice": fetched from RSS feeds (Medscape by default),
// cached in memory, and always linked back to the publisher. Only titles and short
// summaries are shown; the full articles stay on the source site.
const config = require('./config');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const text = (html) => decode(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')) || [])[1] || '';

function parseFeed(xml) {
  const source = text(tag(tag(xml, 'channel') || xml, 'title'));
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(([item]) => {
    const summary = text(tag(item, 'description'));
    const date = new Date(text(tag(item, 'pubDate')) || text(tag(item, 'dc:date')));
    return {
      title: text(tag(item, 'title')),
      link: text(tag(item, 'link')),
      summary: summary.length > 240 ? `${summary.slice(0, 237).trimEnd()}…` : summary,
      date: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      source,
    };
  }).filter((a) => a.title && /^https?:\/\//.test(a.link));
}

let cache = { at: 0, articles: [], error: null };

async function articles(fetchImpl = fetch) {
  if (Date.now() - cache.at < config.practice.cacheMinutes * 60e3 && cache.articles.length) return cache;
  const results = await Promise.allSettled(config.practice.feeds.map(async (url) => {
    const res = await fetchImpl(url, { headers: { 'user-agent': 'MessDesDocteurs/1.0 (+RSS reader)' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return parseFeed(await res.text());
  }));
  const list = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const failed = results.filter((r) => r.status === 'rejected');
  failed.forEach((r) => console.error('Practice feed failed:', r.reason?.message));
  if (list.length) {
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    cache = { at: Date.now(), articles: list.slice(0, 40), error: null };
  } else {
    // Keep showing the last good headlines if every feed failed.
    cache = { ...cache, error: failed[0]?.reason?.message || 'no articles' };
  }
  return cache;
}

// French translations of titles and summaries, kept per article link.
const translated = new Map();

async function translate(list, fetchImpl = fetch) {
  const key = config.practice.deeplKey;
  if (!key) return list;
  const todo = list.filter((a) => !translated.has(a.link));
  if (todo.length) {
    try {
      const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const res = await fetchImpl(`${host}/v2/translate`, {
        method: 'POST',
        headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: todo.flatMap((a) => [a.title, a.summary || ' ']), source_lang: 'EN', target_lang: 'FR' }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
      const out = (await res.json()).translations.map((t) => t.text);
      todo.forEach((a, i) => translated.set(a.link, { title: out[2 * i], summary: a.summary ? out[2 * i + 1] : '' }));
    } catch (e) {
      console.error('Practice translation failed:', e.message);
    }
  }
  return list.map((a) => (translated.has(a.link) ? { ...a, ...translated.get(a.link), lang: 'fr' } : a));
}

const reset = () => { cache = { at: 0, articles: [], error: null }; translated.clear(); };

module.exports = { parseFeed, articles, translate, reset };
