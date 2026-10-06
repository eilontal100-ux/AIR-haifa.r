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
  if (!crewName) throw new Error("Enter the other crew member's name.");
  const flightNumber = clean(body.flightNumber, 40).toUpperCase();
  if (kind === 'flight' && !flightNumber) throw new Error('Enter the flight number.');
  return { intent, kind, crewRole, startsAt, endsAt, crewName, flightNumber,
    exchangeDates: clean(body.exchangeDates, 250), exchangeFlights: clean(body.exchangeFlights, 250).toUpperCase(),
    details: clean(body.details, 1200) };
}

// Flights from a pilot's imported roster: { from, to, duties: [...] }. Throws with a message for the pilot.
function parseRosterImport(body) {
  const from = new Date(body?.from), to = new Date(body?.to);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || to <= from || to - from > 45 * 86400000) throw new Error('Choose one month to import.');
  if (!Array.isArray(body.duties) || body.duties.length > 120) throw new Error('The roster has too many entries to import at once.');
  const duties = body.duties.map(d => {
    const startsAt = new Date(d?.startsAt), endsAt = new Date(d?.endsAt);
    if (!Number.isFinite(+startsAt) || !Number.isFinite(+endsAt) || endsAt <= startsAt || endsAt - startsAt > 2 * 86400000) throw new Error('A flight in the roster has invalid times.');
    if (startsAt < from || startsAt >= to) throw new Error('A flight in the roster is outside the chosen month.');
    return { startsAt, endsAt, flightNumbers: clean(d.flightNumbers, 200).toUpperCase(),
      crewRole: ['captain', 'first_officer'].includes(d.crewRole) ? d.crewRole : '', otherCrew: clean(d.otherCrew, 120) };
  });
  return { from, to, duties };
}
module.exports = { normalizeEmail, clean, parseListing, parseRosterImport };
