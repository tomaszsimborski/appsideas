/*
 * Warsztat utworów: czyste funkcje bez dostępu do DOM, żeby działały w
 * przeglądarce (window.WarsztatLib) i w Node (testy).
 */
(function (root) {
  'use strict';

  const STATUSES = [
    { key: 'motyw', label: 'Motyw' },
    { key: 'koncept', label: 'Koncept' },
    { key: 'forma', label: 'Forma' },
    { key: 'dopracowywanie', label: 'Dopracowywanie' },
    { key: 'zrobione', label: 'Zrobione' },
    { key: 'nagrane', label: 'Nagrane' },
  ];

  const FOLDERS = [
    { key: 'proby', label: 'Nagrania z prób', short: 'Próby', icon: 'i-mic' },
    { key: 'motywy', label: 'Motywy i riffy', short: 'Riffy', icon: 'i-guitar' },
    { key: 'inspiracje', label: 'Inspiracje', short: 'Inspiracje', icon: 'i-spark' },
    { key: 'daw', label: 'Szkice z DAW', short: 'DAW', icon: 'i-wave' },
  ];

  const LAYERS = [
    { key: 'lyrics', label: 'Tekst', placeholder: 'Tekst do śpiewania…\n\n[Zwrotka 1]\n' },
    { key: 'chords', label: 'Akordy', placeholder: 'Akordy i struktura…\n\nZwrotka:  Am  F  C  G\nRefren:   F  G  Am  Am' },
    { key: 'notes', label: 'Notatki', placeholder: 'Pomysły, brzmienie, kto co gra, co poprawić…' },
  ];

  const MIN_BPM = 30;
  const MAX_BPM = 300;

  function statusIndex(key) {
    const i = STATUSES.findIndex((s) => s.key === key);
    return i < 0 ? 0 : i;
  }

  function statusLabel(key) {
    return STATUSES[statusIndex(key)].label;
  }

  function folderOf(key) {
    return FOLDERS.find((f) => f.key === key) || FOLDERS[0];
  }

  function clampBpm(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 120;
    return Math.min(MAX_BPM, Math.max(MIN_BPM, n));
  }

  /**
   * Tempo z kolejnych stuknięć (czasy w ms). Liczy średni odstęp z ostatnich
   * stuknięć; dłuższa przerwa (> 2 s) zaczyna liczenie od nowa.
   * Zwraca { taps, bpm } (bpm = null, gdy za mało stuknięć).
   */
  function tapTempo(taps, now, maxTaps = 8, resetMs = 2000) {
    let list = taps.slice();
    if (list.length && now - list[list.length - 1] > resetMs) list = [];
    list.push(now);
    if (list.length > maxTaps) list = list.slice(-maxTaps);
    if (list.length < 2) return { taps: list, bpm: null };
    const span = list[list.length - 1] - list[0];
    const avg = span / (list.length - 1);
    return { taps: list, bpm: clampBpm(60000 / avg) };
  }

  /**
   * Rozpoznaje link albo URI Spotify. Zwraca { kind, id, url, embed } lub null.
   * Obsługuje open.spotify.com/(intl-xx/)track|album|playlist|episode|artist/ID
   * oraz spotify:track:ID.
   */
  function parseSpotify(input) {
    if (!input) return null;
    const s = String(input).trim();
    const kinds = 'track|album|playlist|episode|show|artist';
    let m = s.match(new RegExp('^spotify:(' + kinds + '):([A-Za-z0-9]{10,40})$'));
    if (!m) {
      m = s.match(new RegExp(
        '^(?:https?://)?open\\.spotify\\.com/(?:intl-[a-z]{2}(?:-[a-z]{2})?/)?(?:embed/)?(' +
        kinds + ')/([A-Za-z0-9]{10,40})(?:[/?#].*)?$', 'i'));
    }
    if (!m) return null;
    const kind = m[1].toLowerCase();
    const id = m[2];
    return {
      kind,
      id,
      url: 'https://open.spotify.com/' + kind + '/' + id,
      embed: 'https://open.spotify.com/embed/' + kind + '/' + id,
    };
  }

  const SPOTIFY_KIND_LABEL = {
    track: 'Utwór', album: 'Album', playlist: 'Playlista',
    episode: 'Odcinek', show: 'Podcast', artist: 'Artysta',
  };

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + r : m + ':' + r;
  }

  function plural(n, one, few, many) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n === 1) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function countLabel(n, one, few, many) {
    return n + ' ' + plural(n, one, few, many);
  }

  /** Względna data po polsku: „przed chwilą”, „5 min temu”, „wczoraj”, „12 lis”. */
  function relativeDate(ts, now = Date.now()) {
    const diff = now - ts;
    if (diff < 60e3) return 'przed chwilą';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' min temu';
    const d = new Date(ts);
    const n = new Date(now);
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day(n) - day(d)) / 86400e3);
    if (days === 0) return 'dziś ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    if (days === 1) return 'wczoraj';
    if (days < 7) return days + ' dni temu';
    const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
    const base = d.getDate() + ' ' + months[d.getMonth()];
    return d.getFullYear() === n.getFullYear() ? base : base + ' ' + d.getFullYear();
  }

  function defaultRecordingTitle(date = new Date()) {
    const p = (x) => String(x).padStart(2, '0');
    return 'Nagranie ' + p(date.getDate()) + '.' + p(date.getMonth() + 1) + ' ' +
      p(date.getHours()) + ':' + p(date.getMinutes());
  }

  function fileTitle(name) {
    return String(name || 'Plik').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim() || 'Plik';
  }

  /** Utwory pasujące do filtra statusu i wyszukiwania, od ostatnio zmienianych. */
  function filterSongs(songs, { status = 'all', query = '' } = {}) {
    const q = norm(query);
    return songs
      .filter((s) => status === 'all' || s.status === status)
      .filter((s) => !q || norm(s.title).includes(q) || norm(s.lyrics).includes(q) ||
        norm(s.notes).includes(q))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l');
  }

  /** Szczyty fali (0..1) z próbek, do rysowania miniatury nagrania. */
  function peaks(samples, buckets) {
    const out = new Array(buckets).fill(0);
    if (!samples || !samples.length) return out;
    const size = samples.length / buckets;
    let max = 0;
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor(b * size);
      const end = Math.min(samples.length, Math.floor((b + 1) * size));
      let m = 0;
      const step = Math.max(1, Math.floor((end - start) / 200));
      for (let i = start; i < end; i += step) {
        const v = Math.abs(samples[i]);
        if (v > m) m = v;
      }
      out[b] = m;
      if (m > max) max = m;
    }
    return max > 0 ? out.map((v) => Math.round((v / max) * 1000) / 1000) : out;
  }

  const api = {
    STATUSES, FOLDERS, LAYERS, MIN_BPM, MAX_BPM, SPOTIFY_KIND_LABEL,
    statusIndex, statusLabel, folderOf, clampBpm, tapTempo, parseSpotify,
    formatTime, plural, countLabel, relativeDate, defaultRecordingTitle,
    fileTitle, filterSongs, norm, peaks,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WarsztatLib = api;
})(typeof window !== 'undefined' ? window : this);
