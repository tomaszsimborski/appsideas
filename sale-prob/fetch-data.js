#!/usr/bin/env node
/*
 * Downloads booked slots from both rehearsal-room booking systems and writes
 * one normalised JSON file that the app reads. Run by the GitHub Action
 * (.github/workflows/sale-prob-data.yml), or locally:
 *
 *   node sale-prob/fetch-data.js sale-prob/availability.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { warsawTime, warsawDay, formatTime, HOUR } = require('./availability.js');

const DAYS_AHEAD = 28;
const USER_AGENT = 'appsideas-sale-prob (+https://github.com/tomaszsimborski/appsideas)';

const DZWIEKOWA_API = 'https://system.dzwiekowa.pl/system-rezerwacji/api/reservations';
const DZWIEKOWA_MAX_DAYS = 7; // the API refuses ranges longer than 8 days
const DZWIEKOWA_BAND_TYPE = 'type-4'; // "Zespół (dwie i więcej osób)"

const PLUGANDPLAY_API = 'https://pp.blackfernsoft.com';
// Prices are not in the Plug&Play API, only on www.sala-prob.pl.
const PLUGANDPLAY_PRICES = { 1: 50, 2: 50, A: 40, B: 50 };

// Próbówka books through nakiedy.pl, which has no API: it lists the free
// start times (every 30 min) of the chosen service, about 6 days per page.
const PROBOWKA_URL = 'https://probowka.nakiedy.pl';
const PROBOWKA_ADDRESS = 'ul. Robotnicza 1A/15';
const PROBOWKA_PROMO = ' (25 zł/h pn–pt 6–15)';
const SLOT = HOUR / 2;

// Melodyka books through asysto.pl: one room, with a separate one-hour
// service for each price band (0–6, 6–15, 15–24). Each lists its free hours
// week by week, so free time is the union of all bands.
const MELODYKA_URL = 'https://saleprobmelodyka.asysto.pl';
const MELODYKA_PRICE = '65 zł/h (50 zł/h w godz. 6–15, 45 zł/h w godz. 0–6)';

// "YYYY-MM-DD" of today in Poland, and simple day arithmetic on such strings.
const todayInWarsaw = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
const addDays = (day, n) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const toDmy = (day) => day.split('-').reverse().join('.');

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchDzwiekowa(from, to) {
  const rooms = new Map();
  const reservations = new Map();
  for (let start = from; start < to; start = addDays(start, DZWIEKOWA_MAX_DAYS)) {
    const end = addDays(start, DZWIEKOWA_MAX_DAYS);
    const q = new URLSearchParams({ from: start, to: end, scope: 'active', includeOverlapping: '1' });
    const data = await getJson(`${DZWIEKOWA_API}?${q}`);
    for (const room of data.rooms) rooms.set(String(room.id), room);
    for (const r of data.reservations) reservations.set(r.id, r);
  }

  const busyByRoom = new Map();
  for (const r of reservations.values()) {
    const key = String(r.roomId);
    if (!busyByRoom.has(key)) busyByRoom.set(key, []);
    busyByRoom.get(key).push([Date.parse(r.startDate), Date.parse(r.endDate)]);
  }

  return {
    id: 'dzwiekowa',
    name: 'Dźwiękówa',
    bookingUrl: 'https://dzwiekowa.pl/rezerwacja-online/',
    rooms: [...rooms.values()]
      .filter((room) => !room.hidden && !room.disabled && !room.deleted_at)
      .map((room) => ({
        id: 'dzwiekowa-' + room.id,
        name: room.name,
        address: room.address,
        price: dzwiekowaPrice(room),
        busy: sortIntervals(busyByRoom.get(String(room.id)) || []),
      })),
  };
}

function dzwiekowaPrice(room) {
  const band = room.priceList && room.priceList[DZWIEKOWA_BAND_TYPE];
  if (!band || !band.default) return null;
  let text = `${band.default.increment} zł/h`;
  const promo = band.promotion;
  if (promo && promo.increment && promo.increment < band.default.increment && promo.to > promo.from) {
    text += ` (${promo.increment} zł/h w godz. ${promo.from}–${promo.to})`;
  }
  return text;
}

async function fetchPlugAndPlay(from, to) {
  const list = await getJson(`${PLUGANDPLAY_API}/rehearsalRooms`);
  const rooms = list.data.rehearsalRoomsList.slice().sort((a, b) => a.name.localeCompare(b.name));
  const result = [];
  for (const room of rooms) {
    const q = new URLSearchParams({ rehearsalRoomId: room.id, firstDay: toDmy(from), lastDay: toDmy(to) });
    const data = await getJson(`${PLUGANDPLAY_API}/reservations?${q}`);
    const price = PLUGANDPLAY_PRICES[room.name];
    result.push({
      id: 'plugandplay-' + room.id,
      name: 'Sala ' + room.name,
      // The address field also carries payment instructions after a backslash.
      address: String(room.address || '').split('\\')[0].trim(),
      price: price ? `${price} zł/h` : null,
      busy: sortIntervals(data.data.calendarReservations.map((r) => [r.reservationFrom, r.reservationTo])),
    });
  }
  return {
    id: 'plugandplay',
    name: 'Plug&Play',
    bookingUrl: 'https://www.sala-prob.pl/',
    rooms: result,
  };
}

async function getText(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'User-Agent': USER_AGENT, ...options.headers } });
  if (!res.ok && res.status !== 302) throw new Error(`${res.status} ${url}`);
  return { res, text: await res.text() };
}

// One room per <h2> on the start page; its plain one-hour service (not the
// weekday-morning promo, whose name has " - ") is what we look up.
function probowkaRooms(html) {
  return html.split('<h2>').slice(1).map((section) => {
    const name = section.slice(0, section.indexOf('</h2>')).split('[')[0].trim();
    for (const row of section.split('class="flex-row"').slice(1)) {
      const label = (row.match(/class="flex-cell name">([^<]*)</) || [])[1] || '';
      const id = (row.match(/data-id="(\d+)"/) || [])[1];
      const price = (row.match(/class="flex-cell price">\s*(\d+)/) || [])[1];
      if (id && /\b60 min\b/.test(row) && !label.includes(' - ')) return { name, id, price };
    }
    return null;
  }).filter(Boolean);
}

async function fetchProbowka(from, to) {
  const { text: start } = await getText(PROBOWKA_URL + '/');
  const rooms = probowkaRooms(start);
  if (!rooms.length) throw new Error('no rooms found on ' + PROBOWKA_URL);

  const result = [];
  for (const room of rooms) {
    // Picking the service is stored in the session, then results.html pages
    // through the days after `last_date`.
    const { res } = await getText(PROBOWKA_URL + '/', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'service=' + room.id,
    });
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    const starts = new Set();
    const days = new Set();
    let lastDate = addDays(from, -1);
    for (let page = 0; page < 10 && lastDate < to; page++) {
      const q = new URLSearchParams({ staff: 0, last_date: lastDate, reload: 1 });
      const { text } = await getText(`${PROBOWKA_URL}/results.html?${q}`, { headers: { Cookie: cookie } });
      const pageDays = [...text.matchAll(/data-date="(\d{4}-\d\d-\d\d)"/g)].map((m) => m[1]);
      if (!pageDays.length || pageDays[pageDays.length - 1] <= lastDate) break;
      pageDays.forEach((d) => days.add(d));
      for (const [, time] of text.matchAll(/data-time="(\d{4}-\d\d-\d\d \d\d:\d\d)"/g)) starts.add(time);
      lastDate = pageDays[pageDays.length - 1];
    }

    result.push({
      id: 'probowka-' + room.id,
      name: room.name,
      address: PROBOWKA_ADDRESS,
      price: room.price ? `${room.price} zł/h${PROBOWKA_PROMO}` : null,
      busy: busyFromFreeStarts(starts, from, to, days),
    });
  }
  return {
    id: 'probowka',
    name: 'Próbówka',
    bookingUrl: PROBOWKA_URL + '/',
    rooms: result,
  };
}

// Turns "an hour can start at <local time>" into busy intervals: every
// half-hour slot that no free hour covers is busy. Matching on local clock
// time keeps the repeated hour on the night clocks go back free. Days the system did not list at all are
// treated as fully booked; slots before the next hour are skipped, since
// the system no longer offers them anyway.
function busyFromFreeStarts(starts, from, to, days) {
  const notBefore = Math.ceil((Date.now() + HOUR) / SLOT) * SLOT;
  const busy = [];
  for (let day = from; day < to; day = addDays(day, 1)) {
    const end = warsawTime(day, 24);
    for (let t = Math.max(warsawTime(day, 0), notBefore); t < end; t += SLOT) {
      const free = days.has(day) && (starts.has(localTime(t)) || starts.has(localTime(t - SLOT)));
      if (free) continue;
      const last = busy[busy.length - 1];
      if (last && last[1] === t) last[1] = t + SLOT;
      else busy.push([t, t + SLOT]);
    }
  }
  return busy;
}

async function fetchMelodyka(from, to) {
  const { text: start } = await getText(MELODYKA_URL + '/wizyta/krok1');
  // The first service in each band group for bands (not solo) is one hour.
  const services = start.split('Rezerwacje od').slice(1)
    .filter((group) => /^[^<]*Zespoły/.test(group))
    .map((group) => (group.match(/krok3\/\/(\d+)/) || [])[1])
    .filter(Boolean);
  if (!services.length) throw new Error('no services found on ' + MELODYKA_URL);

  const free = [];
  for (const service of services) {
    // krok3 redirects to the service's calendar (krok4/<service>/<resource>).
    const { res } = await getText(`${MELODYKA_URL}/wizyta/krok3//${service}`);
    for (let week = mondayOf(from); week < to; week = addDays(week, 7)) {
      const { text } = await getText(`${res.url}?ajax=1&date=${week}`);
      for (const [, s, e] of text.matchAll(/krok5\/\/\d+\/\d+\/(\d+)\.(\d+)/g)) free.push([s * 1000, e * 1000]);
    }
  }

  return {
    id: 'melodyka',
    name: 'Melodyka',
    bookingUrl: MELODYKA_URL + '/wizyta/krok1',
    rooms: [{
      id: 'melodyka-1',
      name: 'Sala Melodyka',
      address: 'ul. Fabryczna 10/D2, wejście 2',
      price: MELODYKA_PRICE,
      busy: busyFromFreeIntervals(free, from, to),
    }],
  };
}

const mondayOf = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));

// Busy = everything in [from, to) that no free interval covers, from the
// next full hour on (earlier slots are no longer offered anyway).
function busyFromFreeIntervals(free, from, to) {
  const end = warsawTime(to, 0);
  let cursor = Math.max(warsawTime(from, 0), Math.ceil((Date.now() + HOUR) / HOUR) * HOUR);
  const busy = [];
  for (const [s, e] of free.slice().sort((a, b) => a[0] - b[0])) {
    if (s > cursor && cursor < end) busy.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < end) busy.push([cursor, end]);
  return busy;
}

const localTime = (ms) => `${warsawDay(ms)} ${formatTime(ms)}`;

const sortIntervals = (list) => list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);

async function main() {
  const out = process.argv[2] || path.join(__dirname, 'availability.json');
  const from = todayInWarsaw();
  const to = addDays(from, DAYS_AHEAD);

  const venues = [];
  const errors = [];
  const sources = [['Dźwiękówa', fetchDzwiekowa], ['Plug&Play', fetchPlugAndPlay], ['Próbówka', fetchProbowka], ['Melodyka', fetchMelodyka]];
  for (const [name, fn] of sources) {
    try {
      venues.push(await fn(from, to));
    } catch (err) {
      console.error(`${name}: ${err.message}`);
      errors.push(`${name}: nie udało się pobrać grafiku`);
    }
  }
  // Keep the previous file when nothing worked, rather than publishing an empty one.
  if (!venues.length) process.exit(1);

  const data = { updatedAt: new Date().toISOString(), from, to, venues, errors };
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data) + '\n');
  const rooms = venues.reduce((n, v) => n + v.rooms.length, 0);
  const bookings = venues.reduce((n, v) => n + v.rooms.reduce((m, r) => m + r.busy.length, 0), 0);
  console.log(`Saved ${out}: ${rooms} rooms, ${bookings} bookings, ${from} – ${to}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
