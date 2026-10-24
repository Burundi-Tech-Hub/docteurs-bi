'use strict';

// Burundi numbers are +257 followed by 8 digits (mobile 6x/7x, fixed 2x).
const BURUNDI = /^\+257[2-9]\d{7}$/;

// Normalise user input to E.164. Local 8-digit numbers get +257 added.
// Returns null when the input cannot be read as a phone number at all.
function normalize(input) {
  if (!input) return null;
  let s = String(input).trim().replace(/[\s.\-()/]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^\d{8}$/.test(s)) s = '+257' + s;
  else if (/^257\d{8}$/.test(s)) s = '+' + s;
  if (!/^\+\d{8,15}$/.test(s)) return null;
  return s;
}

const isBurundi = (e164) => BURUNDI.test(e164 || '');

// Display as +257 79 12 34 56.
function format(e164) {
  if (!isBurundi(e164)) return e164 || '';
  const d = e164.slice(4);
  return `+257 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6)}`;
}

module.exports = { normalize, isBurundi, format };
