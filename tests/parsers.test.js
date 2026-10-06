'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseRoster, parseFreeText, parseDate } = require('../public/parsers');

// Lays out table rows the way pdf.js reports text: x positions per column, y going down the page.
function table(rows, xs = [40, 120, 200, 260, 320, 380]) {
  return rows.flatMap((cells, r) => cells.map((str, i) => ({ str, x: xs[i], y: 700 - r * 14, w: 20, page: 1 })).filter(c => c.str !== ''));
}

test('parses dates in common roster formats', () => {
  assert.deepStrictEqual(parseDate('05/11/2026'), { y: 2026, m: 10, d: 5, hasYear: true });
  assert.deepStrictEqual(parseDate('Thu 05Nov26'), { y: 2026, m: 10, d: 5, hasYear: true });
  assert.deepStrictEqual(parseDate('2026-11-05'), { y: 2026, m: 10, d: 5, hasYear: true });
  assert.strictEqual(parseDate('31/02/2026'), null);
});

test('reads a Leon roster table: one duty per day with report and end times', () => {
  const items = table([
    ['Date', 'Function', 'Flight', 'Check-in', 'Check-out', 'Crew'],
    ['01/11/2026', 'FO', '6H 101', '05:10', '', 'CPT Cohen Dana FO Tal Eilon'],
    ['', '', '6H 102', '', '09:45', ''],
    ['02/11/2026', 'FO', 'OFF', '', '', ''],
    ['03/11/2026', 'FO', '6H 7', '22:30', '02:15', 'Levi Avi'],
  ]);
  const { duties } = parseRoster(items, { zone: 'utc', year: 2026, month: 10 });
  assert.strictEqual(duties.length, 2);
  assert.deepStrictEqual(duties[0], { startsAt: '2026-11-01T05:10:00.000Z', endsAt: '2026-11-01T09:45:00.000Z',
    flightNumbers: '6H 101, 6H 102', crewRole: 'first_officer', otherCrew: 'Cohen Dana' });
  assert.strictEqual(duties[1].endsAt, '2026-11-04T02:15:00.000Z'); // after midnight
});

test('roster rows without a header still work when they hold a date and two times', () => {
  const items = table([['05Nov26', 'LY 315', '06:00', '11:30']]);
  const { duties } = parseRoster(items, { zone: 'utc', year: 2026 });
  assert.strictEqual(duties.length, 1);
  assert.strictEqual(duties[0].flightNumbers, 'LY 315');
  assert.strictEqual(duties[0].startsAt, '2026-11-05T06:00:00.000Z');
});

test('turns an English message into listing fields', () => {
  const r = parseFreeText('Giving away 6H 123 on 14/11, 06:00-14:30, captain, with Dana. Prefer a morning flight back.', { zone: 'utc', today: new Date(2026, 9, 6) });
  assert.strictEqual(r.intent, 'offer');
  assert.strictEqual(r.kind, 'flight');
  assert.strictEqual(r.flightNumber, '6H 123');
  assert.strictEqual(r.crewRole, 'captain');
  assert.strictEqual(r.crewName, 'Dana');
  assert.strictEqual(r.startsAt, '2026-11-14T06:00:00.000Z');
  assert.strictEqual(r.endsAt, '2026-11-14T14:30:00.000Z');
});

test('turns a Hebrew message into listing fields', () => {
  const r = parseFreeText('מוסר טיסה 6H 456 ב-20.11 בשעה 07:15 עד 13:00, אני קצין ראשון, עם רון. אשמח לטיסת ערב בתמורה', { zone: 'utc', today: new Date(2026, 9, 6) });
  assert.strictEqual(r.intent, 'offer');
  assert.strictEqual(r.flightNumber, '6H 456');
  assert.strictEqual(r.crewRole, 'first_officer');
  assert.strictEqual(r.crewName, 'רון');
  assert.strictEqual(r.startsAt, '2026-11-20T07:15:00.000Z');
});

test('a request for a shift is understood', () => {
  const r = parseFreeText('Looking for a standby shift tomorrow 08:00', { today: new Date(2026, 9, 6) });
  assert.strictEqual(r.intent, 'request');
  assert.strictEqual(r.kind, 'shift');
});

test('detects whether roster times are UTC or local', () => {
  const { detectZone } = require('../public/parsers');
  assert.strictEqual(detectZone([{ str: 'Crew Roster (UTC)' }]), 'utc');
  assert.strictEqual(detectZone([{ str: 'All times local' }]), 'local');
  assert.strictEqual(detectZone([{ str: 'Crew Roster' }]), '');
});
