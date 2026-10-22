/*
 * Beatbox analysis: onset detection, drum classification, tempo estimation
 * and quantisation. Pure functions with no DOM access, so they can run in
 * the browser (as window.BeatboxAnalysis) or in Node for testing.
 */
(function (root) {
  'use strict';

  const DRUMS = ['hihat', 'snare', 'kick'];

  const CONFIG = {
    frameSize: 1024,          // STFT window (samples)
    hopSize: 256,             // STFT hop (samples)
    minFreq: 40,              // ignore rumble below this
    maxFreq: 16000,           // ignore content above this
    medianHalfWidthSec: 0.1,  // adaptive threshold window (each side)
    peakHalfWidth: 3,         // frames each side a peak must dominate
    minGapSec: 0.07,          // minimum time between two hits
    gateDb: 38,               // hits quieter than loudest - gateDb are ignored
    featureWindowSec: 0.05,   // audio after each onset used for classification
    lowBand: [40, 300],
    midBand: [300, 4000],
    highBand: [4000, 16000],
    // Classification thresholds (fallbacks when the recording is not clearly bimodal)
    hatHighRatio: 0.35,
    hatCentroid: 3500,
    kickLowRatio: 0.45,
    kickCentroid: 650,
    // Tempo search
    minBpm: 60,
    maxBpm: 180,
    preferredBpm: 105,
  };

  /* ---------- FFT ---------- */

  function makeFFT(n) {
    const levels = Math.log2(n);
    if (levels % 1 !== 0) throw new Error('FFT size must be a power of 2');
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
      rev[i] = r;
    }
    return function fft(re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size *= 2) {
        const half = size / 2;
        const step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const tre = re[l] * cos[k] + im[l] * sin[k];
            const tim = -re[l] * sin[k] + im[l] * cos[k];
            re[l] = re[j] - tre;
            im[l] = im[j] - tim;
            re[j] += tre;
            im[j] += tim;
          }
        }
      }
    };
  }

  /* ---------- Spectrogram ---------- */

  function spectrogram(samples, sampleRate, cfg) {
    const N = cfg.frameSize;
    const hop = cfg.hopSize;
    const nBins = N / 2 + 1;
    const nFrames = Math.max(1, Math.floor((samples.length - N) / hop) + 1);

    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    const gain = peak > 0 ? 1 / peak : 1;

    const win = new Float64Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

    const fft = makeFFT(N);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    const mags = new Array(nFrames);
    const rms = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
      const off = t * hop;
      let sq = 0;
      for (let i = 0; i < N; i++) {
        const x = (off + i < samples.length ? samples[off + i] : 0) * gain;
        sq += x * x;
        re[i] = x * win[i];
        im[i] = 0;
      }
      rms[t] = Math.sqrt(sq / N);
      fft(re, im);
      const m = new Float32Array(nBins);
      for (let k = 0; k < nBins; k++) m[k] = (2 / N) * Math.hypot(re[k], im[k]);
      mags[t] = m;
    }
    return { mags, rms, nFrames, nBins, binHz: sampleRate / N, hop, N, sampleRate };
  }

  /* ---------- Onset detection (log spectral flux) ---------- */

  function median(arr) {
    const s = Array.from(arr).sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // sensitivity: 1 (only the clearest hits) .. 10 (everything)
  function detectOnsets(spec, sensitivity, cfg) {
    const { mags, rms, nFrames, binHz, hop, sampleRate } = spec;
    const kLo = Math.max(1, Math.floor(cfg.minFreq / binHz));
    const kHi = Math.min(spec.nBins - 1, Math.ceil(cfg.maxFreq / binHz));

    const flux = new Float32Array(nFrames);
    let prev = null;
    for (let t = 0; t < nFrames; t++) {
      const cur = new Float32Array(kHi - kLo + 1);
      for (let k = kLo; k <= kHi; k++) cur[k - kLo] = Math.log1p(100 * mags[t][k]);
      if (prev) {
        let f = 0;
        for (let i = 0; i < cur.length; i++) {
          const d = cur[i] - prev[i];
          if (d > 0) f += d;
        }
        flux[t] = f;
      }
      prev = cur;
    }

    let maxFlux = 0;
    for (let t = 0; t < nFrames; t++) maxFlux = Math.max(maxFlux, flux[t]);
    if (maxFlux <= 0) return { onsets: [], flux };
    for (let t = 0; t < nFrames; t++) flux[t] /= maxFlux;

    let maxRms = 0;
    for (let t = 0; t < nFrames; t++) maxRms = Math.max(maxRms, rms[t]);
    const gate = maxRms * Math.pow(10, -cfg.gateDb / 20);

    const s = Math.min(10, Math.max(1, sensitivity));
    const delta = 0.04 + (10 - s) * 0.016;
    const w = Math.max(2, Math.round((cfg.medianHalfWidthSec * sampleRate) / hop));
    const m = cfg.peakHalfWidth;
    const gapFrames = Math.round((cfg.minGapSec * sampleRate) / hop);

    const onsets = [];
    for (let t = 1; t < nFrames; t++) {
      const thr = median(flux.subarray(Math.max(0, t - w), Math.min(nFrames, t + w + 1))) + delta;
      if (flux[t] < thr) continue;
      let isPeak = true;
      for (let j = Math.max(0, t - m); j <= Math.min(nFrames - 1, t + m); j++) {
        if (flux[j] > flux[t] || (flux[j] === flux[t] && j < t)) { isPeak = false; break; }
      }
      if (!isPeak) continue;
      let loud = 0;
      for (let j = t; j < Math.min(nFrames, t + 4); j++) loud = Math.max(loud, rms[j]);
      if (loud < gate) continue;

      const last = onsets[onsets.length - 1];
      if (last && t - last.frame < gapFrames) {
        if (flux[t] > last.strength) { last.frame = t; last.strength = flux[t]; }
        continue;
      }
      onsets.push({ frame: t, strength: flux[t] });
    }

    // Onset sits roughly a third of the way into the frame where flux peaks.
    for (const o of onsets) o.time = (o.frame * hop + spec.N * 0.35) / sampleRate;
    return { onsets, flux };
  }

  /* ---------- Features & classification ---------- */

  function bandSum(power, binHz, band) {
    const k0 = Math.max(1, Math.floor(band[0] / binHz));
    const k1 = Math.min(power.length - 1, Math.ceil(band[1] / binHz));
    let s = 0;
    for (let k = k0; k <= k1; k++) s += power[k];
    return s;
  }

  // Background noise power per bin: a low percentile over (a sample of) frames.
  function noiseFloor(spec) {
    const { mags, nFrames, nBins } = spec;
    const stride = Math.max(1, Math.floor(nFrames / 400));
    const floor = new Float64Array(nBins);
    const col = [];
    for (let k = 0; k < nBins; k++) {
      col.length = 0;
      for (let t = 0; t < nFrames; t += stride) col.push(mags[t][k] * mags[t][k]);
      col.sort((a, b) => a - b);
      floor[k] = col[Math.floor(col.length * 0.2)];
    }
    return floor;
  }

  function extractFeatures(spec, frame, endFrame, cfg, floor) {
    const { mags, binHz, nBins } = spec;
    const power = new Float64Array(nBins);
    const nf = endFrame - frame + 1;
    for (let t = frame; t <= endFrame; t++) {
      const m = mags[t];
      for (let k = 0; k < nBins; k++) power[k] += m[k] * m[k];
    }
    if (floor) for (let k = 0; k < nBins; k++) power[k] = Math.max(0, power[k] - 2 * nf * floor[k]);
    const kLo = Math.max(1, Math.floor(cfg.minFreq / binHz));
    const kHi = Math.min(nBins - 1, Math.ceil(cfg.maxFreq / binHz));
    let num = 0, den = 0;
    for (let k = kLo; k <= kHi; k++) {
      num += power[k] * k * binHz;
      den += power[k];
    }
    const low = bandSum(power, binHz, cfg.lowBand);
    const mid = bandSum(power, binHz, cfg.midBand);
    const high = bandSum(power, binHz, cfg.highBand);
    const total = low + mid + high || 1;
    return {
      centroid: den > 0 ? num / den : 0,
      low: low / total,
      mid: mid / total,
      high: high / total,
    };
  }

  function isHat(f, cfg) {
    return f.high >= cfg.hatHighRatio || f.centroid >= cfg.hatCentroid;
  }

  function isKick(f, cfg) {
    return f.low >= cfg.kickLowRatio || f.centroid < cfg.kickCentroid;
  }

  // Otsu split of a 1-D set; returns { threshold, separation } (separation in the
  // same units as the values) or null when there are too few values.
  function otsuSplit(values) {
    if (values.length < 4) return null;
    const v = values.slice().sort((a, b) => a - b);
    let best = null;
    for (let i = 1; i < v.length; i++) {
      const a = v.slice(0, i), b = v.slice(i);
      const ma = a.reduce((x, y) => x + y, 0) / a.length;
      const mb = b.reduce((x, y) => x + y, 0) / b.length;
      const between = (a.length * b.length) * (ma - mb) * (ma - mb);
      const spread = Math.max(
        ...a.map((x) => Math.abs(x - ma)),
        ...b.map((x) => Math.abs(x - mb))
      );
      if (!best || between > best.between) {
        best = { between, threshold: (v[i - 1] + v[i]) / 2, separation: mb - ma, spread };
      }
    }
    return best;
  }

  function classifyAll(features, cfg) {
    const labels = features.map((f) => (isHat(f, cfg) ? 'hihat' : null));
    // Kick vs snare: if the non-hat hits split cleanly into a dark and a bright
    // group (by log centroid), use that split - it adapts to the mic and voice.
    // Otherwise fall back to fixed thresholds.
    const idx = labels.map((l, i) => (l ? -1 : i)).filter((i) => i >= 0);
    const logC = idx.map((i) => Math.log2(Math.max(50, features[i].centroid)));
    const split = otsuSplit(logC);
    const adaptive = split && split.separation >= 0.8 && split.separation > 1.5 * split.spread;
    idx.forEach((i, j) => {
      if (adaptive) labels[i] = logC[j] < split.threshold ? 'kick' : 'snare';
      else labels[i] = isKick(features[i], cfg) ? 'kick' : 'snare';
    });
    return labels;
  }

  /* ---------- Full analysis ---------- */

  function analyse(samples, sampleRate, options) {
    const cfg = Object.assign({}, CONFIG, options && options.config);
    const sensitivity = (options && options.sensitivity) || 6;
    const spec = spectrogram(samples, sampleRate, cfg);
    const { onsets } = detectOnsets(spec, sensitivity, cfg);
    const winFrames = Math.max(2, Math.round((cfg.featureWindowSec * sampleRate) / cfg.hopSize));
    const floor = noiseFloor(spec);
    const features = onsets.map((o, i) => {
      const next = onsets[i + 1] ? onsets[i + 1].frame - 1 : Infinity;
      const end = Math.min(spec.nFrames - 1, o.frame + winFrames, Math.max(o.frame + 1, next));
      return extractFeatures(spec, o.frame, end, cfg, floor);
    });
    const labels = classifyAll(features, cfg);
    return onsets.map((o, i) => ({
      time: o.time,
      strength: o.strength,
      features: features[i],
      label: labels[i],
    }));
  }

  /* ---------- Tempo ---------- */

  const BEAT_WEIGHT = { kick: 1, snare: 0.9, hihat: 0.3 };

  function tempoScore(times, weights, bpm, cfg) {
    const s = 15 / bpm; // one 16th note
    const sigma = 0.1;
    let fit = 0, fitW = 0;
    for (let i = 0; i < times.length; i++) {
      for (let j = i + 1; j < Math.min(times.length, i + 5); j++) {
        const d = times[j] - times[i];
        if (d > 2.5) break;
        const r = d / s;
        const n = Math.round(r);
        const e = n === 0 ? r : r - n;
        const pw = 1 / (j - i);
        fit += pw * Math.exp(-(e * e) / (2 * sigma * sigma));
        fitW += pw;
      }
    }
    fit = fitW ? fit / fitW : 0;

    // How strongly the accented hits line up on quarter / eighth notes.
    const coherence = (period) => {
      let c = 0, sn = 0, w = 0;
      for (let i = 0; i < times.length; i++) {
        const th = (2 * Math.PI * times[i]) / period;
        c += weights[i] * Math.cos(th);
        sn += weights[i] * Math.sin(th);
        w += weights[i];
      }
      return w ? Math.hypot(c, sn) / w : 0;
    };
    const beat = 0.6 * coherence(4 * s) + 0.4 * coherence(2 * s);
    const oct = Math.log2(bpm / cfg.preferredBpm);
    const prior = Math.exp(-0.5 * (oct / 0.6) * (oct / 0.6));
    return fit * (0.4 + 0.6 * beat) * prior;
  }

  function estimateTempo(hits, options) {
    const cfg = Object.assign({}, CONFIG, options && options.config);
    const sorted = hits.slice().sort((a, b) => a.time - b.time);
    if (sorted.length < 3) return null;
    const times = sorted.map((h) => h.time);
    const weights = sorted.map((h) => BEAT_WEIGHT[h.label] || 1);
    let best = { bpm: cfg.preferredBpm, score: -1 };
    for (let b = cfg.minBpm; b <= cfg.maxBpm; b += 0.25) {
      const sc = tempoScore(times, weights, b, cfg);
      if (sc > best.score) best = { bpm: b, score: sc };
    }
    // Refine: assign each hit to a 16th step at the coarse tempo, then fit
    // time = origin + step * stepSec by least squares.
    const grid = makeGrid(sorted, best.bpm);
    const steps = times.map(grid.stepOf);
    const n = times.length;
    const mx = steps.reduce((a, b) => a + b, 0) / n;
    const my = times.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (steps[i] - mx) * (times[i] - my);
      sxx += (steps[i] - mx) * (steps[i] - mx);
    }
    if (sxx > 0) {
      const refined = 15 / (sxy / sxx);
      if (Math.abs(refined - best.bpm) / best.bpm < 0.03) return Math.round(refined);
    }
    return Math.round(best.bpm);
  }

  /* ---------- Quantisation ---------- */

  // Builds a 16th-note grid for `bpm` that best fits the detected hits.
  // Returns { stepSec, origin, stepOf(time) }: step 0 is the first beat that
  // starts at or before the first hit, so bar 1 / beat 1 sits at `origin`.
  function makeGrid(hits, bpm) {
    const s = 15 / bpm;
    const times = hits.map((h) => h.time);
    if (!times.length) {
      return { stepSec: s, origin: 0, stepOf: (t) => Math.round(t / s) };
    }
    const weights = hits.map((h) => BEAT_WEIGHT[h.label] || 1);

    // Phase of the 16th grid: weighted circular mean of hit phases.
    let c = 0, sn = 0;
    times.forEach((t, i) => {
      const th = (2 * Math.PI * t) / s;
      c += weights[i] * Math.cos(th);
      sn += weights[i] * Math.sin(th);
    });
    const phase = Math.atan2(sn, c) / (2 * Math.PI) * s;
    const idx = times.map((t) => Math.round((t - phase) / s));
    const first = Math.min(...idx);

    // Which 16th inside a beat is "on the beat": the one carrying most kick/snare weight.
    const pos = [0, 0, 0, 0];
    idx.forEach((k, i) => { pos[((k % 4) + 4) % 4] += weights[i]; });
    let o = ((first % 4) + 4) % 4;
    for (let p = 0; p < 4; p++) if (pos[p] > pos[o] + 1e-9) o = p;

    let start = first;
    while ((((start - o) % 4) + 4) % 4 !== 0) start--;
    const origin = phase + start * s;
    return {
      stepSec: s,
      origin,
      stepOf: (t) => Math.round((t - origin) / s),
    };
  }

  const api = {
    DRUMS,
    CONFIG,
    makeFFT,
    spectrogram,
    detectOnsets,
    extractFeatures,
    classifyAll,
    analyse,
    estimateTempo,
    makeGrid,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatboxAnalysis = api;
})(typeof window !== 'undefined' ? window : this);
