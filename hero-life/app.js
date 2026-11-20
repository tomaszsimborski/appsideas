// Licznik zdrowia w stylu Hero Realms.
// Każdy gracz ma połowę ekranu: miecz (obrażenia) i serce (leczenie).
// Zmiany zbierają się przez chwilę jako „−7”, a potem trafiają do historii,
// jak w aplikacji Authority. Przy 0 zdrowia pokazuje się zwycięzca i przegrany.
(() => {
  'use strict';

  const COLORS = [
    { id: 'guild', name: 'Gildia', hex: '#2f6db3' },
    { id: 'necros', name: 'Nekros', hex: '#a0263a' },
    { id: 'imperial', name: 'Imperium', hex: '#c99a2e' },
    { id: 'wild', name: 'Dzicz', hex: '#3b7d38' },
    { id: 'arcane', name: 'Magia', hex: '#6d3fa3' },
    { id: 'steel', name: 'Stal', hex: '#5a6875' },
  ];
  const DEFAULTS = {
    startHp: 50,
    layout: 'facing',
    players: [
      { name: 'Tomek', color: 'guild', seat: 'left' },
      { name: 'Berenika', color: 'necros', seat: 'right' },
    ],
    turns: [0, 0],   // dodatkowy obrót licznika każdego gracza, w ćwierćobrotach
  };
  const SETTINGS_KEY = 'heroLife.settings.v1';
  const GAME_KEY = 'heroLife.game.v1';
  const COMMIT_MS = 1400;     // po tylu ms bez dotyku zmiana trafia do historii
  const HOLD_DELAY = 420;     // przytrzymanie: start powtarzania
  const HOLD_EVERY = 110;     // przytrzymanie: co ile ms kolejny punkt

  const $ = (sel, root = document) => root.querySelector(sel);
  const colorOf = (id) => (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
  const fmt = (n) => (n < 0 ? '−' + Math.abs(n) : String(n));
  const signed = (n) => (n > 0 ? '+' + n : '−' + Math.abs(n));

  // localStorage bywa niedostępny (tryb prywatny, podgląd) — wtedy działamy bez zapisu.
  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* bez zapisu */ }
    },
  };

  function clampHp(n) {
    n = Math.round(Number(n));
    if (!Number.isFinite(n) || n < 1) return DEFAULTS.startHp;
    return Math.min(999, n);
  }

  function loadSettings() {
    const s = store.get(SETTINGS_KEY);
    const out = JSON.parse(JSON.stringify(DEFAULTS));
    if (!s || typeof s !== 'object') return out;
    if (s.startHp != null) out.startHp = clampHp(s.startHp);
    if (s.layout === 'facing' || s.layout === 'side') out.layout = s.layout;
    if (Array.isArray(s.players)) {
      s.players.slice(0, 2).forEach((p, i) => {
        if (!p || typeof p !== 'object') return;
        if (typeof p.name === 'string' && p.name.trim()) out.players[i].name = p.name.trim().slice(0, 20);
        if (COLORS.some((c) => c.id === p.color)) out.players[i].color = p.color;
        if (p.seat === 'left' || p.seat === 'right') out.players[i].seat = p.seat;
      });
    }
    if (Array.isArray(s.turns)) {
      s.turns.slice(0, 2).forEach((t, i) => { if (Number.isInteger(t)) out.turns[i] = ((t % 4) + 4) % 4; });
    }
    if (out.players[0].seat === out.players[1].seat) {
      out.players[1].seat = out.players[0].seat === 'left' ? 'right' : 'left';
    }
    return out;
  }

  function newGame(startHp) {
    return { startHp, hp: [startHp, startHp], history: [], finished: null };
  }

  function loadGame() {
    const g = store.get(GAME_KEY);
    if (!g || !Array.isArray(g.hp) || g.hp.length !== 2 || !g.hp.every(Number.isFinite)) return null;
    return {
      startHp: clampHp(g.startHp),
      hp: g.hp.slice(),
      history: Array.isArray(g.history) ? g.history.filter((h) => h && (h.p === 0 || h.p === 1) && Number.isFinite(h.d)) : [],
      finished: g.finished && typeof g.finished === 'object' ? g.finished : null,
    };
  }

  let settings = loadSettings();
  let game = loadGame();
  const pending = [0, 0];
  const timers = [null, null];

  // ---------- Połówki ekranu ----------

  const gameEl = $('#game');
  const halves = [...document.querySelectorAll('.half')];
  const tpl = $('#halfTpl');
  const parts = halves.map((half, slot) => {
    half.append(tpl.content.cloneNode(true));
    const p = {
      half,
      name: $('.name', half),
      value: $('.value', half),
      delta: $('.delta', half),
      log: $('.log', half),
      result: $('.result', half),
      title: $('.result-title', half),
      sub: $('.result-sub', half),
    };
    bindHold($('.act.dmg', half), () => change(playerAt(slot), -1));
    bindHold($('.act.heal', half), () => change(playerAt(slot), +1));
    $('.rematch', half).addEventListener('click', rematch);
    $('.turn', half).addEventListener('click', () => turn(playerAt(slot)));
    return p;
  });

  // slot 0 = lewe miejsce (w pionie: góra), slot 1 = prawe (w pionie: dół)
  const slotOf = (i) => (settings.players[i].seat === 'left' ? 0 : 1);
  const playerAt = (slot) => (slotOf(0) === slot ? 0 : 1);

  function bindHold(btn, fn) {
    let delay = null;
    let repeat = null;
    let pointer = null;
    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
      delay = repeat = pointer = null;
      btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      if (pointer !== null) return;
      pointer = e.pointerId;
      try { btn.setPointerCapture(e.pointerId); } catch { /* starsze przeglądarki */ }
      btn.classList.add('pressed');
      fn();
      delay = setTimeout(() => { repeat = setInterval(fn, HOLD_EVERY); }, HOLD_DELAY);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      btn.addEventListener(ev, (e) => { if (e.pointerId === pointer) stop(); });
    }
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // Klawiatura / czytniki ekranu
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  }

  function change(i, d) {
    if (!game || game.finished) return;
    pending[i] += d;
    clearTimeout(timers[i]);
    timers[i] = setTimeout(() => commit(i), COMMIT_MS);
    render();
    const v = parts[slotOf(i)].value;
    if (v.animate) v.animate([{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 140 });
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function commit(i) {
    clearTimeout(timers[i]);
    timers[i] = null;
    if (!pending[i]) return;
    game.hp[i] += pending[i];
    game.history.push({ p: i, d: pending[i] });
    pending[i] = 0;
    checkEnd();
    save();
    render();
  }

  function flushAll() {
    for (const i of [0, 1]) if (pending[i]) commit(i);
  }

  function checkEnd() {
    // Zanim ogłosimy wynik, dolicz to, co drugi gracz jeszcze „wklikuje”.
    for (const i of [0, 1]) {
      if (pending[i]) {
        clearTimeout(timers[i]);
        timers[i] = null;
        game.hp[i] += pending[i];
        game.history.push({ p: i, d: pending[i] });
        pending[i] = 0;
      }
    }
    const dead = [0, 1].filter((i) => game.hp[i] <= 0);
    if (!dead.length) { game.finished = null; return; }
    const wasOver = !!game.finished;
    game.finished = dead.length === 2 ? { draw: true } : { loser: dead[0], winner: 1 - dead[0] };
    if (!wasOver && navigator.vibrate) navigator.vibrate([60, 60, 180]);
  }

  function undo() {
    if (!game) return;
    if (pending[0] || pending[1]) {
      for (const i of [0, 1]) { clearTimeout(timers[i]); timers[i] = null; pending[i] = 0; }
    } else {
      const last = game.history.pop();
      if (!last) return;
      game.hp[last.p] -= last.d;
      checkEnd();
    }
    save();
    render();
  }

  function rematch() {
    for (const i of [0, 1]) { clearTimeout(timers[i]); timers[i] = null; pending[i] = 0; }
    game = newGame(settings.startHp);
    save();
    render();
  }

  // ---------- Obrót liczników ----------

  const landscape = matchMedia('(orientation: landscape)');

  // Obrót wynikający z ułożenia: naprzeciw siebie liczby patrzą w stronę gracza.
  function baseTurns(slot) {
    if (settings.layout !== 'facing') return 0;
    if (landscape.matches) return slot === 0 ? 1 : 3;   // lewy: 90°, prawy: 270°
    return slot === 0 ? 2 : 0;                          // pion: górny do góry nogami
  }

  // Kąt trzymamy narastająco, żeby animacja zawsze kręciła w prawo.
  const angle = [null, null];

  function applyTurns(animate) {
    for (const slot of [0, 1]) {
      const i = playerAt(slot);
      const q = (baseTurns(slot) + settings.turns[i]) % 4;
      const half = parts[slot].half;
      const inner = $('.inner', half);
      let deg = q * 90;
      if (animate && angle[slot] !== null) {
        const prev = angle[slot];
        deg = prev + ((deg - prev) % 360 + 360) % 360;
      }
      angle[slot] = deg;
      inner.classList.toggle('anim', !!animate);
      inner.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
      half.classList.toggle('sideways', q % 2 === 1);
      half.dataset.turn = q;
    }
  }

  function turn(i) {
    settings.turns[i] = (settings.turns[i] + 1) % 4;
    store.set(SETTINGS_KEY, settings);
    applyTurns(true);
  }

  landscape.addEventListener('change', () => applyTurns(false));

  function save() {
    store.set(GAME_KEY, game);
  }

  function render() {
    gameEl.classList.toggle('facing', settings.layout === 'facing');
    for (const slot of [0, 1]) {
      const i = playerAt(slot);
      const p = settings.players[i];
      const part = parts[slot];
      part.half.style.setProperty('--pc', colorOf(p.color));
      part.name.textContent = p.name;

      const shown = game.hp[i] + pending[i];
      part.value.textContent = fmt(shown);
      part.value.classList.toggle('low', shown <= 10);
      part.value.classList.toggle('wide', fmt(shown).length > 2);

      const pd = pending[i];
      part.delta.textContent = pd ? signed(pd) : '';
      part.delta.classList.toggle('show', !!pd);
      part.delta.classList.toggle('neg', pd < 0);
      part.delta.classList.toggle('pos', pd > 0);

      // Ostatnie zmiany tego gracza, najnowsza z lewej
      part.log.replaceChildren();
      const mine = game.history.filter((h) => h.p === i).slice(-5).reverse();
      mine.forEach((h, k) => {
        if (k) part.log.append(' · ');
        const s = document.createElement('span');
        s.className = h.d < 0 ? 'n' : 'p';
        s.textContent = signed(h.d);
        part.log.append(s);
      });

      const f = game.finished;
      part.result.hidden = !f;
      part.result.classList.remove('win', 'lose', 'draw');
      if (f) {
        if (f.draw) {
          part.result.classList.add('draw');
          part.title.textContent = 'Remis';
          part.sub.textContent = 'Oboje padliście jednocześnie';
        } else if (f.winner === i) {
          part.result.classList.add('win');
          part.title.textContent = 'Zwycięstwo';
          part.sub.textContent = `${p.name} wygrywa!`;
        } else {
          part.result.classList.add('lose');
          part.title.textContent = 'Porażka';
          part.sub.textContent = `${p.name} przegrywa`;
        }
      }
    }
    $('#undoBtn').disabled = !(pending[0] || pending[1] || game.history.length);
  }

  // ---------- Pasek sterowania ----------

  $('#undoBtn').addEventListener('click', undo);
  $('#setupBtn').addEventListener('click', () => { flushAll(); openSetup(); });

  const resetBtn = $('#resetBtn');
  let armTimer = null;
  resetBtn.addEventListener('click', () => {
    // Dwa dotknięcia, żeby nie wyzerować gry przypadkiem.
    if (resetBtn.classList.contains('armed')) {
      clearTimeout(armTimer);
      resetBtn.classList.remove('armed');
      rematch();
      return;
    }
    resetBtn.classList.add('armed');
    armTimer = setTimeout(() => resetBtn.classList.remove('armed'), 2200);
  });

  // ---------- Ekran nie gaśnie w trakcie gry ----------

  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch { /* brak zgody / brak wsparcia */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !gameEl.hidden) keepAwake();
    if (document.visibilityState === 'hidden') flushAll();
  });

  // ---------- Ustawienia ----------

  const setupEl = $('#setup');
  const hpInput = $('#startHp');
  const cardsEl = $('#playerCards');
  let draft = null;

  function openSetup() {
    draft = JSON.parse(JSON.stringify(settings));
    hpInput.value = draft.startHp;
    renderDraft();
    $('#cancelBtn').hidden = !(game && !game.finished);
    gameEl.hidden = true;
    setupEl.hidden = false;
    setupEl.scrollTop = 0;
  }

  function closeSetup() {
    setupEl.hidden = true;
    gameEl.hidden = false;
    render();
    applyTurns(false);
    keepAwake();
  }

  function renderDraft() {
    for (const b of document.querySelectorAll('#hpChips button')) {
      b.classList.toggle('on', Number(b.dataset.hp) === clampHp(hpInput.value));
    }
    for (const b of document.querySelectorAll('#layoutSeg button')) {
      const on = b.dataset.layout === draft.layout;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    }
    cardsEl.replaceChildren(...draft.players.map(playerCard));
  }

  function playerCard(p, i) {
    const card = document.createElement('section');
    card.className = 'card player-card';
    card.style.setProperty('--pc', colorOf(p.color));

    const h = document.createElement('h2');
    h.textContent = `Gracz ${i + 1}`;

    const nameField = document.createElement('label');
    nameField.className = 'field';
    const nameLab = document.createElement('span');
    nameLab.textContent = 'Imię';
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 20;
    name.value = p.name;
    name.autocomplete = 'off';
    name.addEventListener('input', () => { draft.players[i].name = name.value; });
    nameField.append(nameLab, name);

    const seatField = document.createElement('div');
    seatField.className = 'field';
    const seatLab = document.createElement('span');
    seatLab.textContent = 'Miejsce';
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'radiogroup');
    for (const [seat, label] of [['left', '← Lewo'], ['right', 'Prawo →']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', p.seat === seat);
      b.classList.toggle('on', p.seat === seat);
      b.addEventListener('click', () => {
        draft.players[i].seat = seat;
        draft.players[1 - i].seat = seat === 'left' ? 'right' : 'left';
        renderDraft();
      });
      seg.append(b);
    }
    seatField.append(seatLab, seg);

    const colorField = document.createElement('div');
    colorField.className = 'field';
    const colorLab = document.createElement('span');
    colorLab.textContent = 'Kolor';
    const sw = document.createElement('div');
    sw.className = 'swatches';
    sw.setAttribute('role', 'radiogroup');
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c.id === p.color ? ' on' : '');
      b.style.setProperty('--c', c.hex);
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', c.id === p.color);
      b.addEventListener('click', () => { draft.players[i].color = c.id; renderDraft(); });
      sw.append(b);
    }
    const swName = document.createElement('div');
    swName.className = 'swatch-name';
    swName.textContent = (COLORS.find((c) => c.id === p.color) || COLORS[0]).name;
    colorField.append(colorLab, sw, swName);

    card.append(h, nameField, seatField, colorField);
    return card;
  }

  hpInput.addEventListener('input', renderDraft);
  hpInput.addEventListener('blur', () => { hpInput.value = clampHp(hpInput.value); renderDraft(); });
  for (const b of document.querySelectorAll('.step')) {
    b.addEventListener('click', () => {
      hpInput.value = Math.max(1, Math.min(999, clampHp(hpInput.value) + Number(b.dataset.step)));
      renderDraft();
    });
  }
  for (const b of document.querySelectorAll('#hpChips button')) {
    b.addEventListener('click', () => { hpInput.value = b.dataset.hp; renderDraft(); });
  }
  for (const b of document.querySelectorAll('#layoutSeg button')) {
    b.addEventListener('click', () => {
      // Nowe ułożenie = liczniki znów patrzą prosto na graczy.
      if (draft.layout !== b.dataset.layout) draft.turns = [0, 0];
      draft.layout = b.dataset.layout;
      renderDraft();
    });
  }

  $('#cancelBtn').addEventListener('click', closeSetup);

  $('#startBtn').addEventListener('click', () => {
    draft.startHp = clampHp(hpInput.value);
    draft.players.forEach((p, i) => {
      p.name = (p.name || '').trim().slice(0, 20) || DEFAULTS.players[i].name;
    });
    settings = draft;
    store.set(SETTINGS_KEY, settings);
    for (const i of [0, 1]) { clearTimeout(timers[i]); timers[i] = null; pending[i] = 0; }
    game = newGame(settings.startHp);
    save();
    closeSetup();
    // Na telefonie wejdź w pełny ekran, żeby nic nie zasłaniało liczników.
    try {
      if (matchMedia('(pointer: coarse)').matches && document.fullscreenEnabled && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch { /* bez pełnego ekranu */ }
  });

  // ---------- Start ----------

  if (game) {
    setupEl.hidden = true;
    gameEl.hidden = false;
    render();
    applyTurns(false);
    keepAwake();
  } else {
    openSetup();
  }
})();
