'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');
const { pool, query } = require('./db');
const { normalizeEmail, clean, parseListing } = require('./validation');

const app = express();
const prod = process.env.NODE_ENV === 'production';
// Render sets RENDER_EXTERNAL_URL to the service's public address.
const baseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL;
if (!baseUrl) throw new Error('Set BASE_URL in .env');
if (prod && !baseUrl.startsWith('https://')) throw new Error('Production requires an HTTPS BASE_URL');
// Optional shared code every pilot must enter with their email to sign in.
const accessCode = process.env.ACCESS_CODE || '';
app.disable('x-powered-by');
app.set('trust proxy', prod ? 1 : 'loopback');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], formAction: ["'self'"], objectSrc: ["'none'"] } } }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 7, standardHeaders: 'draft-7', legacyHeaders: false });
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
  m.email AS matched_email, (SELECT count(*)::int FROM interests i WHERE i.listing_id=l.id AND i.status='pending') AS interest_count
  FROM listings l JOIN pilots p ON p.id=l.owner_id LEFT JOIN pilots m ON m.id=l.matched_with`;
function listingJSON(row) {
  return { id: String(row.id), ownerId: String(row.owner_id), ownerEmail: row.owner_email, ownerName: row.owner_name,
    intent: row.intent, kind: row.kind, startsAt: row.starts_at, endsAt: row.ends_at, flightNumber: row.flight_number,
    crewRole: row.crew_role, crewName: row.crew_name, exchangeDates: row.exchange_dates,
    exchangeFlights: row.exchange_flights, details: row.details, status: row.status, matchedEmail: row.matched_email,
    interestCount: row.interest_count, createdAt: row.created_at };
}
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/auth/options', safe(async (req, res) => {
  const { rows } = await query('SELECT count(*)::int AS n FROM pilots');
  res.json({ accessCodeRequired: !!accessCode, firstSignIn: rows[0].n === 0 });
}));
// Find the pilot for this email. With no pilots yet (ADMIN_EMAIL not set),
// the first pilot to sign in becomes the admin.
async function findOrClaimPilot(email) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(839117)'); // same lock as adding pilots
    let { rows } = await client.query('SELECT id FROM pilots WHERE email=$1', [email]);
    if (!rows.length) ({ rows } = await client.query("INSERT INTO pilots(email, role) SELECT $1, 'admin' WHERE NOT EXISTS (SELECT 1 FROM pilots) RETURNING id", [email]));
    await client.query('COMMIT');
    return rows[0];
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}
app.post('/api/auth/login', loginLimiter, safe(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (accessCode) {
    const given = tokenHash(typeof req.body.accessCode === 'string' ? req.body.accessCode : '');
    if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(tokenHash(accessCode)))) return sendError(res, 401, 'Wrong email or access code.');
  }
  const pilot = email && await findOrClaimPilot(email);
  if (!pilot) return sendError(res, 401, accessCode ? 'Wrong email or access code.' : 'This email is not on the approved pilot list.');
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
    await client.query('SELECT pg_advisory_xact_lock(839117)'); // serialize capacity checks across server instances
    const existing = await client.query('SELECT id FROM pilots WHERE email=$1', [email]);
    if (existing.rowCount) { await client.query('ROLLBACK'); return sendError(res, 409, 'Pilot already exists.'); }
    const count = await client.query('SELECT count(*)::int AS n FROM pilots');
    if (count.rows[0].n >= 4) { await client.query('ROLLBACK'); return sendError(res, 409, 'Maximum of four approved pilots reached.'); }
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
}));
app.patch('/api/listings/:id', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  let l; try { l = parseListing(req.body); } catch (e) { return sendError(res, 400, e.message); }
  const result = await query(`UPDATE listings SET intent=$1,kind=$2,starts_at=$3,ends_at=$4,flight_number=$5,crew_role=$6,crew_name=$7,
     exchange_dates=$8,exchange_flights=$9,details=$10,updated_at=NOW() WHERE id=$11 AND owner_id=$12 AND status='open' RETURNING id`,
    [l.intent,l.kind,l.startsAt,l.endsAt,l.flightNumber,l.crewRole,l.crewName,l.exchangeDates,l.exchangeFlights,l.details,req.params.id,req.pilot.id]);
  if (!result.rowCount) return sendError(res, 403, 'Only the owner can edit an open listing.');
  res.json({ ok: true });
}));
app.post('/api/listings/:id/close', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  const result = await query("UPDATE listings SET status='closed',updated_at=NOW() WHERE id=$1 AND owner_id=$2 AND status='open' RETURNING id", [req.params.id,req.pilot.id]);
  if (!result.rowCount) return sendError(res, 403, 'Only the owner can close an open listing.');
  res.json({ ok: true });
}));
app.post('/api/listings/:id/interest', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid listing ID.');
  const message = clean(req.body.message, 1000);
  const { rows } = await query(`INSERT INTO interests(listing_id,from_pilot_id,message)
    SELECT id,$2,$3 FROM listings WHERE id=$1 AND owner_id<>$2 AND status='open'
    ON CONFLICT(listing_id,from_pilot_id) DO UPDATE SET message=EXCLUDED.message,status='pending',updated_at=NOW()
    RETURNING id`, [req.params.id, req.pilot.id, message]);
  if (!rows.length) return sendError(res, 400, 'This listing is unavailable or belongs to you.');
  res.status(201).json({ ok: true });
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
    const { rows } = await client.query(`SELECT i.*,l.owner_id,l.status AS listing_status FROM interests i
      JOIN listings l ON l.id=i.listing_id WHERE i.id=$1 FOR UPDATE OF i,l`, [req.params.id]);
    const i = rows[0];
    if (!i) { await client.query('ROLLBACK'); return sendError(res, 404, 'Interest not found.'); }
    if (String(i.owner_id) !== String(req.pilot.id) || i.status !== 'pending' || i.listing_status !== 'open') {
      await client.query('ROLLBACK'); return sendError(res, 403, 'Only the owner can decide on a pending interest for an open listing.');
    }
    if (req.body.decision === 'accepted') {
      await client.query("UPDATE listings SET status='matched',matched_with=$1,updated_at=NOW() WHERE id=$2", [i.from_pilot_id,i.listing_id]);
      await client.query("UPDATE interests SET status='declined',updated_at=NOW() WHERE listing_id=$1 AND status='pending' AND id<>$2", [i.listing_id, i.id]);
    }
    await client.query('UPDATE interests SET status=$1,updated_at=NOW() WHERE id=$2', [req.body.decision, i.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}));
app.post('/api/interests/:id/withdraw', auth, safe(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Invalid interest ID.');
  const result = await query("UPDATE interests SET status='withdrawn',updated_at=NOW() WHERE id=$1 AND from_pilot_id=$2 AND status='pending' RETURNING id", [req.params.id,req.pilot.id]);
  if (!result.rowCount) return sendError(res, 403, 'You can only withdraw your own pending interest.');
  res.json({ ok: true });
}));
// This is a matching board, not an official roster: actual duty swaps require separate company approval.
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  sendError(res, 500, 'Something went wrong. Please try again.');
});
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Air Haifa Swap listening at ${baseUrl}`));
}
module.exports = app;
