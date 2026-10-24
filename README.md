# Mess des Docteurs

Réseau professionnel des médecins du Burundi / A professional network for Burundi's doctors.

- **Annuaire / Directory** of doctors on the CNOMB register (Conseil National de l'Ordre des Médecins du Burundi, https://cnomb.bi/?page_id=75), plus network members. Visitors see names and order numbers; signed-in members also see phone numbers (always shown with +257) and emails.
- **Inscription / Sign-up** open to any doctor with a Burundian **+257** phone number, verified by SMS code. If the number is on the register, the member is linked to their register entry automatically; otherwise they can claim an order number for admin review.
- **Messagerie pro / Professional email**: members request `prenom.nom@MAIL_DOMAIN`; an admin approves (or auto-approve) and the mailbox is created at the mail server, with a temporary password sent by SMS.
- **Invitations**: members invite colleagues by SMS, or share the link on WhatsApp.
- **Discussions / Chat**: real-time channels (Général, Cas cliniques, Emplois & formations) and private one-to-one messages, members only.
- **Alertes / Health alerts**: admins publish public health alerts (pandemics, outbreaks, vaccination campaigns, disasters) at info, alert or emergency level. Active alerts show as a banner on every page, are pushed live to open pages, and can be texted to all members, or to members plus every doctor on the CNOMB register with a phone number. Members can turn off alert texts in their profile.
- **Admin**: refresh the register from cnomb.bi, approve mailboxes and register claims, suspend members, publish alerts.
- French by default, English from the header toggle. Theme: blue `#2a4a9e`, red `#b91c1c`, white, Poppins.

## Run it

Needs Node.js 22.5 or newer (uses the built-in `node:sqlite`, no native modules).

```bash
npm install
cp .env.example .env      # then edit
npm start                 # http://localhost:3000
```

On first start the database is seeded with a bundled snapshot of the register (`data/cnomb-snapshot.psv`, the first 763 entries). Load the full register (about 3,150 final and 280 provisional registrations) from cnomb.bi with:

```bash
npm run import:cnomb
```

or the **Mettre à jour depuis cnomb.bi** button on `/admin`. Re-running updates existing entries without duplicating them. The importer reads the two Ninja Tables on the CNOMB page (table 274, inscriptions définitives; table 194, inscriptions provisoires) through `wp-admin/admin-ajax.php`.

The **first person to register becomes admin** (and any number in `ADMIN_PHONES`), so register yourself first after deploying.

With `SMS_DRIVER=console` (development) SMS codes are printed in the server log and shown on screen.

```bash
npm test                  # unit + end-to-end tests
docker build -t mess-des-docteurs . && docker run -p 3000:3000 -v mdd-data:/app/data --env-file .env mess-des-docteurs
```

## What you need to choose before going live

| Item | Options | Setting |
|---|---|---|
| Domain for the site and emails | e.g. `medecins.bi` (via the .bi registry) or a `.org`/`.com` | `BASE_URL`, `MAIL_DOMAIN` |
| Hosting | Any VPS or container host running Node 22; keep `data/` on a persistent disk and back it up | |
| SMS provider (codes, invites, alerts) | Africa's Talking or Twilio; both reach Burundian numbers | `SMS_DRIVER` and keys |
| Mail server | Self-hosted [mailcow](https://mailcow.email) (supported out of the box), or another provider via a new driver in `src/drivers/mailbox.js` | `MAIL_DRIVER`, `MAILCOW_*` |

## Layout

```
server.js               entry point (HTTP + Socket.IO)
src/config.js           settings from environment / .env
src/db.js               SQLite schema
src/register.js         CNOMB import and name parsing
src/phone.js            +257 normalisation and formatting
src/otp.js              SMS codes
src/mail.js             mailbox requests and provisioning
src/alerts.js           public health alerts and SMS broadcast
src/chat.js             real-time chat
src/drivers/            SMS and mailbox providers
src/routes/             pages
views/, public/         templates, CSS, browser scripts
scripts/import-cnomb.js register import CLI
test/                   tests (node --test)
```
