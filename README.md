# Air Haifa Pilot Swap

Private, mobile-friendly shared calendar for **up to four preapproved pilots**. One pilot is the administrator. Pilots can post flight/shift offers or requests, explain what dates and flights they would exchange, express interest, and accept/decline matches. The server and PostgreSQL database keep everyone's data in sync when they refresh or change months. This is an independent coordination board, **not an official Air Haifa product or roster system**.

## Included

- `server/index.js` – Express API, single-use email links, secure session cookies, pilot administration, listings and exchange-interest decisions.
- `server/db.js`, `server/schema.sql`, `server/migrate.js` – shared PostgreSQL database and setup.
- `server/mail.js`, `server/validation.js` – SMTP and input validation.
- `public/` – responsive browser app (no external frontend services or build step).
- `tests/` – validation tests.
- `docker-compose.yml` – local PostgreSQL.
- `render.yaml` – optional Render blueprint for a web server and persistent hosted PostgreSQL.
- `.env.example` – configuration template. **Never commit `.env`.**

## Requirements

Node.js 20+, npm, Docker Desktop (or an existing PostgreSQL server), and SMTP access for deployed email sign-in. Users need only a browser.

## Local quick start

```bash
cp .env.example .env
# Set ADMIN_EMAIL to the first authorized pilot's real address.
docker compose up -d db
npm install
npm run db:setup
npm start
```

Open http://localhost:3000. Enter `ADMIN_EMAIL`. In **local development only**, if SMTP is blank, your sign-in link is printed in the `npm start` server console; copy the link into your browser. Otherwise, it arrives by email. The first admin signs in, opens **Admin**, and adds the other **three approved pilots**. Each then signs in with their own address. Set your display name under **Pilots**.

To run tests: `npm test`. To stop PostgreSQL without deleting data: `docker compose down`. **Do not** use `docker compose down -v` unless you intend to erase the local database.

## Making it available to four people online

The local address is only accessible from your computer. Deploy the **web server plus PostgreSQL** to an HTTPS host such as Render so all four pilots can open the same site from separate devices. The provided `render.yaml` is a starting blueprint. Provision a PostgreSQL database, connect its `DATABASE_URL`, configure `ADMIN_EMAIL`, and set `BASE_URL` to your exact public `https://...` URL. Supply `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` from your email provider. For managed databases requiring verified TLS, set `DATABASE_SSL=true` and ensure your host trusts its CA certificate. Set `NODE_ENV=production`. On every deploy run `npm run db:setup` before `npm start` (the blueprint does this). The production server refuses to start unless BASE_URL uses HTTPS and SMTP is configured.

**Running without a separate database:** if `DATABASE_URL` is not set, the server runs a built-in PostgreSQL (PGlite) inside its own process and sets it up on start. Without `DATA_DIR`, that data lives in memory and is **erased whenever the server restarts** (every deploy, and on Render's free plan whenever the service sleeps after inactivity); the `ADMIN_EMAIL` account is recreated, but other pilots and all listings must be re-entered. To keep data, attach a persistent disk and set `DATA_DIR` to a folder on it (e.g. `/var/data/db`).

**Security:** Four total approved accounts, including admin. Admin cannot remove their own account. Unapproved addresses always get a generic sign-in response, but cannot log in. Links are cryptographically random, SHA-256-hashed in the database, one-time use, and expire in 15 minutes. Session cookies are HTTP-only, SameSite=Lax, and Secure on HTTPS production; sessions expire in seven days. Server checks request Origin and has request/login rate limits. Only the listing owner may change/close it or decide on interested pilots, and accepted matches atomically close out competing pending requests. Pilot emails are visible only to signed-in approved pilots. Existing revoked sessions and listings are deleted when an admin removes a pilot.

**Operational notes:** In production, configure SPF/DKIM for the sender and SMTP credentials as host secrets. Keep your database backups and TLS certificates current. A single PostgreSQL database makes the board multi-user; no data resides only in one pilot's browser. This version uses refresh after interactions and does **not** use live push notifications, email alerts on new exchange requests, bidirectional official-roster integration, or automatic regulatory/duty-time checking. Users can manually refresh the calendar and inbox. No exchange takes effect until all required company scheduling and duty-time approvals are obtained. The optional "Air Haifa" name is descriptive only; obtain company approval before branding or deployment.

## Calendar behavior

Orange = offered flights/shifts; blue = requested flights/shifts; green = matched. Click a colored entry to see details and send interest, or click a day number / **New exchange** to post. Browse months with arrows. After an owner accepts an interested pilot, the entry turns green; the pilots can use the directory to contact one another. "My listings" shows listings in the currently loaded date range; return to the matching calendar month for older listings.

## API overview

`POST /api/auth/request`, `GET /auth/verify?token=...`, `GET /api/me`, `PATCH /api/me`, `POST /api/auth/logout`; `GET /api/pilots`, `POST /api/admin/pilots`, `DELETE /api/admin/pilots/:id`; `GET /api/listings?from=ISO&to=ISO`, `GET /api/listings/:id`, `POST /api/listings`, `PATCH /api/listings/:id`, `POST /api/listings/:id/close`, `POST /api/listings/:id/interest`; `GET /api/interests`, `POST /api/interests/:id/decision`, `POST /api/interests/:id/withdraw`. All APIs except requesting a login link require a valid session. Mutating APIs require a matching `Origin` header (browser `fetch` supplies one for JSON POST/PATCH/DELETE in normal modern browsers).

## Important privacy boundaries

Do not enter passenger details, full roster exports, private company operational records, or other sensitive information. The four approved pilots can see all listings and one another's approved email addresses. Obtain appropriate permission and company approval before using this for real crew scheduling.
