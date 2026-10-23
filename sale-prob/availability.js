/*
 * Rehearsal-room availability: Warsaw-time helpers and the free/busy checks
 * on the data written by fetch-data.js. Pure functions with no DOM access,
 * so they can run in the browser (as window.Availability) or in Node for
 * testing. Times are epoch milliseconds; busy lists are [start, end) pairs.
 */
(function (root) {
  'use strict';

  const TZ = 'Europe/Warsaw';
  const HOUR = 3600 * 1000;

  const offsetFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  // Milliseconds Warsaw is ahead of UTC at the given instant (1 h or 2 h).
  function tzOffset(ms) {
    const p = {};
    for (const { type, value } of offsetFormat.formatToParts(new Date(ms))) p[type] = +value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }

  // Epoch ms of `hour` o'clock (may exceed 24) on day "YYYY-MM-DD" in Warsaw.
  function warsawTime(day, hour) {
    const [y, m, d] = day.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d) + hour * HOUR;
    const first = guess - tzOffset(guess);
    return guess - tzOffset(first);
  }

  // "YYYY-MM-DD" of the Warsaw calendar day containing `ms`.
  const warsawDay = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ });

  // "HH:MM" in Warsaw.
  const formatTime = (ms) => new Date(ms).toLocaleTimeString('pl-PL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

  // Bookings that overlap [start, end).
  const conflicts = (busy, start, end) => busy.filter(([s, e]) => s < end && e > start);

  // The free slot of the same length closest to `start`, searched on whole
  // hours inside [from, to). Earlier wins a tie. Null when nothing fits.
  function nearestFreeSlot(busy, start, duration, from, to, step = HOUR) {
    for (let k = 1; ; k++) {
      const earlier = start - k * step;
      const later = start + k * step;
      if (earlier < from && later + duration > to) return null;
      for (const s of [earlier, later]) {
        if (s >= from && s + duration <= to && !conflicts(busy, s, s + duration).length) return [s, s + duration];
      }
    }
  }

  // Free/busy status of every room for [start, end), with the nearest free
  // slot that day for busy rooms. `dayFrom`/`dayTo` bound that search.
  function checkRooms(data, start, end, dayFrom, dayTo) {
    return data.venues.map((venue) => ({
      venue,
      rooms: venue.rooms.map((room) => {
        const hits = conflicts(room.busy, start, end);
        return {
          room,
          free: hits.length === 0,
          conflicts: hits,
          alternative: hits.length ? nearestFreeSlot(room.busy, start, end - start, dayFrom, dayTo) : null,
        };
      }),
    }));
  }

  // Whether the downloaded schedule reaches the requested day.
  const covers = (data, day) => day >= data.from && day < data.to;

  const api = {
    HOUR,
    warsawTime,
    warsawDay,
    formatTime,
    conflicts,
    nearestFreeSlot,
    checkRooms,
    covers,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Availability = api;
})(typeof window !== 'undefined' ? window : this);
