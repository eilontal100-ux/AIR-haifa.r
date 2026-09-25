'use strict';
function normalizeEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
function clean(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function parseListing(body) {
  const intent = body.intent;
  const kind = body.kind;
  const crewRole = body.crewRole;
  if (!['offer', 'request'].includes(intent)) throw new Error('Choose offering or requesting.');
  if (!['flight', 'shift'].includes(kind)) throw new Error('Choose flight or shift.');
  if (!['captain', 'first_officer'].includes(crewRole)) throw new Error('Choose captain or first officer.');
  const startsAt = new Date(body.startsAt), endsAt = new Date(body.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new Error('Enter valid start and end times.');
  if (endsAt - startsAt > 7 * 24 * 3600000) throw new Error('A listing cannot span more than seven days.');
  const crewName = clean(body.crewName, 120);
  if (!crewName) throw new Error('Enter the captain or first officer name.');
  const flightNumber = clean(body.flightNumber, 40).toUpperCase();
  if (kind === 'flight' && !flightNumber) throw new Error('Enter the flight number.');
  return { intent, kind, crewRole, startsAt, endsAt, crewName, flightNumber,
    exchangeDates: clean(body.exchangeDates, 250), exchangeFlights: clean(body.exchangeFlights, 250).toUpperCase(),
    details: clean(body.details, 1200) };
}
module.exports = { normalizeEmail, clean, parseListing };
