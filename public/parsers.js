// Text parsers shared by the browser app and the tests. They run entirely on the
// pilot's device: nothing here sends data anywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PilotSwapParsers = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const pad = n => String(n).padStart(2, '0');
  const TIME = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
  const COLON_TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  // Airline flight numbers: a 2-3 character designator (upper-case letters, or a letter and a digit),
  // then 1-4 digits: "6H 123", "LY001", "HFA412".
  const FLIGHT = /\b([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})[A-Z]?\b/g;
  const NOT_AIRLINES = new Set(['UTC', 'GMT', 'LT', 'FO', 'SFO', 'CP', 'CPT', 'CMD', 'PIC', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);

  // Turns a date written in a roster or a message into { y, m, d, hasYear } (m is 0-11), or null.
  // `ref` ({ y }) supplies the year when it is missing. Day comes before month (Israeli/European order).
  function parseDate(text, ref) {
    const s = String(text || '');
    let x = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (x) return valid(+x[1], +x[2] - 1, +x[3], true);
    x = s.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
    if (x) return valid(fullYear(x[3], ref), +x[2] - 1, +x[1], !!x[3]);
    x = s.match(/\b(\d{1,2})[\s-]?([A-Za-z]{3})[a-z]*\.?(?:[\s-]?(\d{4}|\d{2}(?!\d)))?(?![\d:])/);
    if (x && MONTHS[x[2].toLowerCase()] !== undefined) return valid(fullYear(x[3], ref), MONTHS[x[2].toLowerCase()], +x[1], !!x[3]);
    x = s.match(/\b([A-Za-z]{3})[a-z]*\.?\s(\d{1,2})(?:,?\s(\d{4}))?\b/);
    if (x && MONTHS[x[1].toLowerCase()] !== undefined) return valid(fullYear(x[3], ref), MONTHS[x[1].toLowerCase()], +x[2], !!x[3]);
    return null;
  }
  function fullYear(y, ref) { if (!y) return ref ? ref.y : new Date().getFullYear(); return y.length === 2 ? 2000 + +y : +y; }
  function valid(y, m, d, hasYear) { return m >= 0 && m < 12 && d >= 1 && d <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate() ? { y, m, d, hasYear } : null; }
  const times = (text, re = TIME) => [...String(text || '').matchAll(re)].map(t => ({ h: +t[1], mi: +t[2] }));
  const flights = text => [...String(text || '').matchAll(FLIGHT)].filter(f => !NOT_AIRLINES.has(f[1])).map(f => `${f[1]} ${f[2]}`);
  // Builds a Date from wall-clock parts read in UTC or in this device's local time.
  function makeDate(date, time, zone, addDays = 0) {
    return zone === 'utc' ? new Date(Date.UTC(date.y, date.m, date.d + addDays, time.h, time.mi))
      : new Date(date.y, date.m, date.d + addDays, time.h, time.mi);
  }
  function roleFrom(text) {
    const s = String(text || '').toUpperCase();
    if (/\b(S?FO|F\/O|FIRST OFFICER|COP|SO)\b/.test(s) || /קצין ראשון|קצינה ראשונה|קצ"ר|קצ״ר/.test(text)) return 'first_officer';
    if (/\b(CP|CPT|CAPT|CAPTAIN|CMD|PIC|CDR)\b/.test(s) || /קפטן|קברניט|מפקד/.test(text)) return 'captain';
    return '';
  }

  // ---- Leon roster PDF ------------------------------------------------------
  // `items` are the PDF's text pieces: { str, x, y, page }. Rows are rebuilt from
  // their positions, the header row (with Check-in / Check-out) tells which column
  // is which, and every day's sectors become one duty with its report and end time.
  function groupRows(items) {
    const sorted = items.filter(i => String(i.str).trim()).slice().sort((a, b) => (a.page - b.page) || (b.y - a.y) || (a.x - b.x));
    const rows = [];
    for (const it of sorted) {
      const row = rows[rows.length - 1];
      if (row && row.page === it.page && Math.abs(row.y - it.y) <= 3) row.cells.push(it);
      else rows.push({ page: it.page, y: it.y, cells: [it] });
    }
    rows.forEach(r => r.cells.sort((a, b) => a.x - b.x));
    return rows;
  }
  const HEADERS = {
    date: /^(date|day|תאריך)[.:]?$/i,
    checkIn: /check[\s-]?in|^c\/?i$|^rep(ort)?$|^ci$/i,
    checkOut: /check[\s-]?out|^c\/?o$|^rel(ease)?$|^co$/i,
    flight: /^(flights?|flt|flight\s?no\.?|flight\s?number|duty|activity|act|sectors?|routing)[.:]?$/i,
    func: /^(function|func|fnc|pos(ition)?|rank)[.:]?$/i,
    crew: /^(crew|crew members?|other crew|cockpit crew|names?)[.:]?$/i,
  };
  function findColumns(row) {
    const cols = {};
    for (const c of row.cells) for (const [k, re] of Object.entries(HEADERS)) if (cols[k] === undefined && re.test(String(c.str).trim())) cols[k] = c.x + (c.w || 0) / 2;
    return cols.checkIn !== undefined && cols.checkOut !== undefined ? cols : null;
  }
  function cellsByColumn(row, cols) {
    const keys = Object.keys(cols), out = {};
    for (const c of row.cells) {
      const mid = c.x + (c.w || 0) / 2;
      const k = keys.reduce((best, key) => Math.abs(cols[key] - mid) < Math.abs(cols[best] - mid) ? key : best, keys[0]);
      out[k] = out[k] ? `${out[k]} ${c.str}` : String(c.str);
    }
    return out;
  }
  // Returns { duties: [{ startsAt, endsAt, flightNumbers, crewRole, otherCrew }], warnings: [] }.
  function parseRoster(items, { zone = 'local', year, month } = {}) {
    const ref = { y: year ?? new Date().getFullYear(), m: month ?? new Date().getMonth() };
    const rows = groupRows(items);
    const byDay = new Map();
    let cols = null, lastDate = null;
    const add = (date, f) => {
      const key = `${date.y}-${pad(date.m + 1)}-${pad(date.d)}`;
      const day = byDay.get(key) || { date, flights: [], ins: [], outs: [], role: '', crew: [] };
      day.flights.push(...f.flights); if (f.in) day.ins.push(f.in); if (f.out) day.outs.push(f.out);
      if (!day.role && f.role) day.role = f.role; if (f.crew) day.crew.push(f.crew);
      byDay.set(key, day);
    };
    for (const row of rows) {
      const header = findColumns(row);
      if (header) { cols = header; continue; }
      const text = row.cells.map(c => c.str).join(' ');
      if (cols) {
        const c = cellsByColumn(row, cols);
        const own = parseDate(cols.date !== undefined ? (c.date ?? '') : text.replace(TIME, ' '), ref);
        if (own) lastDate = own;
        const date = own || lastDate; // later sectors of the same day often leave the date blank
        const ti = times(c.checkIn)[0], to = times(c.checkOut)[0];
        const f = flights(c.flight ?? text);
        if (!date || (!ti && !to && !f.length)) continue;
        add(date, { flights: f.length ? f : [String(c.flight || '').trim()].filter(Boolean), in: ti, out: to, role: roleFrom(c.func), crew: (c.crew || '').trim() });
      } else {
        // No header found (yet): a row with a date and at least two times is a duty.
        const date = parseDate(text, ref), t = times(text.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' '));
        if (!date || t.length < 2) continue;
        add(date, { flights: flights(text), in: t[0], out: t[t.length - 1], role: roleFrom(text) });
      }
    }
    const duties = [], warnings = [];
    // The crew column may list everyone ("CPT Cohen Dana FO Tal Eilon"); keep the pilot in the other seat.
    const otherCrew = (text, role) => {
      const parts = [...String(text).matchAll(/\b(S?FO|F\/O|CPT|CP|CAPT|CMD|PIC)\b\.?\s*([^,;]*?)(?=\s*(?:\b(?:S?FO|F\/O|CPT|CP|CAPT|CMD|PIC)\b|[,;]|$))/g)]
        .map(m => ({ role: roleFrom(m[1]), name: m[2].trim() })).filter(p => p.name);
      if (!parts.length) return String(text).trim();
      const other = parts.find(p => role && p.role && p.role !== role) || parts.find(p => !role || p.role !== role);
      return other ? other.name : '';
    };
    for (const day of [...byDay.values()].sort((a, b) => makeDate(a.date, { h: 0, mi: 0 }, 'utc') - makeDate(b.date, { h: 0, mi: 0 }, 'utc'))) {
      const ci = day.ins[0], co = day.outs[day.outs.length - 1];
      if (!ci) { warnings.push(`${day.date.d}/${day.date.m + 1}: no check-in time, skipped`); continue; }
      const startsAt = makeDate(day.date, ci, zone);
      let endsAt = co ? makeDate(day.date, co, zone) : new Date(+startsAt + 3600000);
      if (endsAt <= startsAt) endsAt = makeDate(day.date, co, zone, 1); // ends after midnight
      duties.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), flightNumbers: [...new Set(day.flights)].join(', ').slice(0, 200),
        crewRole: day.role, otherCrew: [...new Set(day.crew.map(c => otherCrew(c, day.role)).filter(Boolean))].join(', ').replace(/\s+/g, ' ').slice(0, 120) });
    }
    return { duties, warnings };
  }

  // ---- Free-text listing ----------------------------------------------------
  // Reads a message like "Giving away 6H 123 on 14/10, 06:00-14:30, captain, with Dana. Prefer a morning flight."
  // (or in Hebrew) and returns form fields. Anything it is unsure about is left out for the pilot to fill in.
  function parseFreeText(text, { zone = 'local', today = new Date() } = {}) {
    const s = String(text || '').trim(), out = {};
    if (!s) return out;
    const low = s.toLowerCase();
    if (/מחפש|מחפשת|צריך|צריכה|רוצה לקחת|אקח|לוקח|\b(looking for|need|request|want to take|take|wanted)\b/i.test(low)) out.intent = 'request';
    if (/מוסר|מוסרת|נותן|נותנת|למסירה|מוותר|\b(giving|give away|give|offer|offering|available|swap away|drop)\b/i.test(low)) out.intent = 'offer';
    if (/משמרת|כוננות|רזרבה|\b(shift|standby|reserve|duty)\b/i.test(low) && !flights(s).length) out.kind = 'shift';
    else if (flights(s).length || /טיסה|\bflight\b/i.test(low)) out.kind = 'flight';
    const f = flights(s); if (f.length) out.flightNumber = f[0];
    const role = roleFrom(s); if (role) out.crewRole = role;
    const ref = { y: today.getFullYear(), m: today.getMonth() };
    let date = null;
    if (/מחרתיים|day after tomorrow/i.test(s)) date = shift(today, 2);
    else if (/מחר|tomorrow/i.test(s)) date = shift(today, 1);
    else if (/היום|today/i.test(s)) date = shift(today, 0);
    else {
      date = parseDate(s.replace(COLON_TIME, ' '), ref);
      // A date without a year that is already well in the past means next year.
      if (date && !date.hasYear && Date.UTC(date.y, date.m, date.d) < Date.UTC(ref.y, ref.m, today.getDate()) - 60 * 86400000) date.y += 1;
    }
    const t = times(s, COLON_TIME);
    if (date && t[0]) {
      const start = makeDate(date, t[0], zone);
      let end = t[1] ? makeDate(date, t[1], zone) : new Date(+start + 2 * 3600000);
      if (end <= start) end = makeDate(date, t[1], zone, 1);
      out.startsAt = start.toISOString(); out.endsAt = end.toISOString();
    } else if (date) out.date = `${date.y}-${pad(date.m + 1)}-${pad(date.d)}`;
    const name = s.match(/(?:\bwith|עם)\s+([A-Za-z֐-׿][A-Za-z֐-׿'’-]+(?:\s+[A-Za-z֐-׿][A-Za-z֐-׿'’-]+)?)/);
    if (name && !/^(the|a|an|any)$/i.test(name[1])) out.crewName = name[1].replace(/\s+(on|at|in|ב|ל)$/i, '');
    out.details = s.slice(0, 1200);
    return out;
  }
  function shift(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return { y: x.getFullYear(), m: x.getMonth(), d: x.getDate() }; }

  // Guesses whether a roster's times are UTC or local from words in the file; '' when it can't tell.
  function detectZone(items) {
    const text = items.map(i => i.str).join(' ');
    const utc = /\b(UTC|GMT|Zulu)\b/i.test(text), local = /\blocal\b|\bLT\b/i.test(text);
    return utc && !local ? 'utc' : local && !utc ? 'local' : '';
  }
  return { parseRoster, parseFreeText, parseDate, groupRows, detectZone };
}));
