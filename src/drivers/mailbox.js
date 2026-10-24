'use strict';
// Creates professional mailboxes (name@MAIL_DOMAIN) at the mail provider.
// "console" only logs (development); "mailcow" uses the mailcow API.
const config = require('../config');

async function createMailbox({ localPart, name, password }) {
  const c = config.mail;
  if (c.driver === 'mailcow') {
    const res = await fetch(`${c.mailcowUrl}/api/v1/add/mailbox`, {
      method: 'POST',
      headers: { 'X-API-Key': c.mailcowApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_part: localPart,
        domain: c.domain,
        name,
        quota: String(c.quotaMb),
        password,
        password2: password,
        active: '1',
        force_pw_update: '1',
      }),
    });
    const body = await res.json().catch(() => null);
    const failed = !res.ok || (Array.isArray(body) && body.some((r) => r.type === 'danger' || r.type === 'error'));
    if (failed) throw new Error(`mailcow: ${JSON.stringify(body) || res.status}`);
    return;
  }
  console.log(`[mailbox:console] would create ${localPart}@${c.domain} for ${name}`);
}

module.exports = { createMailbox };
