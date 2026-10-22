(() => {
  'use strict';

  const A = window.BeatboxAnalysis;
  const DRUMS = ['hihat', 'snare', 'kick'];
  const NAMES = { hihat: 'Hi-hat', snare: 'Snare', kick: 'Kick' };
  const COLORS = { hihat: '#f5c84b', snare: '#4fd1c5', kick: '#ff7a59' };
  const STEPS_PER_BAR = 16;
  const MAX_RECORD_SEC = 120;
  const $ = (id) => document.getElementById(id);
  const mod = (n, m) => ((n % m) + m) % m;

  const state = {
    buffer: null,      // AudioBuffer holding the recording
    samples: null,     // mono Float32Array of the recording
    hits: [],          // { time, label, autoLabel, features, deleted, manual, rawStep, step }
    detectedBpm: null,
    bpm: 100,
    shift: 0,          // user rotation of the pattern, in steps
    grid: null,        // { stepSec, origin, totalSteps, bars, cells: { drum: Map(step -> [hitIndex]) } }
  };

  /* ---------- Audio context & output ---------- */

  let ac = null;
  let master = null;
  let noiseBuffer = null;

  function audio() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createDynamicsCompressor();
      master.threshold.value = -10;
      master.connect(ac.destination);
      noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ac;
  }

  /* ---------- Synthesised drums ---------- */

  function envGain(t, peak, decay) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(master);
    return g;
  }

  function noiseSource(t, dur) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }

  const synth = {
    kick(t) {
      const osc = ac.createOscillator();
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      osc.connect(envGain(t, 1, 0.42));
      osc.start(t);
      osc.stop(t + 0.45);
    },
    snare(t) {
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      noiseSource(t, 0.22).connect(hp);
      hp.connect(envGain(t, 0.55, 0.2));
      const tone = ac.createOscillator();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(190, t);
      tone.frequency.exponentialRampToValueAtTime(150, t + 0.1);
      tone.connect(envGain(t, 0.45, 0.12));
      tone.start(t);
      tone.stop(t + 0.14);
    },
    hihat(t) {
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7500;
      noiseSource(t, 0.08).connect(hp);
      hp.connect(envGain(t, 0.32, 0.06));
    },
  };

  /* ---------- Status helpers ---------- */

  function setStatus(msg, isError) {
    const el = $('status');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  }

  /* ---------- Recording ---------- */

  let rec = null;

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Microphone access is not available in this browser.', true);
      return;
    }
    stopPattern();
    stopRecPlayback();
    const ctx = audio();
    await ctx.resume();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Voice processing smears percussive sounds, so switch it off.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      setStatus(`Could not open the microphone (${err.name}). Check the browser's permission.`, true);
      return;
    }
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    rec = { stream, src, proc, mute, chunks: [], peaks: [], level: 0, startedAt: ctx.currentTime, length: 0 };
    proc.onaudioprocess = (e) => {
      if (!rec) return;
      const data = e.inputBuffer.getChannelData(0);
      rec.chunks.push(new Float32Array(data));
      rec.length += data.length;
      for (let i = 0; i < data.length; i += 512) {
        let p = 0;
        for (let j = i; j < Math.min(data.length, i + 512); j++) p = Math.max(p, Math.abs(data[j]));
        rec.peaks.push(p);
        rec.level = Math.max(p, rec.level * 0.85);
      }
      if (rec.length / ctx.sampleRate >= MAX_RECORD_SEC) stopRecording();
    };
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);

    $('recordBtn').classList.add('active');
    $('recordBtn').querySelector('.label').textContent = 'Stop';
    $('playRecBtn').disabled = true;
    setStatus('Recording… beatbox now, then press Stop.');
    requestAnimationFrame(recordingLoop);
  }

  function recordingLoop() {
    if (!rec) return;
    const sec = rec.length / ac.sampleRate;
    $('recTime').textContent = fmtTime(sec);
    $('meterFill').style.width = `${Math.min(100, Math.sqrt(rec.level) * 100)}%`;
    drawLiveWave(rec.peaks);
    requestAnimationFrame(recordingLoop);
  }

  function stopRecording() {
    if (!rec) return;
    const r = rec;
    rec = null;
    r.proc.onaudioprocess = null;
    r.src.disconnect();
    r.proc.disconnect();
    r.mute.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    $('recordBtn').classList.remove('active');
    $('recordBtn').querySelector('.label').textContent = 'Record';
    $('meterFill').style.width = '0';

    if (r.length < ac.sampleRate * 0.3) {
      setStatus('Recording was too short — try again.', true);
      drawWave();
      return;
    }
    const buf = ac.createBuffer(1, r.length, ac.sampleRate);
    const out = buf.getChannelData(0);
    let off = 0;
    for (const c of r.chunks) { out.set(c, off); off += c.length; }
    loadBuffer(buf);
  }

  async function loadFile(file) {
    if (!file) return;
    stopPattern();
    stopRecPlayback();
    setStatus(`Decoding ${file.name}…`);
    try {
      const data = await file.arrayBuffer();
      const buf = await audio().decodeAudioData(data);
      loadBuffer(buf);
    } catch (err) {
      setStatus(`Could not decode that file (${err.message || err}).`, true);
    }
  }

  function loadBuffer(buf) {
    state.buffer = buf;
    const n = buf.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    state.samples = mono;
    $('recTime').textContent = fmtTime(buf.duration);
    $('playRecBtn').disabled = false;
    computeWavePeaks();
    analyseRecording();
  }

  /* ---------- Analysis ---------- */

  function analyseRecording() {
    if (!state.samples) return;
    setStatus('Analysing…');
    // Let the status paint before the (synchronous) analysis runs.
    setTimeout(() => {
      const t0 = performance.now();
      const sensitivity = +$('sensitivity').value;
      const hits = A.analyse(state.samples, state.buffer.sampleRate, { sensitivity });
      state.hits = hits.map((h) => ({
        time: h.time,
        label: h.label,
        autoLabel: h.label,
        features: h.features,
        deleted: false,
        manual: false,
      }));
      state.detectedBpm = A.estimateTempo(hits);
      state.bpm = state.detectedBpm || 100;
      state.shift = 0;
      $('bpm').value = state.bpm;
      rebuildGrid();
      const ms = Math.round(performance.now() - t0);
      if (!hits.length) setStatus('No hits found — try beatboxing louder or raise the sensitivity.', true);
      else setStatus(`Found ${hits.length} hits in ${ms} ms.`);
    }, 20);
  }

  /* ---------- Grid model ---------- */

  function rebuildGrid() {
    // Grid phase and bar alignment come from the detected hits and their
    // original labels only, so editing cells never moves the grid.
    const detected = state.hits.filter((h) => !h.manual).map((h) => ({ time: h.time, label: h.autoLabel }));
    const g = A.makeGrid(detected, state.bpm);
    let maxStep = 0;
    for (const h of state.hits) {
      h.rawStep = Math.max(0, g.stepOf(h.time));
      maxStep = Math.max(maxStep, h.rawStep);
    }
    const bars = Math.max(1, Math.ceil((maxStep + 1) / STEPS_PER_BAR));
    const totalSteps = bars * STEPS_PER_BAR;
    const cells = { hihat: new Map(), snare: new Map(), kick: new Map() };
    state.hits.forEach((h, i) => {
      h.step = mod(h.rawStep + state.shift, totalSteps);
      if (h.deleted) return;
      const m = cells[h.label];
      if (!m.has(h.step)) m.set(h.step, []);
      m.get(h.step).push(i);
    });
    state.grid = { stepSec: g.stepSec, origin: g.origin, totalSteps, bars, cells };
    renderGrid();
    drawWave();
    updateSummary();
  }

  function timeOfStep(step) {
    const g = state.grid;
    return g.origin + mod(step - state.shift, g.totalSteps) * g.stepSec;
  }

  function toggleCell(drum, step) {
    const ids = state.grid.cells[drum].get(step);
    if (ids && ids.length) {
      for (const i of ids) state.hits[i].deleted = true;
      state.hits = state.hits.filter((h) => !(h.manual && h.deleted));
    } else {
      // A hit removed from another row in this column is being relabelled.
      const moved = state.hits.find((h) => h.deleted && !h.manual && h.step === step);
      if (moved) {
        moved.deleted = false;
        moved.label = drum;
      } else {
        state.hits.push({ time: timeOfStep(step), label: drum, autoLabel: drum, features: null, deleted: false, manual: true });
      }
    }
    rebuildGrid();
  }

  function resetEdits() {
    state.hits = state.hits.filter((h) => !h.manual);
    for (const h of state.hits) { h.deleted = false; h.label = h.autoLabel; }
    state.shift = 0;
    rebuildGrid();
  }

  function setBpm(v, updateField) {
    if (!Number.isFinite(v)) return;
    v = Math.min(300, Math.max(40, Math.round(v * 10) / 10));
    state.bpm = v;
    if (updateField) $('bpm').value = v;
    rebuildGrid();
  }

  /* ---------- Grid rendering ---------- */

  let columns = [];   // step -> elements to highlight during playback

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function makeRow(cls, labelContent, fillSlot) {
    const row = el('div', `grid-row ${cls}`);
    const label = el('div', 'row-label');
    if (typeof labelContent === 'string') label.textContent = labelContent;
    else if (labelContent) label.append(...labelContent);
    row.append(label);
    for (let b = 0; b < state.grid.bars; b++) {
      const bar = el('div', 'bar');
      for (let beat = 0; beat < 4; beat++) {
        const bd = el('div', 'beat');
        for (let s = 0; s < 4; s++) bd.append(fillSlot(b * STEPS_PER_BAR + beat * 4 + s, b, beat, s));
        bar.append(bd);
      }
      row.append(bar);
    }
    return row;
  }

  function cellTitle(drum, step, ids) {
    const bar = Math.floor(step / 16) + 1;
    const beat = Math.floor((step % 16) / 4) + 1;
    const sub = (step % 4) + 1;
    let t = `${NAMES[drum]} · bar ${bar}, beat ${beat}.${sub}`;
    for (const i of ids || []) {
      const h = state.hits[i];
      if (h.manual) { t += '\n• added by you'; continue; }
      t += `\n• hit at ${h.time.toFixed(2)}s`;
      if (h.label !== h.autoLabel) t += ` (detected as ${NAMES[h.autoLabel]})`;
      const f = h.features;
      if (f) t += `\n  centroid ${Math.round(f.centroid)} Hz · low ${Math.round(f.low * 100)}% · mid ${Math.round(f.mid * 100)}% · high ${Math.round(f.high * 100)}%`;
    }
    return t;
  }

  function renderGrid() {
    const g = state.grid;
    const root = $('grid');
    root.textContent = '';
    columns = Array.from({ length: g.totalSteps }, () => []);

    root.append(makeRow('header', '', (step, b, beat, s) => {
      const d = el('div', 'tick');
      if (beat === 0 && s === 0) d.append(el('span', 'bar-title', `Bar ${b + 1}`));
      return d;
    }));
    root.append(makeRow('header', 'Beat', (step, b, beat, s) => {
      if (s !== 0) return el('div', 'tick');
      return el('div', `beat-num${beat === 0 ? ' one' : ''}`, String(beat + 1));
    }));

    for (const drum of DRUMS) {
      const i = el('i');
      root.append(makeRow(drum, [i, NAMES[drum]], (step) => {
        const ids = g.cells[drum].get(step);
        const on = !!(ids && ids.length);
        const manual = on && ids.every((k) => state.hits[k].manual);
        const c = el('button', `cell${on ? ' on' : ''}${manual ? ' manual' : ''}`);
        c.dataset.drum = drum;
        c.dataset.step = step;
        c.title = cellTitle(drum, step, ids);
        c.setAttribute('aria-label', `${NAMES[drum]} step ${step + 1}${on ? ' on' : ' off'}`);
        columns[step].push(c);
        return c;
      }));
    }

    root.append(makeRow('header', '', (step) => {
      const d = el('div', 'step-dot');
      columns[step].push(d);
      return d;
    }));
  }

  function updateSummary() {
    const live = state.hits.filter((h) => !h.deleted);
    const count = (d) => live.filter((h) => h.label === d).length;
    const edited = state.hits.some((h) => h.manual || h.deleted || h.label !== h.autoLabel) || state.shift !== 0;
    const parts = [];
    if (state.samples) {
      parts.push(`${live.length} hits: ${count('kick')} kick, ${count('snare')} snare, ${count('hihat')} hi-hat`);
      parts.push(`${state.grid.bars} bar${state.grid.bars > 1 ? 's' : ''}`);
      if (state.detectedBpm) parts.push(`detected tempo ${state.detectedBpm} BPM`);
      if (edited) parts.push('edited');
    }
    $('summary').textContent = (parts.length ? parts.join(' · ') + '. ' : '') +
      'Tap a cell to add or remove a hit. To fix a wrong label, tap the wrong cell off and the right one on in the same column.';
  }

  /* ---------- Waveform ---------- */

  let wavePeaks = null; // [min, max] per pixel column

  function canvasSize() {
    const c = $('wave');
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { c, ctx: c.getContext('2d'), w, h, dpr };
  }

  function computeWavePeaks() {
    if (!state.samples) { wavePeaks = null; return; }
    const { w } = canvasSize();
    const d = state.samples;
    const per = d.length / w;
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const g = peak > 0 ? 1 / peak : 1;
    wavePeaks = new Float32Array(w * 2);
    for (let x = 0; x < w; x++) {
      let lo = 0, hi = 0;
      for (let i = Math.floor(x * per); i < Math.min(d.length, Math.floor((x + 1) * per)); i++) {
        if (d[i] < lo) lo = d[i];
        if (d[i] > hi) hi = d[i];
      }
      wavePeaks[x * 2] = lo * g;
      wavePeaks[x * 2 + 1] = hi * g;
    }
  }

  function drawWave(playheadSec) {
    const { ctx, w, h, dpr } = canvasSize();
    ctx.clearRect(0, 0, w, h);
    if (!state.buffer || !wavePeaks || wavePeaks.length !== w * 2) {
      if (state.buffer) computeWavePeaks();
      if (!state.buffer) {
        ctx.fillStyle = '#5b6070';
        ctx.font = `${13 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('Your recording will appear here', w / 2, h / 2 + 4 * dpr);
        return;
      }
    }
    const dur = state.buffer.duration;
    const x = (t) => (t / dur) * w;
    const mid = h / 2;

    // Quantisation grid: beats and bars
    const g = state.grid;
    if (g) {
      const beatSec = g.stepSec * 4;
      const first = Math.ceil(-g.origin / beatSec);
      for (let k = first; g.origin + k * beatSec < dur; k++) {
        const bar = k % 4 === 0;
        ctx.fillStyle = bar ? 'rgba(91,140,255,.45)' : 'rgba(255,255,255,.08)';
        ctx.fillRect(Math.round(x(g.origin + k * beatSec)), 0, bar ? 1.5 * dpr : dpr, h);
      }
    }

    ctx.fillStyle = '#6b7183';
    for (let px = 0; px < w; px++) {
      const lo = wavePeaks[px * 2], hi = wavePeaks[px * 2 + 1];
      ctx.fillRect(px, mid - hi * mid * 0.9, 1, Math.max(1, (hi - lo) * mid * 0.9));
    }

    for (const hit of state.hits) {
      if (hit.manual) continue;
      const hx = Math.round(x(hit.time));
      ctx.globalAlpha = hit.deleted ? 0.25 : 1;
      ctx.fillStyle = hit.deleted ? '#888' : COLORS[hit.label];
      ctx.fillRect(hx, 0, 1.5 * dpr, h);
      ctx.beginPath();
      ctx.arc(hx + 0.75 * dpr, 7 * dpr, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (playheadSec != null) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(x(playheadSec)), 0, 2 * dpr, h);
    }
  }

  function drawLiveWave(peaks) {
    const { ctx, w, h } = canvasSize();
    ctx.clearRect(0, 0, w, h);
    const span = Math.max(10 * ac.sampleRate / 512, peaks.length);
    ctx.fillStyle = '#ff4d5e';
    const mid = h / 2;
    for (let px = 0; px < w; px++) {
      const i0 = Math.floor((px / w) * span), i1 = Math.floor(((px + 1) / w) * span);
      let p = 0;
      for (let i = i0; i < Math.min(peaks.length, Math.max(i1, i0 + 1)); i++) p = Math.max(p, peaks[i]);
      if (i0 >= peaks.length) break;
      const v = Math.min(1, p * 1.2) * mid * 0.9;
      ctx.fillRect(px, mid - v, 1, Math.max(1, v * 2));
    }
  }

  /* ---------- Recording playback ---------- */

  let recPlay = null;

  function playRecording(offset) {
    if (!state.buffer) return;
    stopRecPlayback();
    const ctx = audio();
    ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = state.buffer;
    src.connect(ctx.destination);
    const startOff = Math.min(Math.max(0, offset || 0), state.buffer.duration - 0.01);
    src.start(0, startOff);
    recPlay = { src, t0: ctx.currentTime - startOff };
    src.onended = () => { if (recPlay && recPlay.src === src) stopRecPlayback(); };
    $('playRecBtn').textContent = '■ Stop playback';
    requestAnimationFrame(recPlayLoop);
  }

  function recPlayLoop() {
    if (!recPlay) return;
    drawWave(ac.currentTime - recPlay.t0);
    requestAnimationFrame(recPlayLoop);
  }

  function stopRecPlayback() {
    if (!recPlay) return;
    const { src } = recPlay;
    recPlay = null;
    try { src.stop(); } catch (e) { /* already stopped */ }
    $('playRecBtn').textContent = '▶ Play recording';
    drawWave();
  }

  /* ---------- Pattern playback ---------- */

  const player = { playing: false, timer: null, step: 0, nextTime: 0, queue: [], current: -1, rec: null };

  function startPattern() {
    stopRecPlayback();
    const ctx = audio();
    ctx.resume();
    player.playing = true;
    player.step = 0;
    player.nextTime = ctx.currentTime + 0.08;
    player.queue = [];
    if ($('withRec').checked && state.buffer) {
      // Line the recording up so step 1 of bar 1 plays with its matching audio.
      const src = ctx.createBufferSource();
      src.buffer = state.buffer;
      src.connect(ctx.destination);
      const offset = state.grid.origin - state.shift * state.grid.stepSec;
      if (offset >= 0) src.start(player.nextTime, offset);
      else src.start(player.nextTime - offset);
      player.rec = src;
    }
    schedule();
    player.timer = setInterval(schedule, 25);
    $('playPatBtn').textContent = '■ Stop';
    requestAnimationFrame(patternLoop);
  }

  function schedule() {
    const g = state.grid;
    while (player.nextTime < ac.currentTime + 0.12) {
      const st = player.step % g.totalSteps;
      for (const d of DRUMS) if (g.cells[d].has(st)) synth[d](player.nextTime);
      player.queue.push({ step: st, time: player.nextTime });
      player.nextTime += g.stepSec;
      player.step = (st + 1) % g.totalSteps;
    }
  }

  function patternLoop() {
    if (!player.playing) return;
    const now = ac.currentTime;
    let cur = null;
    while (player.queue.length && player.queue[0].time <= now) cur = player.queue.shift();
    if (cur && cur.step !== player.current) highlight(cur.step);
    requestAnimationFrame(patternLoop);
  }

  function highlight(step) {
    if (columns[player.current]) for (const e of columns[player.current]) e.classList.remove('now');
    player.current = step;
    if (columns[step]) {
      for (const e of columns[step]) e.classList.add('now');
      const wrap = $('gridWrap');
      const c = columns[step][0];
      const left = c.offsetLeft, right = left + c.offsetWidth;
      if (left < wrap.scrollLeft + 90 || right > wrap.scrollLeft + wrap.clientWidth) {
        wrap.scrollLeft = Math.max(0, left - 100);
      }
    }
  }

  function stopPattern() {
    if (!player.playing) return;
    player.playing = false;
    clearInterval(player.timer);
    if (player.rec) { try { player.rec.stop(); } catch (e) { /* ignore */ } player.rec = null; }
    if (columns[player.current]) for (const e of columns[player.current]) e.classList.remove('now');
    player.current = -1;
    $('playPatBtn').textContent = '▶ Play pattern';
  }

  /* ---------- Wiring ---------- */

  $('recordBtn').addEventListener('click', () => (rec ? stopRecording() : startRecording()));
  $('playRecBtn').addEventListener('click', () => (recPlay ? stopRecPlayback() : playRecording(0)));
  $('fileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('wave').addEventListener('click', (e) => {
    if (!state.buffer || rec) return;
    const r = e.currentTarget.getBoundingClientRect();
    stopPattern();
    playRecording(((e.clientX - r.left) / r.width) * state.buffer.duration);
  });

  let sensTimer = null;
  $('sensitivity').addEventListener('input', (e) => {
    $('sensitivityVal').textContent = e.target.value;
    clearTimeout(sensTimer);
    sensTimer = setTimeout(analyseRecording, 250);
  });

  $('playPatBtn').addEventListener('click', () => (player.playing ? stopPattern() : startPattern()));

  let bpmTimer = null;
  $('bpm').addEventListener('input', (e) => {
    clearTimeout(bpmTimer);
    const v = parseFloat(e.target.value);
    if (v >= 40 && v <= 300) bpmTimer = setTimeout(() => setBpm(v, false), 200);
  });
  $('bpm').addEventListener('change', (e) => {
    clearTimeout(bpmTimer);
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) setBpm(v, true);
    else e.target.value = state.bpm;
  });
  $('halfBtn').addEventListener('click', () => setBpm(state.bpm / 2, true));
  $('doubleBtn').addEventListener('click', () => setBpm(state.bpm * 2, true));
  $('autoBpmBtn').addEventListener('click', () => setBpm(state.detectedBpm || 100, true));
  $('shiftLeft').addEventListener('click', () => { state.shift--; rebuildGrid(); });
  $('shiftRight').addEventListener('click', () => { state.shift++; rebuildGrid(); });
  $('resetBtn').addEventListener('click', resetEdits);

  $('grid').addEventListener('click', (e) => {
    const c = e.target.closest('.cell');
    if (c) toggleCell(c.dataset.drum, +c.dataset.step);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      player.playing ? stopPattern() : startPattern();
    } else if (e.key === 'r' || e.key === 'R') {
      rec ? stopRecording() : startRecording();
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { computeWavePeaks(); drawWave(); }, 100);
  });

  // Start with an empty one-bar grid so it can be used as a plain step sequencer too.
  $('playPatBtn').disabled = false;
  rebuildGrid();

  // Exposed for debugging / automated tests.
  window.beatbox = { state, loadBuffer, toggleCell, setBpm };
})();
