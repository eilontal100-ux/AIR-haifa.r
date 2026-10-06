# Pilot Swap

Private, mobile-friendly shared calendar for a private group of pilots. One pilot is the administrator. Pilots can post flight/shift offers or requests, explain what dates and flights they would exchange, express interest, and accept/decline matches. The server and PostgreSQL database keep everyone's data in sync when they refresh or change months. This is an independent coordination board, **not an official airline product or roster system**.

## Included

- `server/index.js` – Express API, sign-in by email plus shared password (`APP_PASSWORD`), secure session cookies, pilot administration, listings and exchange-interest decisions.
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

Open http://localhost:3000, enter the pilot password, then create your account with your email (the first account becomes the admin). Other pilots do the same with their own email.

To run tests: `npm test`. To stop PostgreSQL without deleting data: `docker compose down`. **Do not** use `docker compose down -v` unless you intend to erase the local database.

## Making it available online

The local address is only accessible from your computer. Deploy the **web server plus PostgreSQL** to an HTTPS host such as Render so all pilots can open the same site from separate devices. The provided `render.yaml` is a starting blueprint. Provision a PostgreSQL database, connect its `DATABASE_URL`, optionally set `ADMIN_EMAIL` (if unset, the first pilot to sign in becomes the admin), and set `BASE_URL` to your exact public `https://...` URL (on Render this defaults to the service's own address). Set `APP_PASSWORD` to a password you share only with your pilots (recommended; see Security). For managed databases requiring verified TLS, set `DATABASE_SSL=true` and ensure your host trusts its CA certificate. Set `NODE_ENV=production`. The server creates its tables (and the `ADMIN_EMAIL` admin) on its own when it starts, so `npm start` alone is enough; `npm run db:setup` does the same ahead of time. The production server refuses to start unless BASE_URL uses HTTPS.

**Running without a separate database:** if `DATABASE_URL` is not set, the server keeps its data in memory using pg-mem, a lightweight PostgreSQL emulator (about 100 MB, so it fits a 512 MB instance). That data is **erased whenever the server restarts** (every deploy, and on Render's free plan whenever the service sleeps after inactivity); the `ADMIN_EMAIL` account is recreated (or, without it, the next pilot to sign in becomes admin), but other pilots and all listings must be re-entered. To keep data, set `DATABASE_URL` to a real PostgreSQL database.

**Security:** There is no limit on the number of pilot accounts. Admin cannot remove their own account. Sign-in does not verify email ownership. With `APP_PASSWORD` set, anyone who has the password can sign in with any email, and a new email joins as a pilot, so share it only with your pilots. Without `APP_PASSWORD`, only emails the admin has added can sign in, and anyone who types one of them gets in. Sign-in attempts are rate limited. (`ACCESS_CODE` is accepted as an older name for `APP_PASSWORD`.) Session cookies are HTTP-only, SameSite=Lax, and Secure on HTTPS production; sessions expire in seven days. Server checks request Origin and has request/login rate limits. Only the listing owner may change/close it or decide on interested pilots, and accepted matches atomically close out competing pending requests. Pilot emails are visible only to signed-in approved pilots. Existing revoked sessions and listings are deleted when an admin removes a pilot.

**Operational notes:** Keep your database backups and TLS certificates current. A single PostgreSQL database makes the board multi-user; no data resides only in one pilot's browser. This version uses refresh after interactions and does **not** use live push notifications, email alerts on new exchange requests, bidirectional official-roster integration, or automatic regulatory/duty-time checking. Users can manually refresh the calendar and inbox. No exchange takes effect until all required company scheduling and duty-time approvals are obtained.

## Settings: dark mode and notifications

The **Settings** tab lets each device choose a Light or Dark theme (saved in that browser) and turn push notifications on or off:

- **New listings**: whenever anyone else posts an offer or request.
- **My exchanges**: changes in your exchange inbox: interest in your listings, accepted or declined interest, withdrawn interest, and edits or removals of listings you are interested in.

Notifications are per device. Tapping one opens the app. On iPhone and iPad (iOS 16.4+), they only work after adding the site to the Home Screen (Share → Add to Home Screen) and opening it from there. Signing out turns them off for that device.

The server creates its web-push (VAPID) keys on first use and stores them in the database. To manage them yourself, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (generate with `npx web-push generate-vapid-keys`). Notification times use `APP_TIMEZONE` (default `Asia/Jerusalem`). With the built-in in-memory database, subscriptions are lost on restart, so pilots need to turn notifications on again; with `DATABASE_URL` they persist.

## Time zone

**Settings → Time** chooses whether this device shows and enters times in its **local time** or in **UTC** (saved in that browser). The calendar shows the current choice next to the month name, and the start/end fields in the exchange form are labelled with it.

## My flights (Leon roster import)

**Import roster** (above the calendar) reads a roster PDF exported from Leon and adds your duties to your own calendar in purple: the report (check-in) time, end (check-out) time and flight numbers, plus your function and the other crew member when the PDF has those columns. Choose the month and whether the file's times are UTC or local (detected from the file when it says so), check the preview, then add. Importing a month again replaces that month; **Remove month** deletes your imported flights for it. The PDF is read in the browser with pdf.js and never uploaded; only the extracted duties are saved, and only you can see them. Tap one of your flights and **Offer this flight** to post it as an exchange with the details filled in. Roster layouts vary, so the reader looks for a header row with Check-in and Check-out columns; always check the preview.

## Describe it in your own words

When posting a new exchange, you can type a short message in English or Hebrew (for example "Giving away 6H 123 on 14/11, 06:00-14:30, captain, with Dana") and tap **Fill in the form**. The app recognizes giving/looking for, flight or shift, flight number, date, times, role and the other crew member, puts your message in the notes, and leaves everything for you to check before publishing. This runs on your device; no text is sent to any outside service.

## Calendar behavior

Orange = offered flights/shifts; blue = requested flights/shifts; green = matched; purple = your own imported flights (visible only to you). Click a colored entry to see details and send interest, or click a day number / **New exchange** to post. Browse months with arrows. After an owner accepts an interested pilot, the entry turns green; the pilots can use the directory to contact one another. "My listings" shows listings in the currently loaded date range; return to the matching calendar month for older listings.

## API overview

`GET /api/auth/options`, `POST /api/auth/password`, `POST /api/auth/login`, `GET /api/me`, `PATCH /api/me`, `POST /api/auth/logout`; `GET /api/pilots`, `POST /api/admin/pilots`, `DELETE /api/admin/pilots/:id`; `GET /api/listings?from=ISO&to=ISO`, `GET /api/listings/:id`, `POST /api/listings`, `PATCH /api/listings/:id`, `DELETE /api/listings/:id`, `POST /api/listings/:id/unmatch`, `POST /api/listings/:id/interest`; `GET /api/interests`, `POST /api/interests/:id/decision`, `POST /api/interests/:id/withdraw`; `GET /api/roster?from=ISO&to=ISO`, `POST /api/roster/import`, `DELETE /api/roster?from=ISO&to=ISO` (your own imported flights only). All APIs except requesting a login link require a valid session. Mutating APIs require a matching `Origin` header (browser `fetch` supplies one for JSON POST/PATCH/DELETE in normal modern browsers).

## Important privacy boundaries

Do not enter passenger details, private company operational records, or other sensitive information. All signed-in pilots can see all listings and one another's approved email addresses. Imported roster flights are visible only to the pilot who imported them. Obtain appropriate permission and company approval before using this for real crew scheduling.
