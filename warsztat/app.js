/*
 * Warsztat utworów — centrum dowodzenia dla zespołu: utwory ze statusami,
 * tempo, tekst / akordy / notatki i nagrania w czterech folderach.
 */
(() => {
  'use strict';

  const L = window.WarsztatLib;
  const Store = window.Store;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const icon = (name) => '<svg aria-hidden="true"><use href="#' + name + '"/></svg>';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const dot = '<span class="dot"></span>';

  const state = {
    songs: [],
    items: [],
    filter: 'all',
    query: '',
    layer: 'lyrics',       // ostatnio wybrana warstwa tekstowa
    route: { name: 'utwory' },
  };

  const view = $('#view');

  /* ======================= Dane ======================= */

  const songById = (id) => state.songs.find((s) => s.id === id) || null;
  const itemById = (id) => state.items.find((i) => i.id === id) || null;
  const itemsOfSong = (id) => state.items.filter((i) => i.songId === id);
  const itemsInFolder = (key) => state.items.filter((i) => i.folder === key)
    .sort((a, b) => b.createdAt - a.createdAt);

  async function load() {
    const [songs, items] = await Promise.all([Store.all('songs'), Store.all('items')]);
    state.songs = songs || [];
    state.items = items || [];
    try { state.layer = localStorage.getItem('warsztat.layer') || 'lyrics'; } catch (e) { /* brak */ }
  }

  async function createSong(data = {}) {
    const now = Date.now();
    const song = {
      id: uid(),
      title: data.title || '',
      status: data.status || 'motyw',
      bpm: L.clampBpm(data.bpm || 120),
      lyrics: data.lyrics || '',
      chords: data.chords || '',
      notes: data.notes || '',
      createdAt: now,
      updatedAt: now,
    };
    state.songs.push(song);
    await Store.put('songs', song);
    return song;
  }

  const saveTimers = new Map();
  function updateSong(id, patch, { delay = 0 } = {}) {
    const song = songById(id);
    if (!song) return;
    Object.assign(song, patch, { updatedAt: Date.now() });
    clearTimeout(saveTimers.get(id));
    const run = () => {
      saveTimers.delete(id);
      Store.put('songs', song).then(() => flashSaved()).catch(() => toast('Nie udało się zapisać'));
    };
    if (delay) saveTimers.set(id, setTimeout(run, delay));
    else run();
  }

  async function deleteSong(id) {
    state.songs = state.songs.filter((s) => s.id !== id);
    await Store.del('songs', id);
    // Nagrania zostają w folderach, tylko bez przypisania do utworu.
    for (const it of itemsOfSong(id)) updateItem(it.id, { songId: null });
  }

  async function addItem(data) {
    const item = {
      id: uid(),
      folder: data.folder || 'proby',
      songId: data.songId || null,
      title: data.title || L.defaultRecordingTitle(),
      type: data.type || 'audio',
      mime: data.blob ? data.blob.type : '',
      size: data.blob ? data.blob.size : 0,
      duration: data.duration || 0,
      peaks: null,
      spotify: data.spotify || null,
      createdAt: Date.now(),
    };
    if (data.blob) await Store.putBlob(item.id, data.blob);
    state.items.push(item);
    await Store.put('items', item);
    if (item.songId) updateSong(item.songId, {});
    if (data.blob) analyseItem(item, data.blob);
    return item;
  }

  function updateItem(id, patch) {
    const item = itemById(id);
    if (!item) return;
    Object.assign(item, patch);
    return Store.put('items', item);
  }

  async function deleteItem(id) {
    if (player.item && player.item.id === id) player.stop();
    state.items = state.items.filter((i) => i.id !== id);
    await Store.del('items', id);
    await Store.delBlob(id).catch(() => {});
  }

  /** Długość i miniatura fali liczone w tle po dodaniu pliku. */
  async function analyseItem(item, blob) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      ctx.close && ctx.close();
      await updateItem(item.id, { duration: buf.duration, peaks: L.peaks(buf.getChannelData(0), 160) });
      if (player.item && player.item.id === item.id) player.drawWave();
      refreshItemsInView();
    } catch (e) {
      // Niektórych formatów (np. części wideo) nie da się zdekodować — trudno.
    }
  }

  /* ======================= Routing ======================= */

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const name = parts[0] || 'utwory';
    if (name === 'utwor' && parts[1]) return { name: 'utwor', id: decodeURIComponent(parts[1]) };
    if (name === 'folder' && parts[1]) return { name: 'folder', key: parts[1] };
    if (name === 'foldery') return { name: 'foldery' };
    return { name: 'utwory' };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render({ keepScroll = false } = {}) {
    const y = window.scrollY;
    const prev = state.route;
    state.route = parseRoute();
    if (prev.name === 'utwor' && (state.route.name !== 'utwor' || state.route.id !== prev.id)) metro.stop();

    const r = state.route;
    if (r.name === 'utwor' && songById(r.id)) renderSong(songById(r.id));
    else if (r.name === 'folder' && L.FOLDERS.some((f) => f.key === r.key)) renderFolder(r.key);
    else if (r.name === 'foldery') renderFolders();
    else renderSongs();

    $$('.tabbar .tab[data-tab]').forEach((t) => {
      const tab = t.dataset.tab;
      const on = tab === 'utwory' ? ['utwory', 'utwor'].includes(r.name) : ['foldery', 'folder'].includes(r.name);
      t.classList.toggle('on', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    window.scrollTo(0, keepScroll ? y : 0);
    onScroll();
  }

  /* ======================= Widok: utwory ======================= */

  function renderSongs() {
    const counts = Object.fromEntries(L.STATUSES.map((s) => [s.key, 0]));
    for (const s of state.songs) counts[s.status] = (counts[s.status] || 0) + 1;

    const chips = [{ key: 'all', label: 'Wszystkie', n: state.songs.length }]
      .concat(L.STATUSES.map((s) => ({ key: s.key, label: s.label, n: counts[s.key] })))
      .map((c) => '<button type="button" class="chip" data-filter="' + c.key + '" aria-pressed="' +
        (state.filter === c.key) + '">' + esc(c.label) + ' <span class="n">' + c.n + '</span></button>')
      .join('');

    view.innerHTML =
      '<a class="backlink" href="../index.html">← Tomkowe pomysły</a>' +
      '<div class="page-head"><div><p class="eyebrow">Warsztat</p><h1>Utwory</h1></div>' +
      '<button type="button" class="btn primary small" data-act="new-song">' + icon('i-plus') + 'Nowy utwór</button></div>' +
      (state.songs.length
        ? '<label class="search">' + icon('i-search') +
          '<input id="q" type="search" placeholder="Szukaj w tytułach, tekstach i notatkach" value="' + esc(state.query) + '" autocomplete="off"></label>' +
          '<div class="chips" role="group" aria-label="Filtruj po statusie">' + chips + '</div>' +
          '<ul class="songs" id="songList"></ul>'
        : emptySongs());

    if (state.songs.length) {
      renderSongList();
      const sel = $('.chip[aria-pressed="true"]', view);
      const row = $('.chips', view);
      if (sel && row && sel.offsetLeft + sel.offsetWidth > row.clientWidth) row.scrollLeft = sel.offsetLeft - 16;
    }
  }

  function emptySongs() {
    return '<div class="empty">' + icon('i-list').replace('<svg', '<svg class="big"') +
      '<strong>Tu zamieszkają Wasze utwory</strong>' +
      '<p>Każdy utwór ma status, tempo, tekst, akordy, notatki i wszystkie nagrania w jednym miejscu.</p>' +
      '<button type="button" class="btn primary" data-act="new-song">' + icon('i-plus') + 'Dodaj pierwszy utwór</button>' +
      '<p style="margin:14px 0 0"><button type="button" class="link-btn" data-act="demo">albo wczytaj przykład</button></p></div>';
  }

  function renderSongList() {
    const list = $('#songList');
    if (!list) return;
    const songs = L.filterSongs(state.songs, { status: state.filter, query: state.query });
    if (!songs.length) {
      list.innerHTML = '<li class="empty compact"><p>' +
        (state.query ? 'Nic nie pasuje do „' + esc(state.query) + '”.' : 'Brak utworów z tym statusem.') + '</p></li>';
      return;
    }
    list.innerHTML = songs.map(songRow).join('');
  }

  function songRow(s) {
    const idx = L.statusIndex(s.status);
    const n = itemsOfSong(s.id).length;
    const steps = L.STATUSES.map((_, i) => '<i class="' + (i <= idx ? 'on' : '') + '"></i>').join('');
    const initial = (s.title || '?').trim().charAt(0).toUpperCase() || '?';
    return '<li class="song-row">' +
      '<a href="#/utwor/' + encodeURIComponent(s.id) + '" style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">' +
      '<span class="song-art" aria-hidden="true"><span class="initial">' + esc(initial) + '</span><span class="steps">' + steps + '</span></span>' +
      '<span class="song-main"><span class="song-title">' + esc(s.title || 'Bez tytułu') + '</span>' +
      '<span class="song-meta"><span class="bpm">' + s.bpm + ' BPM</span>' + dot +
      '<span>' + (n ? L.countLabel(n, 'nagranie', 'nagrania', 'nagrań') : 'bez nagrań') + '</span>' + dot +
      '<span>' + L.relativeDate(s.updatedAt) + '</span></span></span></a>' +
      statusPill(s) + '</li>';
  }

  function statusPill(s) {
    const done = L.statusIndex(s.status) >= 4;
    return '<button type="button" class="status-pill' + (done ? ' done' : '') + '" data-act="status" data-id="' +
      esc(s.id) + '" aria-label="Status: ' + esc(L.statusLabel(s.status)) + '. Zmień">' +
      esc(L.statusLabel(s.status)) + icon('i-chevron-down') + '</button>';
  }

  /* ======================= Widok: utwór ======================= */

  function renderSong(s) {
    const idx = L.statusIndex(s.status);
    const bars = L.STATUSES.map((st, i) =>
      '<button type="button" data-set-status="' + st.key + '" class="' + (i <= idx ? 'on' : '') + (i === idx ? ' current' : '') +
      '" aria-label="' + esc(st.label) + '" aria-pressed="' + (i === idx) + '"></button>').join('');
    const labels = L.STATUSES.map((st, i) =>
      '<button type="button" tabindex="-1" data-set-status="' + st.key + '" class="' + (i === idx ? 'current' : '') + '">' +
      esc(st.label) + '</button>').join('');

    view.innerHTML =
      '<div class="topbar"><a class="back-btn" href="#/utwory">' + icon('i-chevron-left') + 'Utwory</a>' +
      '<div class="grow topbar-title" id="topTitle">' + esc(s.title || 'Bez tytułu') + '</div>' +
      '<button type="button" class="icon-btn subtle" data-act="song-menu" aria-label="Więcej">' + icon('i-more') + '</button></div>' +

      '<input class="title-input" id="songTitle" value="' + esc(s.title) + '" placeholder="Tytuł utworu" aria-label="Tytuł utworu" autocomplete="off">' +

      '<div class="stepper" role="group" aria-label="Status utworu">' +
      '<div class="stepper-bars">' + bars + '</div><div class="stepper-labels">' + labels + '</div></div>' +

      '<section class="section"><div class="section-head"><h2>Docelowe tempo</h2></div>' +
      '<div class="card"><div class="tempo">' +
      '<button type="button" class="icon-btn filled" data-bpm-step="-1" aria-label="Wolniej">' + icon('i-minus') + '</button>' +
      '<div class="tempo-value"><input id="bpm" type="number" inputmode="numeric" min="' + L.MIN_BPM + '" max="' + L.MAX_BPM +
      '" value="' + s.bpm + '" aria-label="Tempo w BPM"><small>BPM</small></div>' +
      '<button type="button" class="icon-btn filled" data-bpm-step="1" aria-label="Szybciej">' + icon('i-plus') + '</button></div>' +
      '<div class="tempo-row2">' +
      '<button type="button" class="btn small" id="tapBtn">' + icon('i-tap') + 'Wystukaj</button>' +
      '<button type="button" class="btn small" id="metroBtn" aria-pressed="' + metro.running + '"><span class="beat" id="beat"></span>Metronom</button>' +
      '</div></div></section>' +

      '<section class="section"><div class="label-row"><h2>Warstwy</h2><span class="saved" id="saved"></span></div>' +
      layersHtml(s) + '</section>' +

      '<section class="section"><div class="section-head"><h2>Nagrania i materiały</h2>' +
      '<button type="button" class="link-btn" data-act="add-to-song">+ Dodaj</button></div>' +
      '<div id="songItems"></div></section>';

    renderSongItems(s);
    autosize($('#layerText', view));
  }

  function layersHtml(s, { inPlayer = false } = {}) {
    const layer = state.layer;
    const tabs = L.LAYERS.map((l) =>
      '<button type="button" role="tab" data-layer="' + l.key + '" aria-selected="' + (l.key === layer) + '">' +
      esc(l.label) + (s[l.key] && s[l.key].trim() && l.key !== layer ? '<span class="has" aria-hidden="true"></span>' : '') +
      '</button>').join('');
    const def = L.LAYERS.find((l) => l.key === layer) || L.LAYERS[0];
    return '<div class="seg" role="tablist" aria-label="Warstwa tekstowa">' + tabs + '</div>' +
      '<textarea class="layer-text' + (layer === 'chords' ? ' mono' : '') + '" id="' + (inPlayer ? 'playerText' : 'layerText') +
      '" data-song="' + esc(s.id) + '" data-layer="' + def.key + '" placeholder="' + esc(def.placeholder) +
      '" spellcheck="' + (layer !== 'chords') + '" aria-label="' + esc(def.label) + '">' + esc(s[def.key] || '') + '</textarea>';
  }

  function renderSongItems(s) {
    const box = $('#songItems');
    if (!box) return;
    const items = itemsOfSong(s.id);
    if (!items.length) {
      box.innerHTML = '<div class="empty compact"><p>Nagraj pomysł, wgraj plik z dyktafonu lub z Logic, albo dodaj inspirację ze Spotify.</p>' +
        '<div class="add-row" style="justify-content:center;margin:14px 0 0">' +
        '<button type="button" class="btn small primary" data-act="record">' + icon('i-mic') + 'Nagraj</button>' +
        '<button type="button" class="btn small" data-act="add-to-song">' + icon('i-plus') + 'Dodaj</button></div></div>';
      return;
    }
    box.innerHTML = L.FOLDERS.map((f) => {
      const list = items.filter((i) => i.folder === f.key).sort((a, b) => b.createdAt - a.createdAt);
      if (!list.length) return '';
      return '<div class="group"><div class="group-title">' + icon(f.icon) + esc(f.label) +
        ' <span style="color:var(--faint)">' + list.length + '</span></div>' +
        '<ul class="items">' + list.map((i) => itemRow(i, { showSong: false })).join('') + '</ul></div>';
    }).join('');
  }

  /* ======================= Widok: foldery ======================= */

  function renderFolders() {
    const recent = state.items.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    view.innerHTML =
      '<a class="backlink" href="../index.html">← Tomkowe pomysły</a>' +
      '<div class="page-head"><div><p class="eyebrow">Warsztat</p><h1>Foldery</h1></div></div>' +
      '<div class="folders">' + L.FOLDERS.map((f) => {
        const n = state.items.filter((i) => i.folder === f.key).length;
        return '<a class="folder" href="#/folder/' + f.key + '"><span class="ico">' + icon(f.icon) + '</span>' +
          '<span><strong>' + esc(f.label) + '</strong><span>' +
          (n ? L.countLabel(n, 'pozycja', 'pozycje', 'pozycji') : 'pusto') + '</span></span></a>';
      }).join('') + '</div>' +
      '<section class="section"><div class="section-head"><h2>Ostatnio dodane</h2></div>' +
      (recent.length
        ? '<ul class="items" id="recentList">' + recent.map((i) => itemRow(i, { showFolder: true })).join('') + '</ul>'
        : '<div class="empty compact"><p>Jeszcze nic tu nie ma. Dotknij czerwonego mikrofonu na dole, żeby nagrać pierwszy pomysł.</p></div>') +
      '</section>' +
      '<div class="card data-card"><p><strong>Dane na tym urządzeniu</strong>Nagrania i teksty zapisują się w tej przeglądarce. Kopia przeniesie je na inne urządzenie.</p>' +
      '<button type="button" class="btn small" data-act="export">' + icon('i-download') + 'Kopia</button>' +
      '<button type="button" class="btn small" data-act="import">' + icon('i-upload') + 'Wczytaj</button></div>';
  }

  function renderFolder(key) {
    const f = L.folderOf(key);
    const items = itemsInFolder(key);
    const isInsp = key === 'inspiracje';
    view.innerHTML =
      '<div class="topbar"><a class="back-btn" href="#/foldery">' + icon('i-chevron-left') + 'Foldery</a>' +
      '<div class="grow topbar-title">' + esc(f.label) + '</div><span style="width:44px"></span></div>' +
      '<div class="page-head"><div><p class="eyebrow">Folder · ' + L.countLabel(items.length, 'pozycja', 'pozycje', 'pozycji') + '</p>' +
      '<h1>' + esc(f.label) + '</h1></div></div>' +
      '<div class="add-row">' +
      (isInsp ? '<button type="button" class="btn small primary" data-act="spotify">' + icon('i-spotify') + 'Ze Spotify</button>' : '') +
      '<button type="button" class="btn small' + (isInsp ? '' : ' primary') + '" data-act="record">' + icon('i-mic') + 'Nagraj</button>' +
      '<button type="button" class="btn small" data-act="upload">' + icon('i-upload') + 'Wgraj plik</button></div>' +
      (items.length
        ? '<ul class="items" id="folderList">' + items.map((i) => itemRow(i)).join('') + '</ul>'
        : '<div class="empty compact"><p>' + folderHint(key) + '</p></div>');
  }

  function folderHint(key) {
    return {
      proby: 'Wrzuć tu nagrania z dyktafonu albo nagraj próbę prosto z telefonu.',
      motywy: 'Riffy i motywy: audio albo wideo z gitarą, żeby było widać chwyty.',
      inspiracje: 'Wklej link do utworu albo playlisty ze Spotify, żeby mieć inspiracje pod ręką przy utworze.',
      daw: 'Bounce’y i szkice wyeksportowane z Logic albo innego DAW.',
    }[key];
  }

  function itemRow(i, { showSong = true, showFolder = false } = {}) {
    const song = i.songId ? songById(i.songId) : null;
    const playing = player.item && player.item.id === i.id;
    const isSpot = i.type === 'spotify';
    const meta = [];
    if (i.type === 'video') meta.push(icon('i-video'));
    if (showFolder) meta.push('<span>' + esc(L.folderOf(i.folder).short) + '</span>');
    if (showSong) meta.push(song ? '<span class="song">' + esc(song.title || 'Bez tytułu') + '</span>' : '<span class="none">Bez utworu</span>');
    if (isSpot) meta.push('<span>Spotify · ' + esc(L.SPOTIFY_KIND_LABEL[i.spotify && i.spotify.kind] || 'link') + '</span>');
    else if (i.duration) meta.push('<span>' + L.formatTime(i.duration) + '</span>');
    meta.push('<span>' + L.relativeDate(i.createdAt) + '</span>');
    const playIcon = isSpot ? 'i-spotify' : (playing && player.isPlaying() ? 'i-pause' : 'i-play');
    return '<li class="item-row' + (playing ? ' playing' : '') + '" data-item="' + esc(i.id) + '">' +
      '<button type="button" class="item-play' + (isSpot ? ' spotify' : '') + '" data-act="play" data-id="' + esc(i.id) +
      '" aria-label="' + (playing && player.isPlaying() ? 'Pauza' : 'Odtwórz') + ': ' + esc(i.title) + '">' + icon(playIcon) + '</button>' +
      '<button type="button" class="item-main" data-act="open" data-id="' + esc(i.id) + '">' +
      '<div class="item-title">' + esc(i.title) + '</div>' +
      '<div class="item-meta">' + meta.join(dot) + '</div></button>' +
      '<button type="button" class="icon-btn subtle" data-act="item-menu" data-id="' + esc(i.id) + '" aria-label="Opcje: ' +
      esc(i.title) + '">' + icon('i-more') + '</button></li>';
  }

  function refreshItemsInView() {
    const r = state.route;
    if (r.name === 'utwor') { const s = songById(r.id); if (s) renderSongItems(s); }
    else if (r.name === 'folder' || r.name === 'foldery') render({ keepScroll: true });
  }

  /* ======================= Metronom ======================= */

  const metro = {
    ctx: null, timer: null, next: 0, beat: 0, bpm: 120, running: false, onBeat: null,
    ensure() {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    start(bpm, onBeat) {
      this.stop();
      const ctx = this.ensure();
      this.bpm = bpm; this.onBeat = onBeat; this.beat = 0; this.running = true;
      this.next = ctx.currentTime + 0.06;
      this.timer = setInterval(() => this.tick(), 25);
      this.tick();
    },
    setBpm(bpm) { this.bpm = bpm; },
    stop() {
      clearInterval(this.timer); this.timer = null;
      this.running = false;
      const b = $('#metroBtn'); if (b) b.setAttribute('aria-pressed', 'false');
    },
    tick() {
      const ctx = this.ctx;
      while (this.next < ctx.currentTime + 0.12) {
        const accent = this.beat % 4 === 0;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.value = accent ? 1760 : 1175;
        g.gain.setValueAtTime(0.0001, this.next);
        g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, this.next + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, this.next + 0.05);
        osc.connect(g).connect(ctx.destination);
        osc.start(this.next); osc.stop(this.next + 0.06);
        if (this.onBeat) {
          const delay = Math.max(0, (this.next - ctx.currentTime) * 1000);
          const cb = this.onBeat;
          setTimeout(() => cb(accent), delay);
        }
        this.next += 60 / this.bpm;
        this.beat++;
      }
    },
  };

  function pulseBeat() {
    const b = $('#beat');
    if (!b) return;
    b.classList.add('hit');
    setTimeout(() => b.classList.remove('hit'), 90);
  }

  /* ======================= Odtwarzacz ======================= */

  const media = $('#media');
  const playerEl = $('#player');
  const mini = $('#mini');
  const wave = $('#wave');

  const player = {
    item: null,
    url: null,
    open: false,

    isPlaying() { return this.item && this.item.type !== 'spotify' && !media.paused; },

    async load(item, { autoplay = true, expand = false } = {}) {
      if (this.item && this.item.id === item.id) {
        if (expand) this.show();
        else if (autoplay) this.toggle();
        return;
      }
      this.stopMedia();
      this.item = item;
      const spot = $('#spotifyBox');
      spot.innerHTML = '';
      if (item.type === 'spotify') {
        spot.hidden = false;
        spot.innerHTML = '<iframe src="' + esc(item.spotify.embed) + '?utm_source=generator&theme=0" loading="lazy" ' +
          'allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="Spotify: ' + esc(item.title) + '"></iframe>' +
          '<p class="spotify-note">Pełne utwory gra Spotify po zalogowaniu. <a href="' + esc(item.spotify.url) + '" target="_blank" rel="noopener">Otwórz w Spotify ↗</a></p>';
        media.classList.remove('show');
        expand = true;
      } else {
        spot.hidden = true;
        const blob = await Store.getBlob(item.id);
        if (!blob) { toast('Nie znaleziono pliku nagrania'); this.stop(); return; }
        this.url = URL.createObjectURL(blob);
        media.src = this.url;
        media.loop = $('#loopBtn').getAttribute('aria-pressed') === 'true';
        media.playbackRate = Number($('#speedBtn').dataset.rate || 1);
        media.classList.toggle('show', item.type === 'video');
        if (autoplay) media.play().catch(() => {});
      }
      playerEl.classList.toggle('is-spotify', item.type === 'spotify');
      $('#waveWrap').hidden = item.type === 'spotify';
      $('#transport').hidden = item.type === 'spotify';
      this.fillMeta();
      this.renderLayers();
      this.drawWave();
      this.setMediaSession();
      mini.hidden = false;
      document.body.classList.add('has-mini');
      this.syncButtons();
      if (expand) this.show();
    },

    fillMeta() {
      const it = this.item;
      if (!it) return;
      const song = it.songId ? songById(it.songId) : null;
      $('#playerFolder').textContent = L.folderOf(it.folder).label;
      $('#playerSong').innerHTML = song
        ? esc(song.title || 'Bez tytułu') + ' <span class="bpm-badge">' + song.bpm + ' BPM · ' + esc(L.statusLabel(song.status)) + '</span>'
        : '<span style="color:var(--muted)">Bez utworu</span>';
      $('#playerItem').textContent = it.title;
      $('#miniTitle').textContent = song ? (song.title || 'Bez tytułu') : it.title;
      $('#miniSub').textContent = song ? it.title + ' · ' + L.folderOf(it.folder).short : L.folderOf(it.folder).label;
    },

    renderLayers() {
      const box = $('#playerLayers');
      const it = this.item;
      if (!it) { box.innerHTML = ''; return; }
      const song = it.songId ? songById(it.songId) : null;
      if (song) {
        box.innerHTML = layersHtml(song, { inPlayer: true });
        return;
      }
      const opts = state.songs.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pl'))
        .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.title || 'Bez tytułu') + '</option>').join('');
      box.innerHTML = '<div class="empty compact assign"><p style="margin-bottom:12px">Przypisz nagranie do utworu, żeby pisać do niego tekst, akordy i notatki.</p>' +
        '<select class="input" id="assignSong" aria-label="Przypisz do utworu"><option value="">Wybierz utwór…</option>' + opts +
        '<option value="__new">＋ Nowy utwór z tego nagrania</option></select></div>';
    },

    show() {
      if (!this.item) return;
      this.open = true;
      playerEl.classList.add('open');
      playerEl.setAttribute('aria-hidden', 'false');
      playerEl.inert = false;
      document.body.classList.add('lock');
      requestAnimationFrame(() => this.drawWave());
      this.loop();
    },

    hide() {
      this.open = false;
      playerEl.classList.remove('open');
      playerEl.setAttribute('aria-hidden', 'true');
      playerEl.inert = true;
      document.body.classList.remove('lock');
      if (document.activeElement && playerEl.contains(document.activeElement)) document.activeElement.blur();
      // Odśwież widok utworu, jeśli w odtwarzaczu zmienił się tekst.
      if (state.route.name === 'utwor') render({ keepScroll: true });
    },

    toggle() {
      if (!this.item || this.item.type === 'spotify') { this.show(); return; }
      if (media.paused) media.play().catch(() => {}); else media.pause();
    },

    stopMedia() {
      media.pause();
      media.removeAttribute('src');
      media.load();
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = null;
    },

    stop() {
      this.stopMedia();
      $('#spotifyBox').innerHTML = '';
      this.item = null;
      mini.hidden = true;
      document.body.classList.remove('has-mini');
      if (this.open) this.hide();
      refreshPlayingRows();
    },

    seek(t) {
      if (!Number.isFinite(media.duration)) return;
      media.currentTime = Math.max(0, Math.min(media.duration, t));
      this.drawWave();
    },

    duration() {
      return Number.isFinite(media.duration) && media.duration > 0 ? media.duration : (this.item && this.item.duration) || 0;
    },

    syncButtons() {
      const playing = this.isPlaying();
      const ic = playing ? 'i-pause' : 'i-play';
      const label = playing ? 'Pauza' : 'Odtwarzaj';
      for (const b of [$('#bigPlay'), $('#miniPlay')]) {
        b.innerHTML = icon(this.item && this.item.type === 'spotify' && b.id === 'miniPlay' ? 'i-spotify' : ic);
        b.setAttribute('aria-label', label);
      }
      refreshPlayingRows();
    },

    drawWave() {
      if (!this.item || this.item.type === 'spotify') return;
      const dpr = window.devicePixelRatio || 1;
      const w = wave.clientWidth;
      const h = wave.clientHeight;
      if (!w || !h) return;
      if (wave.width !== Math.round(w * dpr)) { wave.width = Math.round(w * dpr); wave.height = Math.round(h * dpr); }
      const c = wave.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const css = getComputedStyle(document.documentElement);
      const played = css.getPropertyValue('--primary').trim();
      const rest = css.getPropertyValue('--surface-3').trim();
      const peaks = this.item.peaks;
      const barW = 3;
      const gap = 2;
      const n = Math.floor((w + gap) / (barW + gap));
      const dur = this.duration();
      const pos = dur ? (media.currentTime || 0) / dur : 0;
      for (let i = 0; i < n; i++) {
        let v;
        if (peaks && peaks.length) v = peaks[Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length))];
        else v = 0.25 + 0.15 * Math.sin(i * 0.7) * Math.sin(i * 0.23); // zanim policzymy falę
        const bh = Math.max(3, v * (h - 6));
        c.fillStyle = (i + 0.5) / n <= pos ? played : rest;
        const x = i * (barW + gap);
        roundRect(c, x, (h - bh) / 2, barW, bh, 1.5);
      }
      $('#tCur').textContent = L.formatTime(media.currentTime || 0);
      $('#tDur').textContent = L.formatTime(dur);
      $('#miniBar').style.width = (pos * 100).toFixed(2) + '%';
    },

    loop() {
      if (this._raf) return;
      const step = () => {
        this._raf = null;
        if (!this.item) return;
        this.drawWave();
        if (!media.paused && this.open) this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    },

    setMediaSession() {
      if (!('mediaSession' in navigator) || !this.item) return;
      const song = this.item.songId ? songById(this.item.songId) : null;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: this.item.title,
          artist: song ? song.title : L.folderOf(this.item.folder).label,
          album: 'Warsztat utworów',
        });
        navigator.mediaSession.setActionHandler('play', () => media.play());
        navigator.mediaSession.setActionHandler('pause', () => media.pause());
        navigator.mediaSession.setActionHandler('seekbackward', () => this.seek(media.currentTime - 10));
        navigator.mediaSession.setActionHandler('seekforward', () => this.seek(media.currentTime + 10));
      } catch (e) { /* starsze przeglądarki */ }
    },
  };

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.fill();
  }

  function refreshPlayingRows() {
    $$('.item-row').forEach((row) => {
      const it = itemById(row.dataset.item);
      if (!it) return;
      const tmp = document.createElement('ul');
      tmp.innerHTML = itemRow(it, {
        showSong: !row.closest('#songItems'),
        showFolder: !!row.closest('#recentList'),
      });
      row.replaceWith(tmp.firstElementChild);
    });
  }

  media.addEventListener('play', () => { player.syncButtons(); player.loop(); });
  media.addEventListener('pause', () => player.syncButtons());
  media.addEventListener('ended', () => player.syncButtons());
  media.addEventListener('timeupdate', () => { if (!player.open) player.drawWave(); });
  media.addEventListener('loadedmetadata', () => {
    const it = player.item;
    if (it && Number.isFinite(media.duration) && Math.abs((it.duration || 0) - media.duration) > 0.5) {
      updateItem(it.id, { duration: media.duration });
    }
    player.drawWave();
  });

  // Przewijanie po fali (mysz i dotyk)
  (() => {
    let dragging = false;
    const at = (e) => {
      const r = wave.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      player.seek(x * player.duration());
    };
    wave.addEventListener('pointerdown', (e) => { dragging = true; wave.setPointerCapture(e.pointerId); at(e); });
    wave.addEventListener('pointermove', (e) => { if (dragging) at(e); });
    wave.addEventListener('pointerup', () => { dragging = false; });
    wave.addEventListener('pointercancel', () => { dragging = false; });
  })();

  $('#bigPlay').addEventListener('click', () => player.toggle());
  $('#miniPlay').addEventListener('click', () => player.toggle());
  $('#miniOpen').addEventListener('click', () => player.show());
  $('#miniClose').addEventListener('click', () => player.stop());
  $('#playerDown').addEventListener('click', () => player.hide());
  $('#back10').addEventListener('click', () => player.seek(media.currentTime - 10));
  $('#fwd10').addEventListener('click', () => player.seek(media.currentTime + 10));
  $('#loopBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    media.loop = on;
    toast(on ? 'Zapętlanie włączone' : 'Zapętlanie wyłączone');
  });
  $('#speedBtn').addEventListener('click', (e) => {
    const rates = [1, 0.75, 0.5];
    const cur = Number(e.currentTarget.dataset.rate || 1);
    const next = rates[(rates.indexOf(cur) + 1) % rates.length];
    e.currentTarget.dataset.rate = next;
    e.currentTarget.textContent = String(next).replace('.', ',') + '×';
    e.currentTarget.setAttribute('aria-pressed', String(next !== 1));
    media.playbackRate = next;
    if ('preservesPitch' in media) media.preservesPitch = true;
  });
  $('#playerMore').addEventListener('click', () => player.item && openItemSheet(player.item.id));
  playerEl.inert = true;

  window.addEventListener('resize', () => player.drawWave());

  /* ======================= Arkusze ======================= */

  let sheet = $('#sheet');
  const scrim = $('#scrim');
  let sheetOnClose = null;
  let sheetLocked = false;

  function openSheet(html, { onClose, label } = {}) {
    closeSheet();
    // Świeży element, żeby nie zostały nasłuchy z poprzedniego arkusza.
    const fresh = sheet.cloneNode(false);
    sheet.replaceWith(fresh);
    sheet = fresh;
    sheet.innerHTML = html;
    sheet.hidden = false;
    scrim.hidden = false;
    sheet.setAttribute('aria-label', label || '');
    sheetOnClose = onClose || null;
    const first = sheet.querySelector('[autofocus]') || sheet.querySelector('input, select, button');
    if (first && window.matchMedia('(hover: hover)').matches) first.focus();
    return sheet;
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    scrim.hidden = true;
    sheet.innerHTML = '';
    sheetLocked = false;
    const cb = sheetOnClose;
    sheetOnClose = null;
    if (cb) cb();
  }

  scrim.addEventListener('click', () => { if (!sheetLocked) closeSheet(); });

  function confirmSheet(title, text, okLabel = 'Usuń') {
    return new Promise((resolve) => {
      let answered = false;
      openSheet('<h3>' + esc(title) + '</h3><p class="sub">' + esc(text) + '</p>' +
        '<div class="sheet-actions"><button type="button" class="btn" data-x="no">Anuluj</button>' +
        '<button type="button" class="btn primary" data-x="yes">' + esc(okLabel) + '</button></div>',
      { onClose: () => { if (!answered) resolve(false); } });
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        answered = true;
        closeSheet();
        resolve(b.dataset.x === 'yes');
      });
    });
  }

  function songOptions(selected) {
    return '<option value="">Bez utworu</option>' + state.songs.slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((s) => '<option value="' + esc(s.id) + '"' + (s.id === selected ? ' selected' : '') + '>' +
        esc(s.title || 'Bez tytułu') + '</option>').join('');
  }

  function folderChips(selected, { exclude = [] } = {}) {
    return L.FOLDERS.filter((f) => !exclude.includes(f.key)).map((f) =>
      '<button type="button" class="chip" data-folder="' + f.key + '" aria-pressed="' + (f.key === selected) + '">' +
      esc(f.label) + '</button>').join('');
  }

  function wireChipSelect(root, attr) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-' + attr + ']');
      if (!b) return;
      $$('[data-' + attr + ']', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
  }
  const chipValue = (root, attr) => {
    const b = $('[data-' + attr + '][aria-pressed="true"]', root);
    return b ? b.dataset[attr] : null;
  };

  /* --- Status --- */
  function openStatusSheet(songId) {
    const s = songById(songId);
    if (!s) return;
    const cur = L.statusIndex(s.status);
    openSheet('<h3>Status utworu</h3><p class="sub">' + esc(s.title || 'Bez tytułu') + '</p><div class="choice" role="radiogroup">' +
      L.STATUSES.map((st, i) => '<button type="button" role="radio" data-status="' + st.key + '" aria-checked="' + (i === cur) + '">' +
        '<span class="step-no">' + (i + 1) + '</span><span class="grow">' + esc(st.label) + '</span></button>').join('') + '</div>');
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      updateSong(songId, { status: b.dataset.status });
      closeSheet();
      render({ keepScroll: true });
      toast((s.title || 'Utwór') + ' → ' + L.statusLabel(b.dataset.status));
    });
  }

  /* --- Nowy utwór --- */
  function openNewSongSheet({ fromItem } = {}) {
    openSheet('<h3>Nowy utwór</h3>' +
      '<label class="field"><span>Tytuł roboczy</span><input class="input" id="nsTitle" placeholder="np. Riff z czwartku" autocomplete="off" autofocus></label>' +
      '<label class="field"><span>Docelowe tempo (BPM)</span><input class="input" id="nsBpm" type="number" inputmode="numeric" value="120" min="30" max="300"></label>' +
      '<div class="field"><span>Status</span><div class="chip-select" id="nsStatus">' +
      L.STATUSES.map((st, i) => '<button type="button" class="chip" data-st="' + st.key + '" aria-pressed="' + (i === 0) + '">' + esc(st.label) + '</button>').join('') +
      '</div></div>' +
      '<div class="sheet-actions"><button type="button" class="btn" data-x="cancel">Anuluj</button>' +
      '<button type="button" class="btn primary" data-x="ok">Utwórz</button></div>', { label: 'Nowy utwór' });
    const t = $('#nsTitle');
    setTimeout(() => t.focus(), 50);
    wireChipSelect($('#nsStatus'), 'st');
    const submit = async () => {
      const song = await createSong({
        title: t.value.trim() || 'Nowy utwór',
        bpm: $('#nsBpm').value,
        status: chipValue(sheet, 'st') || 'motyw',
      });
      closeSheet();
      if (fromItem) {
        await updateItem(fromItem, { songId: song.id });
        player.fillMeta(); player.renderLayers();
        toast('Utworzono „' + song.title + '” z nagraniem');
        if (!player.open) go('#/utwor/' + encodeURIComponent(song.id));
      } else {
        go('#/utwor/' + encodeURIComponent(song.id));
      }
    };
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'ok') submit(); else closeSheet();
    });
  }

  /* --- Menu utworu --- */
  function openSongMenu(songId) {
    const s = songById(songId);
    if (!s) return;
    openSheet('<h3>' + esc(s.title || 'Bez tytułu') + '</h3><div class="choice">' +
      '<button type="button" data-x="copy">' + icon('i-text') + '<span class="grow">Kopiuj tekst i akordy<small>Do wysłania zespołowi</small></span></button>' +
      '<button type="button" class="danger" data-x="del">' + icon('i-trash') + '<span class="grow">Usuń utwór<small>Nagrania zostaną w folderach</small></span></button>' +
      '</div>');
    sheet.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'copy') {
        const parts = [s.title || 'Bez tytułu', 'Tempo: ' + s.bpm + ' BPM · ' + L.statusLabel(s.status)];
        if (s.chords.trim()) parts.push('— Akordy —\n' + s.chords.trim());
        if (s.lyrics.trim()) parts.push('— Tekst —\n' + s.lyrics.trim());
        if (s.notes.trim()) parts.push('— Notatki —\n' + s.notes.trim());
        closeSheet();
        try { await navigator.clipboard.writeText(parts.join('\n\n')); toast('Skopiowano do schowka'); }
        catch (err) { toast('Nie udało się skopiować'); }
      } else {
        closeSheet();
        const ok = await confirmSheet('Usunąć „' + (s.title || 'Bez tytułu') + '”?',
          'Tekst, akordy i notatki znikną. Nagrania zostaną w folderach jako „Bez utworu”.');
        if (!ok) return;
        await deleteSong(songId);
        if (player.item) { player.fillMeta(); player.renderLayers(); }
        go('#/utwory');
        toast('Usunięto utwór');
      }
    });
  }

  /* --- Dodawanie do utworu --- */
  function openAddSheet({ songId, folder = 'proby' } = {}) {
    openSheet('<h3>Dodaj do utworu</h3>' +
      '<div class="field"><span>Do folderu</span><div class="chip-select" id="addFolder">' + folderChips(folder, { exclude: ['inspiracje'] }) + '</div></div>' +
      '<div class="choice">' +
      '<button type="button" data-x="record">' + icon('i-mic') + '<span class="grow">Nagraj teraz<small>Mikrofon telefonu lub komputera</small></span></button>' +
      '<button type="button" data-x="upload">' + icon('i-upload') + '<span class="grow">Wgraj plik audio lub wideo<small>Dyktafon, bounce z Logic, wideo z riffem</small></span></button>' +
      '<button type="button" data-x="spotify">' + icon('i-spotify') + '<span class="grow">Inspiracja ze Spotify<small>Trafi do folderu Inspiracje</small></span></button>' +
      '</div>');
    wireChipSelect($('#addFolder'), 'folder');
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const f = chipValue(sheet, 'folder') || folder;
      closeSheet();
      if (b.dataset.x === 'record') openRecordSheet({ songId, folder: f });
      else if (b.dataset.x === 'upload') pickFiles({ songId, folder: f });
      else openSpotifySheet({ songId });
    });
  }

  /* --- Edycja nagrania --- */
  function openItemSheet(itemId) {
    const it = itemById(itemId);
    if (!it) return;
    openSheet('<h3>Nagranie</h3>' +
      '<label class="field"><span>Nazwa</span><input class="input" id="itTitle" value="' + esc(it.title) + '" autocomplete="off"></label>' +
      '<label class="field"><span>Utwór</span><select class="input" id="itSong">' + songOptions(it.songId) + '</select></label>' +
      '<div class="field"><span>Folder</span><div class="chip-select" id="itFolder">' + folderChips(it.folder) + '</div></div>' +
      '<div class="choice" style="margin-top:6px">' +
      (it.type === 'spotify'
        ? '<button type="button" data-x="ext">' + icon('i-spotify') + '<span class="grow">Otwórz w Spotify</span></button>'
        : '<button type="button" data-x="dl">' + icon('i-download') + '<span class="grow">Pobierz plik</span></button>') +
      '<button type="button" class="danger" data-x="del">' + icon('i-trash') + '<span class="grow">Usuń</span></button></div>' +
      '<div class="sheet-actions"><button type="button" class="btn" data-x="cancel">Anuluj</button>' +
      '<button type="button" class="btn primary" data-x="save">Zapisz</button></div>', { label: 'Edycja nagrania' });
    wireChipSelect($('#itFolder'), 'folder');
    sheet.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const x = b.dataset.x;
      if (x === 'cancel') return closeSheet();
      if (x === 'save') {
        const oldSong = it.songId;
        await updateItem(it.id, {
          title: $('#itTitle').value.trim() || it.title,
          songId: $('#itSong').value || null,
          folder: chipValue(sheet, 'folder') || it.folder,
        });
        if (it.songId && it.songId !== oldSong) updateSong(it.songId, {});
        closeSheet();
        if (player.item && player.item.id === it.id) { player.fillMeta(); player.renderLayers(); player.setMediaSession(); }
        render({ keepScroll: true });
        toast('Zapisano');
      } else if (x === 'ext') {
        window.open(it.spotify.url, '_blank', 'noopener');
      } else if (x === 'dl') {
        const blob = await Store.getBlob(it.id);
        if (!blob) return toast('Brak pliku');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = it.title + extFor(blob.type);
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } else if (x === 'del') {
        closeSheet();
        const ok = await confirmSheet('Usunąć „' + it.title + '”?', 'Nagranie zniknie z tego urządzenia.');
        if (!ok) return;
        await deleteItem(it.id);
        render({ keepScroll: true });
        toast('Usunięto');
      }
    });
  }

  function extFor(mime) {
    if (/webm/.test(mime)) return '.webm';
    if (/mp4|m4a|aac/.test(mime)) return mime.startsWith('video') ? '.mp4' : '.m4a';
    if (/mpeg|mp3/.test(mime)) return '.mp3';
    if (/wav/.test(mime)) return '.wav';
    if (/ogg/.test(mime)) return '.ogg';
    if (/quicktime/.test(mime)) return '.mov';
    return '';
  }

  /* --- Spotify --- */
  function openSpotifySheet({ songId } = {}) {
    openSheet('<h3>Inspiracja ze Spotify</h3><p class="sub">W Spotify: ⋯ → Udostępnij → Kopiuj link. Działa z utworem, albumem i playlistą.</p>' +
      '<label class="field"><span>Link</span><input class="input" id="spUrl" placeholder="https://open.spotify.com/track/…" inputmode="url" autocomplete="off"></label>' +
      '<label class="field"><span>Nazwa</span><input class="input" id="spTitle" placeholder="Uzupełni się sama po wklejeniu" autocomplete="off"></label>' +
      '<label class="field"><span>Do utworu</span><select class="input" id="spSong">' + songOptions(songId) + '</select></label>' +
      '<div class="sheet-actions"><button type="button" class="btn" data-x="cancel">Anuluj</button>' +
      '<button type="button" class="btn primary" data-x="ok" disabled>Dodaj</button></div>', { label: 'Spotify' });
    const url = $('#spUrl');
    const title = $('#spTitle');
    const ok = $('[data-x="ok"]', sheet);
    setTimeout(() => url.focus(), 50);
    let lastFetched = '';
    url.addEventListener('input', async () => {
      const p = L.parseSpotify(url.value);
      ok.disabled = !p;
      if (!p || p.url === lastFetched) return;
      lastFetched = p.url;
      const name = await spotifyTitle(p.url);
      if (name && !title.value.trim()) title.value = name;
    });
    sheet.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'cancel') return closeSheet();
      const p = L.parseSpotify(url.value);
      if (!p) return;
      const item = await addItem({
        folder: 'inspiracje',
        songId: $('#spSong').value || null,
        type: 'spotify',
        spotify: p,
        title: title.value.trim() || ('Spotify · ' + L.SPOTIFY_KIND_LABEL[p.kind]),
      });
      closeSheet();
      render({ keepScroll: true });
      toast('Dodano do Inspiracji', 'Otwórz', () => player.load(item, { expand: true }));
    });
  }

  async function spotifyTitle(url) {
    try {
      const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url));
      if (!r.ok) return '';
      const j = await r.json();
      return j.title || '';
    } catch (e) { return ''; }
  }

  /* --- Wgrywanie plików --- */
  const fileInput = $('#fileInput');
  let uploadCtx = null;
  function pickFiles(ctx) {
    uploadCtx = ctx;
    fileInput.value = '';
    fileInput.click();
  }
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    if (!files.length || !uploadCtx) return;
    let last = null;
    for (const f of files) {
      const type = f.type.startsWith('video') ? 'video' : 'audio';
      last = await addItem({ folder: uploadCtx.folder, songId: uploadCtx.songId || null, title: L.fileTitle(f.name), type, blob: f });
    }
    render({ keepScroll: true });
    const where = L.folderOf(uploadCtx.folder).label;
    toast(files.length === 1 ? 'Dodano do „' + where + '”' : 'Dodano ' + L.countLabel(files.length, 'plik', 'pliki', 'plików') + ' do „' + where + '”',
      'Odtwórz', () => player.load(last, { expand: true }));
  });

  /* --- Nagrywanie --- */
  function openRecordSheet({ songId = null, folder = 'proby' } = {}) {
    const rec = { stream: null, mr: null, chunks: [], start: 0, timer: null, ctx: null, raf: null, live: false };
    const bars = Array.from({ length: 28 }, () => '<i></i>').join('');
    openSheet('<h3>Nowe nagranie</h3>' +
      '<div class="rec-panel" id="recPanel"><div class="rec-time" id="recTime">0:00</div>' +
      '<div class="rec-meter" id="recMeter" aria-hidden="true">' + bars + '</div>' +
      '<button type="button" class="rec-big" id="recBtn" aria-label="Zacznij nagrywać"><span></span></button>' +
      '<div class="rec-hint" id="recHint">Dotknij, żeby nagrywać</div></div>' +
      '<label class="field" style="margin-top:14px"><span>Nazwa</span><input class="input" id="recTitle" value="' + esc(L.defaultRecordingTitle()) + '" autocomplete="off"></label>' +
      '<div class="field"><span>Folder</span><div class="chip-select" id="recFolder">' + folderChips(folder) + '</div></div>' +
      '<label class="field"><span>Utwór</span><select class="input" id="recSong">' + songOptions(songId) + '</select></label>' +
      '<div class="toggle-row"><div>Klik metronomu<small id="recClickInfo"></small></div>' +
      '<label class="switch"><input type="checkbox" id="recClick" aria-label="Klik metronomu"><span></span></label></div>' +
      '<div class="sheet-actions"><button type="button" class="btn" data-x="cancel">Zamknij</button></div>',
    { label: 'Nagrywanie', onClose: () => cleanup() });

    wireChipSelect($('#recFolder'), 'folder');
    const songSel = $('#recSong');
    const info = () => {
      const s = songById(songSel.value);
      $('#recClickInfo').textContent = (s ? s.bpm : 120) + ' BPM' + (s ? ' z utworu' : '') + ' · najlepiej w słuchawkach';
    };
    info();
    songSel.addEventListener('change', info);

    const panel = $('#recPanel');
    const meterBars = $$('#recMeter i');

    function cleanup() {
      clearInterval(rec.timer);
      cancelAnimationFrame(rec.raf);
      if (rec.mr && rec.mr.state !== 'inactive') { rec.discard = true; rec.mr.stop(); }
      if (rec.stream) rec.stream.getTracks().forEach((t) => t.stop());
      if (rec.ctx) rec.ctx.close().catch(() => {});
      if (rec.click) metro.stop();
    }

    async function start() {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        $('#recHint').textContent = 'Ta przeglądarka nie obsługuje nagrywania. Wgraj plik.';
        return;
      }
      try {
        rec.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        $('#recHint').textContent = location.protocol === 'file:'
          ? 'Brak dostępu do mikrofonu. Otwórz stronę przez https (GitHub Pages).'
          : 'Brak dostępu do mikrofonu. Zezwól na niego w przeglądarce.';
        return;
      }
      const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
      rec.mr = new MediaRecorder(rec.stream, mimeType ? { mimeType } : undefined);
      rec.chunks = [];
      rec.mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      rec.mr.onstop = () => finish();
      rec.mr.start(250);
      rec.start = performance.now();
      rec.live = true;
      sheetLocked = true;
      panel.classList.add('live');
      $('#recBtn').setAttribute('aria-label', 'Zatrzymaj i zapisz');
      $('#recHint').textContent = 'Nagrywam… dotknij, żeby zapisać';
      $('[data-x="cancel"]', sheet).textContent = 'Odrzuć';
      rec.timer = setInterval(() => {
        $('#recTime').textContent = L.formatTime((performance.now() - rec.start) / 1000);
      }, 200);

      // Wskaźnik poziomu
      try {
        rec.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = rec.ctx.createMediaStreamSource(rec.stream);
        const an = rec.ctx.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const data = new Uint8Array(an.fftSize);
        const levels = new Array(meterBars.length).fill(0.04);
        let last = 0;
        const draw = (t) => {
          rec.raf = requestAnimationFrame(draw);
          if (t - last < 60) return;
          last = t;
          an.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
          levels.shift(); levels.push(Math.min(1, peak * 1.6 + 0.04));
          meterBars.forEach((b, i) => { b.style.height = (levels[i] * 100).toFixed(0) + '%'; });
        };
        rec.raf = requestAnimationFrame(draw);
      } catch (e) { /* bez wskaźnika */ }

      if ($('#recClick').checked) {
        const s = songById(songSel.value);
        rec.click = true;
        metro.start(s ? s.bpm : 120, null);
      }
    }

    async function finish() {
      const elapsed = (performance.now() - rec.start) / 1000;
      const discard = rec.discard;
      const type = (rec.mr && rec.mr.mimeType) || 'audio/webm';
      const blob = new Blob(rec.chunks, { type });
      const meta = {
        folder: chipValue(sheet, 'folder') || folder,
        songId: songSel.value || null,
        title: ($('#recTitle') && $('#recTitle').value.trim()) || L.defaultRecordingTitle(),
      };
      rec.live = false;
      if (discard || !blob.size) return;
      cleanup();
      closeSheet();
      const item = await addItem(Object.assign(meta, { type: 'audio', blob, duration: elapsed }));
      render({ keepScroll: true });
      toast('Zapisano w „' + L.folderOf(item.folder).label + '”', 'Odtwórz', () => player.load(item, { expand: true }));
    }

    $('#recBtn').addEventListener('click', () => {
      if (!rec.live) start();
      else if (rec.mr && rec.mr.state !== 'inactive') {
        if (rec.click) { metro.stop(); rec.click = false; }
        rec.mr.stop();
      }
    });
    $('[data-x="cancel"]', sheet).addEventListener('click', async () => {
      if (rec.live) {
        sheetLocked = false;
        rec.discard = true;
      }
      closeSheet();
    });
  }

  /* --- Kopia zapasowa --- */
  async function exportBackup() {
    toast('Przygotowuję kopię…');
    const blobs = {};
    for (const it of state.items) {
      if (it.type === 'spotify') continue;
      const b = await Store.getBlob(it.id);
      if (b) blobs[it.id] = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(b);
      });
    }
    const data = { app: 'warsztat-utworow', version: 1, exportedAt: new Date().toISOString(), songs: state.songs, items: state.items, blobs };
    const file = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(file);
    a.download = 'warsztat-utworow-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + '.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Kopia pobrana');
  }

  const backupInput = $('#backupInput');
  backupInput.addEventListener('change', async () => {
    const f = backupInput.files[0];
    backupInput.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'warsztat-utworow') throw new Error('format');
      for (const s of data.songs || []) await Store.put('songs', s);
      for (const it of data.items || []) {
        if (data.blobs && data.blobs[it.id]) {
          const blob = await (await fetch(data.blobs[it.id])).blob();
          await Store.putBlob(it.id, blob);
        }
        await Store.put('items', it);
      }
      await load();
      render();
      toast('Wczytano ' + L.countLabel((data.songs || []).length, 'utwór', 'utwory', 'utworów') + ' i ' +
        L.countLabel((data.items || []).length, 'nagranie', 'nagrania', 'nagrań'));
    } catch (e) {
      toast('To nie jest plik kopii Warsztatu');
    }
  });

  /* --- Przykład --- */
  async function loadDemo() {
    const s = await createSong({
      title: 'Ostatni pociąg',
      status: 'forma',
      bpm: 96,
      lyrics: '[Zwrotka 1]\nPeron pachnie deszczem, zegar stoi w miejscu\nLiczę światła, co uciekły nam\n\n[Refren]\nOstatni pociąg, ostatni raz\nTrzymaj się mocno, zanim zgaśnie czas\n',
      chords: 'Intro:    Am  F  C  G\nZwrotka:  Am  F  C  G  (x2)\nRefren:   F  G  Am  Am\n          F  G  C   E7\nBridge:   Dm  Am  F  G\n\nKapodaster: brak · strój standard',
      notes: 'Brzmienie: przester w refrenie, czysta gitara w zwrotce.\nPerkusja: half-time w bridge’u.\nDo zrobienia: dokończyć 2. zwrotkę, sprawdzić tonację pod wokal.',
    });
    await createSong({ title: 'Szkic w D', status: 'motyw', bpm: 132, notes: 'Riff z próby, szybki punkowy feel.' });
    await createSong({ title: 'Mgła', status: 'dopracowywanie', bpm: 78, lyrics: 'Mgła nad rzeką…' });
    go('#/utwor/' + encodeURIComponent(s.id));
    toast('Wczytano przykładowe utwory');
  }

  /* ======================= Komunikaty ======================= */

  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(text, actionLabel, action) {
    toastEl.innerHTML = '<span>' + esc(text) + '</span>' + (actionLabel ? '<button type="button">' + esc(actionLabel) + '</button>' : '');
    if (action) $('button', toastEl).addEventListener('click', () => { toastEl.classList.remove('show'); action(); });
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), actionLabel ? 5000 : 2200);
  }

  function flashSaved() {
    const el = $('#saved');
    if (!el) return;
    el.textContent = 'Zapisano';
    el.classList.add('flash');
    clearTimeout(flashSaved.t);
    flashSaved.t = setTimeout(() => el.classList.remove('flash'), 900);
  }

  function autosize(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(240, ta.scrollHeight + 2) + 'px';
  }

  /* ======================= Zdarzenia ======================= */

  let taps = [];
  let holdTimer = null;

  document.addEventListener('click', async (e) => {
    const t = e.target;

    const filter = t.closest('[data-filter]');
    if (filter) { state.filter = filter.dataset.filter; renderSongs(); return; }

    const setSt = t.closest('[data-set-status]');
    if (setSt && state.route.name === 'utwor') {
      updateSong(state.route.id, { status: setSt.dataset.setStatus });
      render({ keepScroll: true });
      return;
    }

    const layerBtn = t.closest('[data-layer]');
    if (layerBtn && layerBtn.getAttribute('role') === 'tab') {
      state.layer = layerBtn.dataset.layer;
      try { localStorage.setItem('warsztat.layer', state.layer); } catch (err) { /* brak */ }
      const inPlayer = !!layerBtn.closest('#player');
      if (inPlayer) { player.renderLayers(); $('#playerText').focus({ preventScroll: true }); }
      else {
        const s = songById(state.route.id);
        const sec = layerBtn.closest('.section');
        sec.innerHTML = '<div class="label-row"><h2>Warstwy</h2><span class="saved" id="saved"></span></div>' + layersHtml(s);
        autosize($('#layerText'));
      }
      return;
    }

    const act = t.closest('[data-act]');
    if (!act) return;
    const id = act.dataset.id;
    const r = state.route;
    switch (act.dataset.act) {
      case 'new-song': openNewSongSheet(); break;
      case 'demo': loadDemo(); break;
      case 'status': openStatusSheet(id); break;
      case 'song-menu': openSongMenu(r.id); break;
      case 'add-to-song': openAddSheet({ songId: r.id }); break;
      case 'record': openRecordSheet(recordContext()); break;
      case 'upload': pickFiles({ folder: r.key || 'proby', songId: null }); break;
      case 'spotify': openSpotifySheet({}); break;
      case 'play': { const it = itemById(id); if (it) player.load(it, { autoplay: true }); break; }
      case 'open': { const it = itemById(id); if (it) player.load(it, { autoplay: true, expand: true }); break; }
      case 'item-menu': openItemSheet(id); break;
      case 'export': exportBackup(); break;
      case 'import': backupInput.click(); break;
      default: break;
    }
  });

  function recordContext() {
    const r = state.route;
    if (r.name === 'utwor') return { songId: r.id, folder: 'proby' };
    if (r.name === 'folder') return { folder: r.key === 'inspiracje' ? 'motywy' : r.key };
    return { folder: 'proby' };
  }

  $('#recTab').addEventListener('click', () => openRecordSheet(recordContext()));

  // Pola tekstowe: tytuł, tempo, warstwy (autozapis)
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { state.query = t.value; renderSongList(); return; }
    if (t.id === 'songTitle') {
      updateSong(state.route.id, { title: t.value }, { delay: 400 });
      const top = $('#topTitle'); if (top) top.textContent = t.value || 'Bez tytułu';
      return;
    }
    if (t.id === 'layerText' || t.id === 'playerText') {
      updateSong(t.dataset.song, { [t.dataset.layer]: t.value }, { delay: 500 });
      if (t.id === 'layerText') autosize(t);
      return;
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'bpm') setBpm(t.value);
    if (t.id === 'assignSong' && player.item) {
      if (t.value === '__new') { t.value = ''; openNewSongSheet({ fromItem: player.item.id }); return; }
      if (!t.value) return;
      await updateItem(player.item.id, { songId: t.value });
      updateSong(t.value, {});
      player.fillMeta(); player.renderLayers(); player.setMediaSession();
      toast('Przypisano do utworu');
    }
  });

  function setBpm(v) {
    if (state.route.name !== 'utwor') return;
    const bpm = L.clampBpm(v);
    updateSong(state.route.id, { bpm }, { delay: 300 });
    const inp = $('#bpm'); if (inp && Number(inp.value) !== bpm) inp.value = bpm;
    if (metro.running) metro.setBpm(bpm);
  }

  // −/+ tempa z przytrzymaniem; tap tempo; metronom
  document.addEventListener('pointerdown', (e) => {
    const step = e.target.closest('[data-bpm-step]');
    if (step) {
      const d = Number(step.dataset.bpmStep);
      const bump = () => setBpm(Number($('#bpm').value) + d);
      bump();
      let delay = 380;
      const rep = () => { bump(); delay = Math.max(50, delay * 0.8); holdTimer = setTimeout(rep, delay); };
      holdTimer = setTimeout(rep, delay);
      return;
    }
    if (e.target.closest('#tapBtn')) {
      const res = L.tapTempo(taps, performance.now());
      taps = res.taps;
      if (res.bpm) setBpm(res.bpm);
      pulseBeat();
    }
  });
  const stopHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  window.addEventListener('pointerup', stopHold);
  window.addEventListener('pointercancel', stopHold);
  document.addEventListener('pointerleave', (e) => {
    if (e.target instanceof Element && e.target.matches('[data-bpm-step]')) stopHold();
  }, true);

  // To samo z klawiatury (Enter / spacja daje click bez pointerdown)
  document.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const step = e.target.closest('[data-bpm-step]');
    if (step) setBpm(Number($('#bpm').value) + Number(step.dataset.bpmStep));
    if (e.target.closest('#tapBtn')) {
      const res = L.tapTempo(taps, performance.now());
      taps = res.taps;
      if (res.bpm) setBpm(res.bpm);
      pulseBeat();
    }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('#metroBtn');
    if (!b) return;
    if (metro.running) { metro.stop(); return; }
    const s = songById(state.route.id);
    metro.start(s ? s.bpm : 120, pulseBeat);
    b.setAttribute('aria-pressed', 'true');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!sheet.hidden) { if (!sheetLocked) closeSheet(); }
      else if (player.open) player.hide();
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.code === 'Space' && !typing && sheet.hidden && player.item && player.item.type !== 'spotify') {
      e.preventDefault();
      player.toggle();
    }
  });

  function onScroll() {
    const bar = $('.topbar', view);
    if (bar) bar.classList.toggle('scrolled', window.scrollY > 70);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('hashchange', () => { if (!sheet.hidden && !sheetLocked) closeSheet(); render(); });

  // Zapisz zaległe zmiany przy zamykaniu karty
  window.addEventListener('pagehide', () => {
    for (const [id, timer] of saveTimers) { clearTimeout(timer); const s = songById(id); if (s) Store.put('songs', s); }
  });

  /* ======================= Start ======================= */

  load().then(() => {
    Store.persist();
    render();
  }).catch((e) => {
    view.innerHTML = '<div class="empty"><strong>Nie udało się otworzyć bazy danych</strong><p>' +
      'Ta przeglądarka blokuje zapis (np. tryb prywatny). Otwórz stronę w zwykłym oknie.</p></div>';
    console.error(e);
  });
})();
