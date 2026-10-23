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

const DAYS_AHEAD = 28;
const USER_AGENT = 'appsideas-sale-prob (+https://github.com/tomaszsimborski/appsideas)';

const DZWIEKOWA_API = 'https://system.dzwiekowa.pl/system-rezerwacji/api/reservations';
const DZWIEKOWA_MAX_DAYS = 7; // the API refuses ranges longer than 8 days
const DZWIEKOWA_BAND_TYPE = 'type-4'; // "Zespół (dwie i więcej osób)"

const PLUGANDPLAY_API = 'https://pp.blackfernsoft.com';
// Prices are not in the Plug&Play API, only on www.sala-prob.pl.
const PLUGANDPLAY_PRICES = { 1: 50, 2: 50, A: 40, B: 50 };

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

const sortIntervals = (list) => list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);

async function main() {
  const out = process.argv[2] || path.join(__dirname, 'availability.json');
  const from = todayInWarsaw();
  const to = addDays(from, DAYS_AHEAD);

  const venues = [];
  const errors = [];
  for (const [name, fn] of [['Dźwiękówa', fetchDzwiekowa], ['Plug&Play', fetchPlugAndPlay]]) {
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
