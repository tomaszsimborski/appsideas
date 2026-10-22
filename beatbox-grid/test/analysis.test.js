// Run with: node beatbox-grid/test/analysis.test.js
'use strict';
const A = require('../analysis.js');
const { render } = require('./synth.js');

const P = (s) => s.split(/\s+/).filter(Boolean).map((tok) => {
  const [step, d] = tok.split(':');
  return { step: +step, drum: { k: 'kick', s: 'snare', h: 'hihat' }[d] };
});

const PATTERNS = {
  basic: P('0:k 2:h 4:s 6:h 8:k 10:h 12:s 14:h'),
  boomBap: P('0:k 4:s 6:k 10:k 12:s 14:h'),
  sixteenthHats: P('0:k 1:h 2:h 3:h 4:s 5:h 6:h 7:h 8:k 9:h 10:h 11:h 12:s 13:h 14:h 15:h'),
  fourOnFloor: P('0:k 2:h 4:k 6:h 8:k 10:h 12:k 14:h'),
};

let failures = 0;
const cases = [];
for (const [name, pattern] of Object.entries(PATTERNS)) {
  for (const bpm of [80, 95, 110, 130]) cases.push({ name, pattern, bpm, bars: 2 });
}
// "tu" = kick, "ta" = snare, "ts" = hi-hat
for (const [name, pattern] of Object.entries(PATTERNS)) {
  for (const bpm of [85, 120]) cases.push({ name: name + '/tuta', pattern, bpm, bars: 2, sounds: 'tuta' });
}
// Recorded with a metronome that leaks into the mic, a 1-bar count-in and an
// imperfect latency estimate. Steps must match bar positions exactly, even
// when the pattern does not start on beat 1.
const CLICK_FREQS = [2400, 1800];
const offbeat = P('2:h 4:s 6:h 8:k 10:k 12:s 14:h');
for (const [latency, bpm, pattern, name] of [
  [0.04, 100, PATTERNS.basic, 'basic'],
  [-0.03, 90, offbeat, 'offbeat'],
  [0.06, 120, PATTERNS.sixteenthHats, 'sixteenthHats'],
  [0.02, 85, offbeat, 'offbeat'],
  // Unaccounted output latency (e.g. Bluetooth headphones): hits land ~200 ms after the clicks
  [-0.2, 100, PATTERNS.basic, 'basic/bt'],
  [-0.18, 90, offbeat, 'offbeat/bt'],
  [-0.15, 120, PATTERNS.boomBap, 'boomBap/bt'],
  // Came in one bar late after the count-in: the empty bar is skipped
  [0.03 - 2.4, 100, PATTERNS.basic, 'basic/late'],
]) {
  cases.push({ name: name + '/metro', pattern, bpm, bars: 2, sounds: 'tuta', lead: 3,
    clicks: { amp: 0.15, freqs: CLICK_FREQS, countIn: 4 }, metronome: { latency } });
}
// Sloppier / noisier takes
cases.push({ name: 'basic', pattern: PATTERNS.basic, bpm: 100, bars: 4, jitterMs: 20, noiseDb: -40 });
cases.push({ name: 'boomBap', pattern: PATTERNS.boomBap, bpm: 90, bars: 4, jitterMs: 20, noiseDb: -40, sr: 44100 });
cases.push({ name: 'sixteenthHats', pattern: PATTERNS.sixteenthHats, bpm: 120, bars: 3, jitterMs: 15, noiseDb: -45 });

for (const c of cases) {
  const { samples, sr, truth } = render(Object.assign({ seed: c.bpm }, c));
  const metro = c.metronome;
  const hits = A.analyse(samples, sr, { sensitivity: 6, clickFreqs: metro ? CLICK_FREQS : null });
  const bpm = metro ? c.bpm : A.estimateTempo(hits);
  // With a metronome, the app knows (roughly) where bar 1 starts.
  const grid = A.makeGrid(hits, bpm || 100, metro ? (c.lead || 0.6) + metro.latency : undefined);

  // Match detected hits to truth (within 40 ms)
  let matched = 0, correctLabel = 0;
  const used = new Set();
  for (const t of truth) {
    let bi = -1, bd = 0.04;
    hits.forEach((h, i) => {
      const d = Math.abs(h.time - t.time);
      if (!used.has(i) && d < bd) { bd = d; bi = i; }
    });
    if (bi >= 0) {
      used.add(bi);
      matched++;
      if (hits[bi].label === t.drum) correctLabel++;
    }
  }
  // Quantised steps should equal the true steps (relative to the first hit)
  let stepOk = 0;
  const t0 = metro ? 0 : truth[0].step;
  const sortedHits = hits.slice().sort((a, b) => a.time - b.time);
  const h0 = metro ? 0 : grid.stepOf(sortedHits[0].time);
  for (const t of truth) {
    const h = hits.find((x) => Math.abs(x.time - t.time) < 0.04);
    if (h && grid.stepOf(h.time) - h0 === t.step - t0) stepOk++;
  }
  const ok = matched === truth.length && hits.length === truth.length &&
    correctLabel >= truth.length * 0.9 && Math.abs(bpm - c.bpm) <= 1 && stepOk === truth.length;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${c.name.padEnd(14)} ${String(c.bpm).padStart(3)}bpm x${c.bars} jitter ${c.jitterMs || 12}ms ` +
    `hits ${hits.length}/${truth.length} labels ${correctLabel}/${truth.length} ` +
    `bpm→${bpm} steps ${stepOk}/${truth.length}`
  );
  if (!ok && process.env.VERBOSE) {
    hits.forEach((h) => console.log('   ', h.time.toFixed(3), h.label, JSON.stringify(h.features, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))));
  }
}
console.log(failures ? `\n${failures} case(s) failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
