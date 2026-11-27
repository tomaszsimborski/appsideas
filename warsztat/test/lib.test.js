// Uruchom: node warsztat/test/lib.test.js
'use strict';
const assert = require('assert');
const L = require('../lib.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

test('statusy w kolejności pracy nad utworem', () => {
  assert.deepStrictEqual(L.STATUSES.map((s) => s.label),
    ['Motyw', 'Koncept', 'Forma', 'Dopracowywanie', 'Zrobione', 'Nagrane']);
  assert.strictEqual(L.statusIndex('forma'), 2);
  assert.strictEqual(L.statusIndex('nieznany'), 0);
});

test('cztery foldery', () => {
  assert.deepStrictEqual(L.FOLDERS.map((f) => f.label),
    ['Nagrania z prób', 'Motywy i riffy', 'Inspiracje', 'Szkice z DAW']);
});

test('tempo w granicach', () => {
  assert.strictEqual(L.clampBpm(10), 30);
  assert.strictEqual(L.clampBpm(999), 300);
  assert.strictEqual(L.clampBpm('96.4'), 96);
  assert.strictEqual(L.clampBpm('abc'), 120);
});

test('tap tempo: 500 ms = 120 BPM, przerwa zeruje', () => {
  let r = { taps: [] };
  for (const t of [0, 500, 1000, 1500]) r = L.tapTempo(r.taps, t);
  assert.strictEqual(r.bpm, 120);
  r = L.tapTempo(r.taps, 5000);
  assert.strictEqual(r.bpm, null);
  assert.strictEqual(r.taps.length, 1);
  r = L.tapTempo(r.taps, 5625);
  assert.strictEqual(r.bpm, 96);
});

test('linki Spotify', () => {
  const t = L.parseSpotify('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123');
  assert.deepStrictEqual(t, {
    kind: 'track', id: '4uLU6hMCjMI75M1A2tKUQC',
    url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    embed: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC',
  });
  assert.strictEqual(L.parseSpotify('https://open.spotify.com/intl-pl/album/1ATL5GLyefJaxhQzSPVrLX').kind, 'album');
  assert.strictEqual(L.parseSpotify('open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').kind, 'playlist');
  assert.strictEqual(L.parseSpotify('spotify:track:4uLU6hMCjMI75M1A2tKUQC').id, '4uLU6hMCjMI75M1A2tKUQC');
  assert.strictEqual(L.parseSpotify('https://youtube.com/watch?v=x'), null);
  assert.strictEqual(L.parseSpotify(''), null);
});

test('formatowanie czasu', () => {
  assert.strictEqual(L.formatTime(0), '0:00');
  assert.strictEqual(L.formatTime(65.9), '1:05');
  assert.strictEqual(L.formatTime(3725), '1:02:05');
  assert.strictEqual(L.formatTime(NaN), '0:00');
});

test('polska odmiana', () => {
  assert.strictEqual(L.countLabel(1, 'nagranie', 'nagrania', 'nagrań'), '1 nagranie');
  assert.strictEqual(L.countLabel(3, 'nagranie', 'nagrania', 'nagrań'), '3 nagrania');
  assert.strictEqual(L.countLabel(5, 'nagranie', 'nagrania', 'nagrań'), '5 nagrań');
  assert.strictEqual(L.countLabel(12, 'nagranie', 'nagrania', 'nagrań'), '12 nagrań');
  assert.strictEqual(L.countLabel(22, 'nagranie', 'nagrania', 'nagrań'), '22 nagrania');
});

test('daty względne', () => {
  const now = new Date(2026, 10, 27, 13, 0).getTime();
  assert.strictEqual(L.relativeDate(now - 10e3, now), 'przed chwilą');
  assert.strictEqual(L.relativeDate(now - 5 * 60e3, now), '5 min temu');
  assert.strictEqual(L.relativeDate(new Date(2026, 10, 26, 22, 0).getTime(), now), 'wczoraj');
  assert.strictEqual(L.relativeDate(new Date(2026, 9, 3).getTime(), now), '3 paź');
  assert.strictEqual(L.relativeDate(new Date(2025, 0, 3).getTime(), now), '3 sty 2025');
});

test('nazwy plików i nagrań', () => {
  assert.strictEqual(L.fileTitle('Riff_w_D.m4a'), 'Riff w D');
  assert.strictEqual(L.fileTitle('Próba 12.11.wav'), 'Próba 12.11');
  assert.strictEqual(L.defaultRecordingTitle(new Date(2026, 10, 7, 9, 5)), 'Nagranie 07.11 09:05');
});

test('filtrowanie i wyszukiwanie utworów', () => {
  const songs = [
    { id: 'a', title: 'Ostatni pociąg', status: 'forma', lyrics: 'peron', updatedAt: 1 },
    { id: 'b', title: 'Mgła', status: 'motyw', lyrics: 'Łódź na rzece', updatedAt: 3 },
    { id: 'c', title: 'Szkic', status: 'forma', notes: 'przester', updatedAt: 2 },
  ];
  assert.deepStrictEqual(L.filterSongs(songs).map((s) => s.id), ['b', 'c', 'a']);
  assert.deepStrictEqual(L.filterSongs(songs, { status: 'forma' }).map((s) => s.id), ['c', 'a']);
  assert.deepStrictEqual(L.filterSongs(songs, { query: 'pociag' }).map((s) => s.id), ['a']);
  assert.deepStrictEqual(L.filterSongs(songs, { query: 'lodz' }).map((s) => s.id), ['b']);
  assert.deepStrictEqual(L.filterSongs(songs, { query: 'PRZESTER' }).map((s) => s.id), ['c']);
});

test('miniatura fali', () => {
  const samples = new Float32Array(1000);
  samples[100] = 0.5; samples[900] = -1;
  const p = L.peaks(samples, 10);
  assert.strictEqual(p.length, 10);
  assert.strictEqual(p[9], 1);
  assert.strictEqual(p[1], 0.5);
  assert.deepStrictEqual(L.peaks(new Float32Array(0), 3), [0, 0, 0]);
});

if (failures) { console.log('\n' + failures + ' nie przeszło'); process.exit(1); }
console.log('\nWszystko przeszło.');
