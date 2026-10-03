'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');
const { pool, query, setup } = require('./db');
const push = require('./push');
const { normalizeEmail, clean, parseListing } = require('./validation');

const app = express();
const prod = process.env.NODE_ENV === 'production';
// Render sets RENDER_EXTERNAL_URL to the service's public address.
const baseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL;
if (!baseUrl) throw new Error('Set BASE_URL in .env');
if (prod && !baseUrl.startsWith('https://')) throw new Error('Production requires an HTTPS BASE_URL');
// Shared password every pilot enters with their email to sign in. When set, anyone
// with the password can join; without it, only emails already on the list can.
const accessCode = process.env.APP_PASSWORD || process.env.ACCESS_CODE || '';
app.disable('x-powered-by');
app.set('trust proxy', prod ? 1 : 'loopback');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], formAction: ["'self'"], objectSrc: ["'none'"] } } }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
// Only failed sign-ins count, so pilots sharing a network are not blocked by each other.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 7, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const sendError = (res, status, error) => res.status(status).json({ error });
function checkOrigin(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  // A browser's same-origin fetch sets Origin on POST/PATCH/DELETE.
  if (!origin || origin !== new URL(baseUrl).origin) return sendError(res, 403, 'Invalid request origin.');
  next();
}
app.use('/api', checkOrigin);
async function auth(req, res, next) {
  try {
    const session = req.cookies.pilot_session;
    if (!session) return sendError(res, 401, 'Sign in to continue.');
    const { rows } = await query(`SELECT p.id, p.email, p.display_name, p.role FROM sessions s JOIN pilots p ON p.id=s.pilot_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW()`, [tokenHash(session)]);
    if (!rows.length) return sendError(res, 401, 'Session expired. Sign in again.');
    req.pilot = rows[0]; next();
  } catch (err) { next(err); }
}
function admin(req, res, next) { if (req.pilot.role !== 'admin') return sendError(res, 403, 'Admin only.'); next(); }
function safe(fn) { return (req, res, next) => Promise.resolve(fn(req, res)).catch(next); }
function setCookie(res, token) { res.cookie('pilot_session', token, { httpOnly: true, sameSite: 'lax', secure: prod, path: '/', maxAge: 7 * 86400000 }); }
const listingSelect = `SELECT l.*, p.email AS owner_email, p.display_name AS owner_name,
  m.email AS matched_email, COALESCE(ic.n, 0) AS interest_count
  FROM listings l JOIN pilots p ON p.id=l.owner_id LEFT JOIN pilots m ON m.id=l.matched_with
  LEFT JOIN (SELECT listing_id, count(*)::int AS n FROM interests WHERE status='pending' GROUP BY listing_id) ic ON ic.listing_id=l.id`;
function listingJSON(row) {
  return { id: String(row.id), ownerId: String(row.owner_id), ownerEmail: row.owner_email, ownerName: row.owner_name,
    intent: row.intent, kind: row.kind, startsAt: row.starts_at, endsAt: row.ends_at, flightNumber: row.flight_number,
    crewRole: row.crew_role, crewName: row.crew_name, exchangeDates: row.exchange_dates,
    exchangeFlights: row.exchange_flights, details: row.details, status: row.status, matchedEmail: row.matched_email, matchedWith: row.matched_with == null ? null : String(row.matched_with),
    interestCount: row.interest_count, createdAt: row.created_at };
}
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/auth/options', safe(async (req, res) => {
  const { rows } = await query('SELECT count(*)::int AS n FROM pilots');
  res.json({ passwordRequired: !!accessCode, firstSignIn: rows[0].n === 0 });
}));
const passwordMatches = value => crypto.timingSafeEqual(
  Buffer.from(tokenHash(typeof value === 'string' ? value : '')), Buffer.from(tokenHash(accessCode)));
