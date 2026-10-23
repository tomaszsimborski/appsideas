// Run with: node sale-prob/test/availability.test.js
'use strict';
const assert = require('assert');
const A = require('../availability.js');

const H = A.HOUR;
let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + err.message);
  }
};

test('warsawTime handles summer and winter time', () => {
  assert.strictEqual(new Date(A.warsawTime('2026-07-10', 19)).toISOString(), '2026-07-10T17:00:00.000Z');
  assert.strictEqual(new Date(A.warsawTime('2026-11-10', 19)).toISOString(), '2026-11-10T18:00:00.000Z');
  // Hours past midnight roll into the next day.
  assert.strictEqual(new Date(A.warsawTime('2026-11-10', 25)).toISOString(), '2026-11-11T00:00:00.000Z');
});

test('warsawTime on the day clocks go back (25 October 2026)', () => {
  assert.strictEqual(new Date(A.warsawTime('2026-10-25', 0)).toISOString(), '2026-10-24T22:00:00.000Z');
  assert.strictEqual(new Date(A.warsawTime('2026-10-25', 19)).toISOString(), '2026-10-25T18:00:00.000Z');
  assert.strictEqual(A.warsawTime('2026-10-25', 24) - A.warsawTime('2026-10-25', 0), 25 * H);
});

test('warsawDay and formatTime use Polish time', () => {
  const t = Date.parse('2026-10-27T22:30:00Z'); // 23:30 in Warsaw
  assert.strictEqual(A.warsawDay(t), '2026-10-27');
  assert.strictEqual(A.formatTime(t), '23:30');
  assert.strictEqual(A.warsawDay(Date.parse('2026-10-27T23:30:00Z')), '2026-10-28');
});

const day = '2026-10-27';
const at = (h) => A.warsawTime(day, h);
// Booked 16–19 and 20–22.
const busy = [[at(16), at(19)], [at(20), at(22)]];

test('conflicts finds overlaps and treats touching bookings as free', () => {
  assert.deepStrictEqual(A.conflicts(busy, at(18), at(21)), busy);
  assert.deepStrictEqual(A.conflicts(busy, at(19), at(20)), []);
  assert.deepStrictEqual(A.conflicts(busy, at(13), at(16)), []);
  assert.deepStrictEqual(A.conflicts(busy, at(21), at(23)), [busy[1]]);
});

test('nearestFreeSlot picks the closest slot that fits, earlier on a tie', () => {
  // 3 h from 19:00 clashes; 13–16 is 3 h earlier, 22–01 does not fit the day.
  assert.deepStrictEqual(A.nearestFreeSlot(busy, at(19), 3 * H, at(0), at(24)), [at(13), at(16)]);
  // 2 h from 18:00: 14–16 (4 h earlier) vs 22–24 (4 h later) -> earlier.
  assert.deepStrictEqual(A.nearestFreeSlot(busy, at(18), 2 * H, at(0), at(24)), [at(14), at(16)]);
  // 1 h at 20:00 -> 19–20.
  assert.deepStrictEqual(A.nearestFreeSlot(busy, at(20), H, at(0), at(24)), [at(19), at(20)]);
});

test('nearestFreeSlot returns null when the day is full', () => {
  assert.strictEqual(A.nearestFreeSlot([[at(0), at(24)]], at(19), 2 * H, at(0), at(24)), null);
  assert.strictEqual(A.nearestFreeSlot(busy, at(19), 17 * H, at(0), at(24)), null);
});

test('checkRooms reports free and busy rooms per venue', () => {
  const data = {
    from: '2026-10-23',
    to: '2026-11-20',
    venues: [
      { id: 'a', name: 'A', rooms: [{ id: 'a1', name: 'A1', busy }, { id: 'a2', name: 'A2', busy: [] }] },
      { id: 'b', name: 'B', rooms: [{ id: 'b1', name: 'B1', busy: [[at(12), at(14)]] }] },
    ],
  };
  const res = A.checkRooms(data, at(19), at(22), at(0), at(24));
  assert.deepStrictEqual(res.map((g) => g.rooms.map((r) => r.free)), [[false, true], [true]]);
  assert.deepStrictEqual(res[0].rooms[0].alternative, [at(13), at(16)]);
  assert.strictEqual(res[0].rooms[1].alternative, null);
  assert.ok(A.covers(data, '2026-11-19'));
  assert.ok(!A.covers(data, '2026-11-20'));
  assert.ok(!A.covers(data, '2026-10-22'));
});

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tests passed');
