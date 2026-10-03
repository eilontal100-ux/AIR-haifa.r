'use strict';
// Web push notifications: keys, device subscriptions and sending.
const webpush = require('web-push');
const { query } = require('./db');

const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Jerusalem';
const SUBJECT = process.env.PUSH_CONTACT || 'mailto:pilotswap.et@gmail.com';
// Only real browser push services, so the server never posts to arbitrary URLs.
const PUSH_HOST = /(^|\.)(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

// VAPID keys identify this server to push services. Taken from the environment, or
// generated once and kept in the database so existing subscriptions keep working.
let keysPromise;
function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return Promise.resolve({ publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
  }
  return keysPromise ??= (async () => {
    const read = async () => (await query("SELECT value FROM app_settings WHERE key='vapid'")).rows[0];
    if (!await read()) {
      await query("INSERT INTO app_settings(key, value) VALUES ('vapid', $1) ON CONFLICT(key) DO NOTHING", [JSON.stringify(webpush.generateVAPIDKeys())]);
    }
    return JSON.parse((await read()).value);
  })().catch(err => { keysPromise = undefined; throw err; });
}

function parseSubscription(sub) {
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
  const { p256dh, auth } = sub?.keys || {};
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || !PUSH_HOST.test(url.hostname) || endpoint.length > 1000) return null;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint, p256dh, auth };
}

const when = d => new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
const listingName = l => (l.kind === 'flight' ? (l.flight_number || 'Flight') : 'Duty shift');
const pilotName = p => p.display_name || p.email;

async function sendTo(rows, payload) {
  if (!rows.length) return;
  const { publicKey, privateKey } = await vapidKeys();
  const body = JSON.stringify(payload);
  await Promise.all(rows.map(r => webpush.sendNotification(
    { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body,
    { vapidDetails: { subject: SUBJECT, publicKey, privateKey }, TTL: 24 * 3600 },
  ).catch(async err => {
    // The browser unsubscribed or the subscription expired: forget it.
    if (err.statusCode === 404 || err.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [r.endpoint]);
    else console.error('Push notification failed:', err.statusCode || '', err.message);
  })));
}

// "New listings": everyone who opted in, except the person who posted it.
async function newListing(listing, owner) {
  const { rows } = await query('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE new_listings AND pilot_id<>$1', [owner.id]);
  await sendTo(rows, {
    title: `New ${listing.intent === 'offer' ? 'offer' : 'request'}: ${listingName(listing)}`,
    body: `${pilotName(owner)} · ${when(listing.starts_at)} – ${when(listing.ends_at)}`,
    url: '/#calendar', tag: `listing-${listing.id}`,
  });
}

// "My exchanges": changes in a pilot's exchange inbox.
async function exchangeUpdate(pilotIds, payload) {
  for (const id of new Set(pilotIds.map(String))) {
    const { rows } = await query('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE my_exchanges AND pilot_id=$1', [id]);
    await sendTo(rows, { url: '/#inbox', ...payload });
  }
}

// Fire-and-forget: a failed notification never fails the request that caused it.
const later = fn => (...args) => { Promise.resolve().then(() => fn(...args)).catch(err => console.error('Push notification failed:', err.message)); };

module.exports = { vapidKeys, parseSubscription, listingName, pilotName, notifyNewListing: later(newListing), notifyExchange: later(exchangeUpdate) };