// Step 1 of sign-in: check the shared password before asking for an email.
app.post('/api/auth/password', loginLimiter, (req, res) => {
  if (accessCode && !passwordMatches(req.body.password)) return sendError(res, 401, 'Wrong password.');
  res.json({ ok: true });
});
// Find the pilot for this email. With no pilots yet (ADMIN_EMAIL not set), the first
// pilot to sign in becomes the admin; with a password set, new emails join as pilots.
// Returns { id }, or undefined if the email may not sign in.
async function findOrClaimPilot(email) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(839117)'); // same lock as adding pilots
    let { rows } = await client.query('SELECT id FROM pilots WHERE email=$1', [email]);
    if (!rows.length) ({ rows } = await client.query("INSERT INTO pilots(email, role) SELECT $1, 'admin' WHERE NOT EXISTS (SELECT 1 FROM pilots) RETURNING id", [email]));
    if (!rows.length && accessCode) ({ rows } = await client.query('INSERT INTO pilots(email) VALUES($1) RETURNING id', [email]));
    await client.query('COMMIT');
    return rows[0];
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}
app.post('/api/auth/login', loginLimiter, safe(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (accessCode && !passwordMatches(req.body.password)) return sendError(res, 401, 'Wrong password.');
  if (!email) return sendError(res, 400, 'Enter a valid email.');
  const pilot = await findOrClaimPilot(email);
  if (!pilot) return sendError(res, 401, 'This email is not on the approved pilot list.');
  const name = clean(req.body.displayName, 90);
  if (name) await query("UPDATE pilots SET display_name=$1 WHERE id=$2 AND display_name=''", [name, pilot.id]);
  const session = newToken();
  await query("INSERT INTO sessions(pilot_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '7 days')", [pilot.id, tokenHash(session)]);
  setCookie(res, session);
  res.json({ ok: true });
}));
app.get('/api/me', auth, (req, res) => res.json({ pilot: { id: String(req.pilot.id), email: req.pilot.email, displayName: req.pilot.display_name, role: req.pilot.role } }));
app.post('/api/auth/logout', auth, safe(async (req, res) => {
  await query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(req.cookies.pilot_session)]);
  res.clearCookie('pilot_session', { path: '/', httpOnly: true, sameSite: 'lax', secure: prod });
  res.json({ ok: true });
}));
app.patch('/api/me', auth, safe(async (req, res) => {
  const name = clean(req.body.displayName, 90);
  if (!name) return sendError(res, 400, 'Name is required.');
  await query('UPDATE pilots SET display_name=$1 WHERE id=$2', [name, req.pilot.id]);
  res.json({ ok: true, displayName: name });
}));
app.get('/api/pilots', auth, safe(async (req, res) => {
  const { rows } = await query('SELECT id,email,display_name,role FROM pilots ORDER BY role,email');
  res.json({ pilots: rows.map(r => ({ id: String(r.id), email: r.email, displayName: r.display_name, role: r.role })) });
}));
app.post('/api/admin/pilots', auth, admin, safe(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return sendError(res, 400, 'Enter a valid email.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(839117)'); // same lock as sign-up
    const existing = await client.query('SELECT id FROM pilots WHERE email=$1', [email]);
    if (existing.rowCount) { await client.query('ROLLBACK'); return sendError(res, 409, 'Pilot already exists.'); }
    await client.query('INSERT INTO pilots(email) VALUES($1)', [email]);
    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}));
