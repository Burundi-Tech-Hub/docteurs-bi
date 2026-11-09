'use strict';
// Outgoing email for the mailing list. "console" prints to the server log (development);
// "brevo" sends through the Brevo transactional API (BREVO_API_KEY).
const config = require('../config');

const sent = []; // last messages, readable in tests and dev

async function send({ to, name, subject, text, html, unsubscribeUrl }) {
  const c = config.email;
  switch (c.driver) {
    case 'brevo': {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': c.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: c.from, name: c.fromName },
          to: [name ? { email: to, name } : { email: to }],
          ...(c.replyTo ? { replyTo: { email: c.replyTo } } : {}),
          subject,
          textContent: text,
          htmlContent: html,
          headers: unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>` } : {},
        }),
      });
      if (!res.ok) throw new Error(`Brevo: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return;
    }
    default:
      sent.push({ to, subject, text, at: Date.now() });
      if (sent.length > 50) sent.shift();
      console.log(`[email:console] to ${to}: ${subject}`);
  }
}

const ready = () => config.email.driver !== 'console' && !!config.email.from;

module.exports = { send, sent, ready };
