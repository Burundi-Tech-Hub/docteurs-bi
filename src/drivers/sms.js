'use strict';
// SMS delivery. "console" prints messages to the server log (development).
const config = require('../config');

const sent = []; // last messages, readable in tests and dev

async function send(to, text) {
  const c = config.sms;
  switch (c.driver) {
    case 'africastalking': {
      const body = new URLSearchParams({ username: c.atUsername, to, message: text });
      if (c.senderId) body.set('from', c.senderId);
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: { apiKey: c.atApiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`Africa's Talking: HTTP ${res.status}`);
      return;
    }
    case 'twilio': {
      const auth = Buffer.from(`${c.twilioSid}:${c.twilioToken}`).toString('base64');
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: c.twilioFrom, Body: text }),
      });
      if (!res.ok) throw new Error(`Twilio: HTTP ${res.status}`);
      return;
    }
    default:
      sent.push({ to, text, at: Date.now() });
      if (sent.length > 50) sent.shift();
      console.log(`[sms:console] to ${to}: ${text}`);
  }
}

module.exports = { send, sent };
