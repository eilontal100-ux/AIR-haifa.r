'use strict';
// Keeps a pilot's imported flights up to date from a roster link: a Leon roster PDF or a
// calendar (iCal) subscription. Only public https addresses are fetched, so a link cannot be
// used to reach this server's own network.
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { parseRoster, parseICal, detectZone, wallToUtc } = require('../public/parsers');
const { cleanDuty } = require('./validation');

const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Jerusalem';
const MAX_BYTES = 10 * 1024 * 1024, TIMEOUT_MS = 20000, MAX_REDIRECTS = 3;
const userError = message => Object.assign(new Error(message), { userMessage: message });

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(a, p, 'ipv6');
function isBlocked(address) {
  const mapped = String(address).match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) address = mapped[1];
  const family = net.isIP(address);
  return !family || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
// Checks the address a host name actually resolves to, at connect time.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some(a => isBlocked(a.address))) return callback(userError('That address is not allowed.'));
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

function download(link, redirects = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(link); } catch { return reject(userError('That is not a valid link.')); }
    if (url.protocol !== 'https:') return reject(userError('The link must start with https://'));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlocked(host)) return reject(userError('That address is not allowed.'));
    const req = https.get(url, { lookup: safeLookup, headers: { 'user-agent': 'PilotSwap roster sync', accept: 'application/pdf, text/calendar, */*' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); clearTimeout(timer);
        if (!redirects) return reject(userError('The link redirects too many times.'));
        return resolve(download(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); return reject(userError('The site asked for a sign-in. Use a link that opens the roster without signing in, such as the calendar subscription link.')); }
      if (res.statusCode !== 200) { res.resume(); return reject(userError(`The site answered with an error (${res.statusCode}). Check that the link still works.`)); }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) { reject(userError('The file at this link is too large for a roster.')); req.destroy(); }
        else chunks.push(chunk);
      });
      res.on('end', () => { clearTimeout(timer); resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] || '') }); });
      res.on('error', () => reject(userError('Could not download the roster from this link.')));
    });
    const timer = setTimeout(() => { reject(userError('The site took too long to answer.')); req.destroy(); }, TIMEOUT_MS);
    req.on('error', err => { clearTimeout(timer); reject(err.userMessage ? err : userError('Could not reach the site at this link.')); });
  });
}

let pdfjs;
// The same text pieces the browser reads from a roster PDF.
async function pdfItems(data) {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 }).promise;
  const items = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 20); p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], w = it.width || 0;
        let offset = 0;
        for (const piece of it.str.split(/(\s{2,})/)) {
          if (piece.trim()) items.push({ str: piece.trim(), x: x + w * offset / it.str.length, y, w: w * piece.length / it.str.length, page: p });
          offset += piece.length;
        }
      }
    }
  } finally { await doc.destroy(); }
  return items;
}

// Wall-clock times read as UTC become the same wall-clock times in the app's time zone.
const toLocal = iso => { const d = new Date(iso); return wallToUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), TIME_ZONE).toISOString(); };

async function readRoster({ body, type }, zone) {
  const head = body.subarray(0, 1024).toString('latin1');
  if (head.includes('%PDF')) {
    let items;
    try { items = await pdfItems(body); } catch { throw userError('Could not read the PDF at this link.'); }
    const fileZone = detectZone(items) || zone;
    const { duties } = parseRoster(items, { zone: 'utc' });
    return fileZone === 'utc' ? duties : duties.map(d => ({ ...d, startsAt: toLocal(d.startsAt), endsAt: toLocal(d.endsAt) }));
  }
  const text = body.toString('utf8');
  if (/BEGIN:VCALENDAR/i.test(text)) return parseICal(text, { zone, tz: TIME_ZONE }).duties;
  if (/html/i.test(type) || /<html|<!doctype/i.test(head)) throw userError('This link opens a web page, not a roster file. Use the link to the roster PDF or to the calendar (iCal) subscription.');
  throw userError('This link does not lead to a roster PDF or calendar.');
}

const monthStart = (d, add = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));

// Downloads the roster and replaces the pilot's flights in the months it covers.
// Returns the number of flights saved; throws an error with `userMessage` for the pilot.
async function syncRoster(pool, pilotId, { url, zone }) {
  const roster = await download(url);
  const now = new Date(), earliest = monthStart(now, -1), latest = new Date(+now + 180 * 86400000);
  const duties = [];
  for (const d of await readRoster(roster, zone)) {
    try { const duty = cleanDuty(d); if (duty.startsAt >= earliest && duty.startsAt < latest) duties.push(duty); } catch { /* skip a broken entry */ }
  }
  if (!duties.length) throw userError('No flights were found at this link.');
  if (duties.length > 400) throw userError('The roster at this link has too many entries.');
  const from = monthStart(new Date(Math.min(...duties.map(d => +d.startsAt))));
  const to = monthStart(new Date(Math.max(...duties.map(d => +d.startsAt))), 1);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM roster_duties WHERE pilot_id=$1 AND starts_at>=$2 AND starts_at<$3', [pilotId, from, to]);
    for (const d of duties) {
      await client.query('INSERT INTO roster_duties(pilot_id,starts_at,ends_at,flight_numbers,crew_role,other_crew) VALUES($1,$2,$3,$4,$5,$6)',
        [pilotId, d.startsAt, d.endsAt, d.flightNumbers, d.crewRole, d.otherCrew]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
  return duties.length;
}

module.exports = { syncRoster, readRoster, isBlocked };
