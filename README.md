# Air Haifa Pilot Swap

Private, mobile-friendly shared calendar for **up to four preapproved pilots**. One pilot is the administrator. Pilots can post flight/shift offers or requests, explain what dates and flights they would exchange, express interest, and accept/decline matches. The server and PostgreSQL database keep everyone's data in sync when they refresh or change months. This is an independent coordination board, **not an official Air Haifa product or roster system**.

## Included

- `server/index.js` – Express API, sign-in by approved email (plus optional access code), secure session cookies, pilot administration, listings and exchange-interest decisions.
- `server/db.js`, `server/schema.sql`, `server/migrate.js` – shared PostgreSQL database and setup.
- `server/validation.js` – input validation.
- `public/` – responsive browser app (no external frontend services or build step).
- `tests/` – validation tests.
- `docker-compose.yml` – local PostgreSQL.
- `render.yaml` – optional Render blueprint for a web server and persistent hosted PostgreSQL.
- `.env.example` – configuration template. **Never commit `.env`.**

## Requirements

Node.js 20+, npm, Docker Desktop (or an existing PostgreSQL server) Users need only a browser.

## Local quick start

```bash
cp .env.example .env
# Set ADMIN_EMAIL to the first authorized pilot's real address.
docker compose up -d db
npm install
npm run db:setup
npm start
```

Open http://localhost:3000 and sign in with `ADMIN_EMAIL`. The first admin signs in, opens **Admin**, and adds the other **three approved pilots**. Each then signs in with their own address. Set your display name under **Pilots**.

To run tests: `npm test`. To stop PostgreSQL without deleting data: `docker compose down`. **Do not** use `docker compose down -v` unless you intend to erase the local database.

## Making it available to four people online

The local address is only accessible from your computer. Deploy the **web server plus PostgreSQL** to an HTTPS host such as Render so all four pilots can open the same site from separate devices. The provided `render.yaml` is a starting blueprint. Provision a PostgreSQL database, connect its `DATABASE_URL`, optionally set `ADMIN_EMAIL` (if unset, the first pilot to sign in becomes the admin), and set `BASE_URL` to your exact public `https://...` URL (on Render this defaults to the service's own address). Set `ACCESS_CODE` to a code you share only with the approved pilots (recommended; see Security). For managed databases requiring verified TLS, set `DATABASE_SSL=true` and ensure your host trusts its CA certificate. Set `NODE_ENV=production`. On every deploy run `npm run db:setup` before `npm start` (the blueprint does this). The production server refuses to start unless BASE_URL uses HTTPS.

**Running without a separate database:** if `DATABASE_URL` is not set, the server keeps its data in memory using pg-mem, a lightweight PostgreSQL emulator (about 100 MB, so it fits a 512 MB instance). That data is **erased whenever the server restarts** (every deploy, and on Render's free plan whenever the service sleeps after inactivity); the `ADMIN_EMAIL` account is recreated (or, without it, the next pilot to sign in becomes admin), but other pilots and all listings must be re-entered. To keep data, set `DATABASE_URL` to a real PostgreSQL database.

**Security:** Four total approved accounts, including admin. Admin cannot remove their own account. Sign-in does not verify email ownership: anyone who types an approved address can sign in as that pilot. Set `ACCESS_CODE` so a shared code is also required, and share it only with the approved pilots. Sign-in attempts are rate limited. Session cookies are HTTP-only, SameSite=Lax, and Secure on HTTPS production; sessions expire in seven days. Server checks request Origin and has request/login rate limits. Only the listing owner may change/close it or decide on interested pilots, and accepted matches atomically close out competing pending requests. Pilot emails are visible only to signed-in approved pilots. Existing revoked sessions and listings are deleted when an admin removes a pilot.

**Operational notes:** Keep your database backups and TLS certificates current. A single PostgreSQL database makes the board multi-user; no data resides only in one pilot's browser. This version uses refresh after interactions and does **not** use live push notifications, email alerts on new exchange requests, bidirectional official-roster integration, or automatic regulatory/duty-time checking. Users can manually refresh the calendar and inbox. No exchange takes effect until all required company scheduling and duty-time approvals are obtained. The optional "Air Haifa" name is descriptive only; obtain company approval before branding or deployment.

## Calendar behavior

Orange = offered flights/shifts; blue = requested flights/shifts; green = matched. Click a colored entry to see details and send interest, or click a day number / **New exchange** to post. Browse months with arrows. After an owner accepts an interested pilot, the entry turns green; the pilots can use the directory to contact one another. "My listings" shows listings in the currently loaded date range; return to the matching calendar month for older listings.

## API overview

`GET /api/auth/options`, `POST /api/auth/login`, `GET /api/me`, `PATCH /api/me`, `POST /api/auth/logout`; `GET /api/pilots`, `POST /api/admin/pilots`, `DELETE /api/admin/pilots/:id`; `GET /api/listings?from=ISO&to=ISO`, `GET /api/listings/:id`, `POST /api/listings`, `PATCH /api/listings/:id`, `POST /api/listings/:id/close`, `POST /api/listings/:id/interest`; `GET /api/interests`, `POST /api/interests/:id/decision`, `POST /api/interests/:id/withdraw`. All APIs except requesting a login link require a valid session. Mutating APIs require a matching `Origin` header (browser `fetch` supplies one for JSON POST/PATCH/DELETE in normal modern browsers).

## Important privacy boundaries

Do not enter passenger details, full roster exports, private company operational records, or other sensitive information. The four approved pilots can see all listings and one another's approved email addresses. Obtain appropriate permission and company approval before using this for real crew scheduling.
