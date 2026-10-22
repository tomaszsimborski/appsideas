// Synthesises crude vocal-beatbox-like recordings for testing the analysis.
'use strict';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Simple one-pole/biquad helpers
function biquad(type, freq, q, sr) {
  const w = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; } // band-pass
  a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// Voiced sound: harmonics of f0 shaped by formants.
function voiced(out, start, sr, f0, formants, dur, amp, rand) {
  const n = Math.floor(dur * sr);
  const filters = formants.map(([f, q]) => biquad('bp', f, q, sr));
  let phase = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.008) * Math.exp(-t / (dur / 3));
    phase += (f0 * (1 - 0.15 * t / dur)) / sr;
    // glottal-ish pulse train (sawtooth)
    const src = 2 * (phase % 1) - 1 + 0.05 * (rand() * 2 - 1);
    let y = 0;
    filters.forEach((f) => { y += f(src); });
    out[start + i] += amp * env * y;
  }
}

function noise(out, start, sr, type, freq, q, dur, amp, rand, attack = 0.002) {
  const n = Math.floor(dur * sr);
  const f = biquad(type, freq, q, sr);
  const f2 = biquad(type, freq, q, sr);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / attack) * Math.exp(-t / (dur / 3));
    out[start + i] += amp * env * f2(f(rand() * 2 - 1));
  }
}

const SOUNDS = {
  // "boom": lip burst + low voiced 'u'
  kick(out, s, sr, r) {
    noise(out, s, sr, 'lp', 400, 0.7, 0.02, 0.6, r);
    voiced(out, s, sr, 100 + 20 * r(), [[150, 2], [320, 4], [800, 6]], 0.18, 0.9, r);
  },
  // "ka": velar burst + 'a' vowel
  snare(out, s, sr, r) {
    noise(out, s, sr, 'bp', 2200, 1.2, 0.04, 1.2, r);
    voiced(out, s + Math.floor(0.015 * sr), sr, 150 + 20 * r(), [[750, 5], [1200, 6], [2600, 8]], 0.1, 0.6, r);
  },
  // "ts": tongue click + sibilant hiss
  hihat(out, s, sr, r) {
    noise(out, s, sr, 'hp', 6000, 0.7, 0.07, 0.8, r, 0.004);
  },
};

// "tu" / "ta" / "ts": all three start with the same alveolar "t" burst.
function tBurst(out, s, sr, r) {
  noise(out, s, sr, 'hp', 3500, 0.7, 0.012, 0.9, r, 0.001);
}
const SOUNDS_TU_TA = {
  kick(out, s, sr, r) {
    tBurst(out, s, sr, r);
    voiced(out, s + Math.floor(0.01 * sr), sr, 110 + 20 * r(), [[300, 4], [800, 6], [2300, 10]], 0.15, 0.8, r);
  },
  snare(out, s, sr, r) {
    tBurst(out, s, sr, r);
    voiced(out, s + Math.floor(0.01 * sr), sr, 130 + 20 * r(), [[750, 5], [1250, 6], [2600, 8]], 0.12, 0.7, r);
  },
  hihat(out, s, sr, r) {
    tBurst(out, s, sr, r);
    noise(out, s + Math.floor(0.008 * sr), sr, 'hp', 6000, 0.7, 0.07, 0.8, r, 0.004);
  },
};

// Metronome click as heard through a speaker and picked up by the mic.
function click(out, s, sr, freq, amp) {
  const n = Math.floor(0.03 * sr);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = i / sr;
    out[s + i] += amp * Math.sin(2 * Math.PI * freq * t) * Math.min(1, t / 0.001) * Math.exp(-t / 0.008);
  }
}

// pattern: array of {step, drum}; steps are 16th notes
function render({ bpm, pattern, bars = 1, sr = 48000, jitterMs = 12, lead = 0.6, seed = 1, noiseDb = -55,
  sounds = 'boomka', clicks = null }) {
  const r = rng(seed);
  const set = sounds === 'tuta' ? SOUNDS_TU_TA : SOUNDS;
  const s = 15 / bpm;
  const dur = lead + bars * 16 * s + 1;
  const out = new Float32Array(Math.ceil(dur * sr));
  const truth = [];
  for (let b = 0; b < bars; b++) {
    for (const { step, drum } of pattern) {
      const t = lead + (b * 16 + step) * s + ((r() * 2 - 1) * jitterMs) / 1000;
      const amp = 0.6 + 0.4 * r();
      const start = Math.floor(t * sr);
      const tmp = new Float32Array(Math.floor(0.4 * sr));
      set[drum](tmp, 0, sr, r);
      for (let i = 0; i < tmp.length && start + i < out.length; i++) out[start + i] += amp * tmp[i] * 0.3;
      truth.push({ time: t, drum, step: b * 16 + step });
    }
  }
  // clicks: { amp, freqs: [accent, normal], countIn } - metronome leaking into the mic,
  // one per beat from `lead - countIn beats` to the end.
  if (clicks) {
    const beat = 4 * s;
    for (let k = -(clicks.countIn || 0); lead + k * beat < dur - 0.1; k++) {
      const t = lead + k * beat;
      if (t >= 0) click(out, Math.floor(t * sr), sr, clicks.freqs[((k % 4) + 4) % 4 === 0 ? 0 : 1], clicks.amp);
    }
  }
  const na = Math.pow(10, noiseDb / 20);
  for (let i = 0; i < out.length; i++) out[i] += na * (r() * 2 - 1);
  return { samples: out, sr, truth };
}

function toWav(samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  const g = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * g * 32767))), 44 + i * 2);
  return buf;
}

module.exports = { render, toWav };