app.delete('/api/admin/pilots/:id', auth, admin, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid pilot ID.');
  if (String(req.pilot.id) === req.params.id) return sendError(res, 400, 'You cannot remove your own admin account.');
  const deleted = await query("DELETE FROM pilots WHERE id=$1 AND role='pilot' RETURNING id", [req.params.id]);
  if (!deleted.rowCount) return sendError(res, 404, 'Pilot not found.');
  res.json({ ok: true });
}));
// Push notification settings for this device (one subscription per browser).
app.get('/api/push/key', auth, safe(async (req, res) => res.json({ publicKey: (await push.vapidKeys()).publicKey })));
app.post('/api/push/status', auth, safe(async (req, res) => {
  const endpoint = typeof req.body.endpoint === 'string' ? req.body.endpoint : '';
  const { rows } = await query('SELECT new_listings,my_exchanges FROM push_subscriptions WHERE endpoint=$1 AND pilot_id=$2', [endpoint, req.pilot.id]);
  res.json({ newListings: !!rows[0]?.new_listings, myExchanges: !!rows[0]?.my_exchanges });
}));
app.post('/api/push/subscription', auth, safe(async (req, res) => {
  const sub = push.parseSubscription(req.body.subscription);
  if (!sub) return sendError(res, 400, 'This browser sent an invalid push subscription.');
  const newListings = req.body.newListings === true, myExchanges = req.body.myExchanges === true;
  if (!newListings && !myExchanges) {
    await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]);
  } else {
    // A device belongs to whoever last turned notifications on there.
    await query(`INSERT INTO push_subscriptions(pilot_id,endpoint,p256dh,auth,new_listings,my_exchanges) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(endpoint) DO UPDATE SET pilot_id=EXCLUDED.pilot_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
      new_listings=EXCLUDED.new_listings,my_exchanges=EXCLUDED.my_exchanges`, [req.pilot.id, sub.endpoint, sub.p256dh, sub.auth, newListings, myExchanges]);
  }
  res.json({ newListings, myExchanges });
}));
app.get('/api/listings', auth, safe(async (req, res) => {
  const from = new Date(String(req.query.from || '')), to = new Date(String(req.query.to || ''));
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || to <= from || to-from > 93*86400000) return sendError(res, 400, 'Select a date range of up to 93 days.');
  const { rows } = await query(`${listingSelect} WHERE l.starts_at<$2 AND l.ends_at>$1 ORDER BY l.starts_at`, [from, to]);
  res.json({ listings: rows.map(listingJSON) });
}));
app.get('/api/listings/:id', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  const { rows } = await query(`${listingSelect} WHERE l.id=$1`, [req.params.id]);
  if (!rows.length) return sendError(res, 404, 'Listing not found.');
  res.json({ listing: listingJSON(rows[0]) });
}));
app.post('/api/listings', auth, safe(async (req, res) => {
  let l; try { l = parseListing(req.body); } catch (e) { return sendError(res, 400, e.message); }
  const { rows } = await query(`INSERT INTO listings(owner_id,intent,kind,starts_at,ends_at,flight_number,crew_role,crew_name,exchange_dates,exchange_flights,details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [req.pilot.id,l.intent,l.kind,l.startsAt,l.endsAt,l.flightNumber,l.crewRole,l.crewName,l.exchangeDates,l.exchangeFlights,l.details]);
  res.status(201).json({ id: String(rows[0].id) });
  push.notifyNewListing({ id: rows[0].id, intent: l.intent, kind: l.kind, flight_number: l.flightNumber, starts_at: l.startsAt, ends_at: l.endsAt }, req.pilot);
}));
app.patch('/api/listings/:id', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  let l; try { l = parseListing(req.body); } catch (e) { return sendError(res, 400, e.message); }
  const result = await query(`UPDATE listings SET intent=$1,kind=$2,starts_at=$3,ends_at=$4,flight_number=$5,crew_role=$6,crew_name=$7,
     exchange_dates=$8,exchange_flights=$9,details=$10,updated_at=NOW() WHERE id=$11 AND owner_id=$12 AND status='open' RETURNING id`,
    [l.intent,l.kind,l.startsAt,l.endsAt,l.flightNumber,l.crewRole,l.crewName,l.exchangeDates,l.exchangeFlights,l.details,req.params.id,req.pilot.id]);
  if (!result.rowCount) return sendError(res, 403, 'Only the owner can edit an open listing.');
  res.json({ ok: true });
  const interested = await query("SELECT from_pilot_id FROM interests WHERE listing_id=$1 AND status IN ('pending','accepted')", [req.params.id]);
  push.notifyExchange(interested.rows.map(r => r.from_pilot_id), { title: `Listing updated: ${push.listingName({ kind: l.kind, flight_number: l.flightNumber })}`,
    body: `${push.pilotName(req.pilot)} changed a listing you're interested in.`, tag: `listing-${req.params.id}` });
}));
app.delete('/api/listings/:id', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  const interested = await query(`SELECT i.from_pilot_id FROM interests i JOIN listings l ON l.id=i.listing_id
    WHERE i.listing_id=$1 AND l.owner_id=$2 AND i.status IN ('pending','accepted')`, [req.params.id, req.pilot.id]);
  // Interests in the listing are removed with it (ON DELETE CASCADE).
  const result = await query('DELETE FROM listings WHERE id=$1 AND owner_id=$2 RETURNING id,kind,flight_number', [req.params.id, req.pilot.id]);
  if (!result.rowCount) return sendError(res, 403, 'Only the owner can delete a listing.');
  res.json({ ok: true });
  push.notifyExchange(interested.rows.map(r => r.from_pilot_id), { title: `Listing removed: ${push.listingName(result.rows[0])}`,
    body: `${push.pilotName(req.pilot)} deleted a listing you were interested in.`, tag: `listing-${req.params.id}` });
}));
app.post('/api/listings/:id/interest', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  const message = clean(req.body.message, 1000);
  const { rows } = await query(`INSERT INTO interests(listing_id,from_pilot_id,message)
    SELECT id,$2::bigint,$3 FROM listings WHERE id=$1 AND owner_id<>$2 AND status='open'
    ON CONFLICT(listing_id,from_pilot_id) DO UPDATE SET message=EXCLUDED.message,status='pending',updated_at=NOW()
    RETURNING id`, [req.params.id, req.pilot.id, message]);
  if (!rows.length) return sendError(res, 400, 'This listing is unavailable or belongs to you.');
  res.status(201).json({ ok: true });
  const listing = (await query('SELECT owner_id,kind,flight_number FROM listings WHERE id=$1', [req.params.id])).rows[0];
  if (listing) push.notifyExchange([listing.owner_id], { title: `New interest in ${push.listingName(listing)}`,
    body: `${push.pilotName(req.pilot)} is interested${message ? `: ${message.slice(0, 120)}` : '.'}`, tag: `interest-${rows[0].id}` });
}));
app.get('/api/interests', auth, safe(async (req, res) => {
  const { rows } = await query(`SELECT i.id, i.listing_id, i.from_pilot_id, i.message, i.status, i.created_at,
    p.email AS from_email, p.display_name AS from_name, l.owner_id,l.intent,l.flight_number,l.starts_at,l.kind
    FROM interests i JOIN listings l ON l.id=i.listing_id JOIN pilots p ON p.id=i.from_pilot_id
    WHERE l.owner_id=$1 OR i.from_pilot_id=$1 ORDER BY i.created_at DESC LIMIT 200`, [req.pilot.id]);
  res.json({ interests: rows.map(r => ({ id: String(r.id), listingId: String(r.listing_id), fromPilotId: String(r.from_pilot_id),
    fromEmail: r.from_email, fromName: r.from_name, ownerId: String(r.owner_id), message: r.message, status: r.status,
    createdAt: r.created_at, intent: r.intent, flightNumber: r.flight_number, startsAt: r.starts_at, kind: r.kind })) });
}));
app.post('/api/interests/:id/decision', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !['accepted','declined'].includes(req.body.decision)) return sendError(res, 400, 'Invalid decision.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT i.*,l.owner_id,l.status AS listing_status,l.kind,l.flight_number FROM interests i
      JOIN listings l ON l.id=i.listing_id WHERE i.id=$1 FOR UPDATE OF i,l`, [req.params.id]);
    const i = rows[0];
    if (!i) { await client.query('ROLLBACK'); return sendError(res, 404, 'Interest not found.'); }
    if (String(i.owner_id) !== String(req.pilot.id) || i.status !== 'pending' || i.listing_status !== 'open') {
      await client.query('ROLLBACK'); return sendError(res, 403, 'Only the owner can decide on a pending interest for an open listing.');
    }
    let others = [];
    if (req.body.decision === 'accepted') {
      others = (await client.query("SELECT from_pilot_id FROM interests WHERE listing_id=$1 AND status='pending' AND id<>$2", [i.listing_id, i.id])).rows.map(r => r.from_pilot_id);
      await client.query("UPDATE listings SET status='matched',matched_with=$1,updated_at=NOW() WHERE id=$2", [i.from_pilot_id,i.listing_id]);
      await client.query("UPDATE interests SET status='declined',updated_at=NOW() WHERE listing_id=$1 AND status='pending' AND id<>$2", [i.listing_id, i.id]);
    }
    await client.query('UPDATE interests SET status=$1,updated_at=NOW() WHERE id=$2', [req.body.decision, i.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
    const name = push.listingName(i), owner = push.pilotName(req.pilot), accepted = req.body.decision === 'accepted';
    push.notifyExchange([i.from_pilot_id], { title: `Interest ${accepted ? 'accepted' : 'declined'}: ${name}`,
      body: accepted ? `${owner} accepted your interest. Coordinate the swap directly.` : `${owner} declined your interest.`, tag: `interest-${i.id}` });
    push.notifyExchange(others, { title: `Interest declined: ${name}`, body: 'This listing was matched with another pilot.', tag: `listing-${i.listing_id}` });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}));
// Cancel a match: either side can undo it, and the listing is open again.
app.post('/api/listings/:id/unmatch', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  const client = await pool.connect();
  let l;
  try {
    await client.query('BEGIN');
    l = (await client.query('SELECT id,owner_id,matched_with,status,kind,flight_number FROM listings WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    const me = String(req.pilot.id);
    if (!l || l.status !== 'matched' || (String(l.owner_id) !== me && String(l.matched_with) !== me)) {
      await client.query('ROLLBACK'); return sendError(res, 403, 'Only the two pilots in a match can cancel it.');
    }
    await client.query("UPDATE listings SET status='open',matched_with=NULL,updated_at=NOW() WHERE id=$1", [l.id]);
    // The matched interest is closed: declined if the owner cancels, withdrawn if the other pilot does.
    await client.query("UPDATE interests SET status=$1,updated_at=NOW() WHERE listing_id=$2 AND from_pilot_id=$3 AND status='accepted'",
      [String(l.owner_id) === me ? 'declined' : 'withdrawn', l.id, l.matched_with]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
  res.json({ ok: true });
  const other = String(l.owner_id) === String(req.pilot.id) ? l.matched_with : l.owner_id;
  push.notifyExchange([other], { title: `Match cancelled: ${push.listingName(l)}`,
    body: `${push.pilotName(req.pilot)} cancelled the match. The listing is open again.`, tag: `listing-${l.id}` });
}));
app.post('/api/interests/:id/withdraw', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid interest ID.');
  const result = await query("UPDATE interests SET status='withdrawn',updated_at=NOW() WHERE id=$1 AND from_pilot_id=$2 AND status='pending' RETURNING id,listing_id", [req.params.id,req.pilot.id]);
  if (!result.rowCount) return sendError(res, 403, 'You can only withdraw your own pending interest.');
  res.json({ ok: true });
  const listing = (await query('SELECT owner_id,kind,flight_number FROM listings WHERE id=$1', [result.rows[0].listing_id])).rows[0];
  if (listing) push.notifyExchange([listing.owner_id], { title: `Interest withdrawn: ${push.listingName(listing)}`,
    body: `${push.pilotName(req.pilot)} withdrew their interest.`, tag: `interest-${req.params.id}` });
}));
// This is a matching board, not an official roster: actual duty swaps require separate company approval.
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
// Errors that mean the database is unreachable or misconfigured, not a bug in a request.
const DB_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', '28P01', '28000', '3D000', '08001', '08006', '57P03']);
const isDatabaseError = err => DB_ERROR_CODES.has(err.code) || /SSL|Connection terminated|timeout exceeded when trying to connect|Invalid URL|password authentication/i.test(err.message || '');
app.use((err, req, res, next) => {
  if (isDatabaseError(err)) console.error('Database connection problem. Check DATABASE_URL (and DATABASE_SSL) in the host settings:', err.message);
  else console.error(err);
  if (res.headersSent) return next(err);
  if (isDatabaseError(err)) return sendError(res, 503, "The app can't reach its database right now. If this keeps happening, the site owner should check the DATABASE_URL setting in Render.");
  sendError(res, 500, 'Something went wrong. Please try again.');
});
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Pilot Swap listening at ${baseUrl}`));
  setup().catch(err => console.error('Database setup failed; will retry on the next request. Check DATABASE_URL (and DATABASE_SSL):', err.message));
}
module.exports = app;
