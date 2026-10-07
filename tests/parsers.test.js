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

test('reads the Leon "Printed By Leon" layout: stacked headers, one row per sector, date beside the day', () => {
  const at = (x, y, str, page = 1) => ({ str, x, y, w: 20, page });
  const header = [at(29, 821, 'All times in UTC'), at(69, 743, 'NAME'), at(226, 743, 'ABC - Test Pilot'), at(66, 723, 'MONTH'), at(233, 723, 'MARCH'),
    at(408, 723, 'YEAR'), at(511, 723, '2027'), at(81, 688, 'Aircraft'), at(127, 688, 'Check'), at(277, 688, 'Check'), at(42, 683, 'Day'),
    at(190, 683, 'Description'), at(310, 683, 'Function'), at(369, 683, 'Crew'), at(410, 683, 'Block'), at(87, 679, 'Type'), at(137, 679, 'In'), at(283, 679, 'Out')];
  const sector = (y, flight, std, sta, extra = []) => [at(159, y, flight), at(170, y, std), at(204, y, 'AAA'), at(235, y, 'BBB'), at(265, y, sta),
    at(331, y, 'FO'), at(364, y + 4, 'XYZ-ABC /'), at(362, y - 4, 'CAB-INN'), at(416, y, '01:00'), ...extra];
  const items = [...header,
    at(39, 660, '01 Mar'), at(44, 653, 'Mon'), at(235, 660, 'BBB'), // an empty day
    ...sector(630, 'XX101', '04:30', '05:30', [at(128, 630, '03:50')]),
    at(33, 618, '02 Mar Tue'),
    ...sector(606, 'XX102', '06:15', '07:20', [at(294, 606, '07:40')]),
    at(32, 584, '03 Mar Wed'), at(157, 584, 'OFF - First Priority'),
    at(39, 560, '04 Mar'), at(128, 560, '04:45'), at(157, 560, 'Short call'), at(202, 560, '04:45'), at(265, 560, '16:45'), at(294, 560, '16:45'),
    ...sector(540, 'XX201', '22:00', '23:30', [at(128, 540, '21:20')]),
    at(39, 528, '05 Mar'),
    ...sector(516, 'XX202', '00:15', '01:20', [at(294, 516, '01:40')]),
  ];
  const { duties, warnings } = parseRoster(items, { zone: 'utc', year: 2026, month: 0 });
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(duties.length, 3);
  assert.deepStrictEqual(duties[0], { startsAt: '2027-03-02T03:50:00.000Z', endsAt: '2027-03-02T07:40:00.000Z',
    flightNumbers: 'XX101, XX102', crewRole: 'first_officer', otherCrew: 'XYZ' });
  assert.strictEqual(duties[1].flightNumbers, 'Short call');
  assert.strictEqual(duties[1].endsAt, '2027-03-04T16:45:00.000Z');
  assert.strictEqual(duties[2].startsAt, '2027-03-05T21:20:00.000Z');
  assert.strictEqual(duties[2].endsAt, '2027-03-06T01:40:00.000Z'); // after midnight
});

test('reads a calendar subscription: sectors close together become one duty, days off are left out', () => {
  const { parseICal } = require('../public/parsers');
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20270302T043000Z', 'DTEND:20270302T053000Z', 'SUMMARY:XX101 AAA-BBB', 'DESCRIPTION:Function: FO', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20270302T061500Z', 'DTEND:20270302T072000Z', 'SUMMARY:XX102 BBB-AAA', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270303', 'SUMMARY:OFF', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;TZID=Asia/Jerusalem:20270304T074500', 'DTEND;TZID=Asia/Jerusalem:20270304T194500', 'SUMMARY:Short call', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20270305T043000Z', 'DTEND:20270305T053000Z', 'SUMMARY:XX103', 'STATUS:CANCELLED', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const { duties } = parseICal(ics);
  assert.strictEqual(duties.length, 2);
  assert.deepStrictEqual(duties[0], { startsAt: '2027-03-02T04:30:00.000Z', endsAt: '2027-03-02T07:20:00.000Z', flightNumbers: 'XX 101, XX 102', crewRole: 'first_officer', otherCrew: '' });
  assert.strictEqual(duties[1].flightNumbers, 'Short call');
  assert.strictEqual(duties[1].startsAt, '2027-03-04T05:45:00.000Z'); // 07:45 in Israel (UTC+2 in March before DST)
});

test('roster links cannot point at private or local addresses', () => {
  const { isBlocked } = require('../server/rosterSync');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) assert.strictEqual(isBlocked(ip), true, ip);
  for (const ip of ['8.8.8.8', '2606:4700::1111']) assert.strictEqual(isBlocked(ip), false, ip);
});
