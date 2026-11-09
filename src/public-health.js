'use strict';
// "Santé publique" page: disease alerts and articles for Burundi and the region.
// Anything about a communicable disease, and every WHO alert, is cross-published here
// automatically: news items from src/news.js, admin health alerts, and members' articles.
const news = require('./news');

const fold = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Specialties whose articles always belong on the page.
const SPECIALTIES = ['infectious', 'public-health'];
// Alert categories that are about disease.
const ALERT_CATEGORIES = ['pandemic', 'outbreak', 'vaccination'];

// Communicable diseases and outbreak vocabulary, in French and English (accents folded).
const TERMS = [
  'ebola', 'bundibugyo', 'marburg', 'cholera', 'paludisme', 'malaria', 'rougeole', 'measles', 'rubeole', 'rubella',
  'vih', 'hiv', 'sida', 'aids', 'tuberculose', 'tuberculosis', 'mpox', 'variole', 'monkeypox', 'covid', 'sars-cov', 'coronavirus',
  'dengue', 'chikungunya', 'zika', 'fievre jaune', 'yellow fever', 'meningite', 'meningitis', 'typhoide', 'typhoid',
  'hepatite', 'hepatitis', 'poliomyelite', 'polio', 'peste', 'plague', 'rage', 'rabies', 'grippe', 'influenza',
  'diphterie', 'diphtheria', 'coqueluche', 'pertussis', 'tetanos', 'tetanus', 'shigell', 'salmonell', 'dysenterie', 'dysentery',
  'leishmania', 'trypanosom', 'schistosom', 'bilharzi', 'onchocerc', 'filariose', 'lepre', 'leprosy', 'anthrax', 'charbon bacteridien',
  'transmissible', 'communicable', 'infectieu', 'infectious', 'epidemi', 'epidemic', 'pandemi', 'pandemic', 'flambee', 'outbreak',
  'zoonose', 'zoonosis', 'vaccination', 'vaccin', 'oms',
];
const PATTERN = new RegExp(`(^|[^a-z])(${TERMS.map((t) => t.replace(/[-]/g, '\\-')).join('|')})`, 'i');

function isCommunicable(...texts) {
  return PATTERN.test(fold(texts.join(' ')));
}

// Members' articles are flagged when saved (specialty, keywords, or the editor's checkbox).
function flagArticle(form, checked) {
  return checked || SPECIALTIES.includes(form.specialty) || isCommunicable(form.title, form.summary) ? 1 : 0;
}

const isWho = (n) => /(^|\.)who\.int$/.test(new URL(n.source.url).hostname);

function newsItems() {
  return news.ITEMS
    .filter((n) => n.publicHealth || isWho(n) || isCommunicable(n.title.fr, n.title.en, n.lead.fr))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function alertQualifies(a) {
  return ALERT_CATEGORIES.includes(a.category) || isCommunicable(a.title, a.body);
}

module.exports = { SPECIALTIES, ALERT_CATEGORIES, isCommunicable, flagArticle, newsItems, alertQualifies, isWho };
