/*
 * UI for the rehearsal-room checker: loads availability.json (published by
 * the GitHub Action to the sale-prob-data branch) and shows which rooms are
 * free for the chosen day and hours.
 */
(function () {
  'use strict';

  const A = window.Availability;
  const HOUR = A.HOUR;

  // Raw files from GitHub are served with CORS headers, unlike the booking
  // systems themselves. ?data=<url> overrides it for local testing.
  const DATA_URL = new URLSearchParams(location.search).get('data') ||
    'https://raw.githubusercontent.com/tomaszsimborski/appsideas/sale-prob-data/availability.json';
  const STALE_AFTER = 3 * HOUR;
  const TIMELINE_FROM = 8; // first hour drawn on the day timeline
  const SETTINGS_KEY = 'sale-prob-settings';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const range = (a, b) => (a <= b ? `${A.formatTime(a)}–${A.formatTime(b)}` : '');

  let data = null;

  // --- Settings (remembered per browser; the page works without them) ---

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings() {
    const hiddenVenues = [...$('venues').querySelectorAll('input')].filter((c) => !c.checked).map((c) => c.value);
    const settings = { start: +$('start').value, hours: +$('hours').value, hiddenVenues, onlyFree: $('onlyFree').checked };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  // --- Form ---

  function buildForm(settings) {
    for (let h = 0; h < 24; h++) $('start').append(new Option(`${String(h).padStart(2, '0')}:00`, h));
    for (let h = 1; h <= 6; h++) $('hours').append(new Option(`${h} h`, h));
    $('start').value = settings.start != null ? settings.start : 19;
    $('hours').value = settings.hours || 3;
    $('onlyFree').checked = !!settings.onlyFree;

    const today = A.warsawDay(Date.now());
    $('day').value = new URLSearchParams(location.search).get('day') || today;
    $('day').min = today;

    $('form').addEventListener('input', () => { saveSettings(); render(); });
  }

  function buildVenueFilter(settings) {
    const hidden = new Set(settings.hiddenVenues || []);
    for (const venue of data.venues) {
      const label = el('label', 'chip');
      const box = el('input');
      box.type = 'checkbox';
      box.value = venue.id;
      box.checked = !hidden.has(venue.id);
      label.append(box, document.createTextNode(venue.name));
      $('venues').append(label);
    }
  }

  // --- Results ---

  function render() {
    const results = $('results');
    results.textContent = '';
    if (!data) return;

    const day = $('day').value;
    if (!day) return setStatus('Wybierz dzień.');
    if (!A.covers(data, day)) {
      const last = A.warsawDay(A.warsawTime(data.to, -12));
      return setStatus(`Mam grafiki tylko od ${formatDay(data.from, false)} do ${formatDay(last, false)}.`, 'warn');
    }

    const startHour = +$('start').value;
    const hours = +$('hours').value;
    const start = A.warsawTime(day, startHour);
    const end = A.warsawTime(day, startHour + hours);
    const dayFrom = A.warsawTime(day, 0);
    const dayTo = A.warsawTime(day, 24);
    const shown = new Set([...$('venues').querySelectorAll('input:checked')].map((c) => c.value));
    const onlyFree = $('onlyFree').checked;

    const groups = A.checkRooms(data, start, end, dayFrom, dayTo).filter((g) => shown.has(g.venue.id));
    const all = groups.flatMap((g) => g.rooms);
    const free = all.filter((r) => r.free).length;

    let note = `${formatDay(day)}, ${range(start, end)}: wolne ${free} z ${all.length} sal.`;
    if (start < Date.now()) note += ' Ten termin już się zaczął.';
    setStatus(note, free ? 'ok' : 'warn');

    const view = { start, end, from: A.warsawTime(day, Math.min(TIMELINE_FROM, startHour)), to: Math.max(dayTo, end) };
    for (const group of groups) {
      // Free rooms first; sort is stable so each venue keeps its own order.
      const rooms = group.rooms.filter((r) => !onlyFree || r.free).sort((a, b) => b.free - a.free);
      if (!rooms.length) continue;
      const section = el('section', 'venue');
      const head = el('div', 'venue-head');
      head.append(el('h2', null, group.venue.name));
      const link = el('a', 'book', 'Rezerwuj →');
      link.href = group.venue.bookingUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      head.append(link);
      section.append(head);
      const list = el('div', 'rooms');
      for (const r of rooms) list.append(roomCard(r, view));
      section.append(list);
      results.append(section);
    }
  }

  function roomCard(result, view) {
    const { room } = result;
    const card = el('article', 'room ' + (result.free ? 'is-free' : 'is-busy'));

    const head = el('div', 'room-head');
    head.append(el('h3', null, room.name), el('span', 'pill', result.free ? 'Wolna' : 'Zajęta'));
    card.append(head);
    card.append(el('p', 'meta', [room.address, room.price].filter(Boolean).join(' · ')));
    card.append(timeline(room.busy, view));

    if (!result.free) {
      card.append(el('p', 'detail', 'Zajęte: ' + result.conflicts.map(([s, e]) => range(s, e)).join(', ')));
      if (result.alternative) {
        const [s, e] = result.alternative;
        const p = el('p', 'detail');
        const alt = el('button', 'link', range(s, e));
        alt.type = 'button';
        alt.title = 'Ustaw tę godzinę';
        alt.addEventListener('click', () => {
          $('start').value = parseInt(A.formatTime(s), 10);
          saveSettings();
          render();
        });
        p.append(document.createTextNode('Najbliżej wolne tego dnia: '), alt);
        card.append(p);
      } else {
        card.append(el('p', 'detail', 'Tego dnia nie ma już tak długiego wolnego okna.'));
      }
    }
    return card;
  }

  // Day strip: busy bookings in red, the chosen time as an outline.
  function timeline(busy, view) {
    const span = view.to - view.from;
    const pct = (ms) => `${((Math.min(Math.max(ms, view.from), view.to) - view.from) / span) * 100}%`;
    const wrap = el('div', 'timeline');
    const bar = el('div', 'bar');
    for (const [s, e] of A.conflicts(busy, view.from, view.to)) {
      const b = el('div', 'busy');
      b.style.left = pct(s);
      b.style.right = `calc(100% - ${pct(e)})`;
      b.title = range(s, e);
      bar.append(b);
    }
    const pick = el('div', 'pick');
    pick.style.left = pct(view.start);
    pick.style.right = `calc(100% - ${pct(view.end)})`;
    bar.append(pick);
    wrap.append(bar);

    const ticks = el('div', 'ticks');
    for (let t = view.from; t <= view.to; t += 4 * HOUR) {
      const tick = el('span', null, A.formatTime(t).slice(0, 2));
      tick.style.left = pct(t);
      ticks.append(tick);
    }
    wrap.append(ticks);
    return wrap;
  }

  function setStatus(text, kind) {
    $('status').textContent = text;
    $('status').className = 'status' + (kind ? ' ' + kind : '');
  }

  const formatDay = (day, withWeekday = true) => new Date(day + 'T12:00:00Z').toLocaleDateString('pl-PL', {
    weekday: withWeekday ? 'long' : undefined, day: 'numeric', month: 'long', timeZone: 'UTC',
  });

  function showUpdated() {
    const at = Date.parse(data.updatedAt);
    const when = new Date(at).toLocaleString('pl-PL', {
      timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    let text = `Grafiki pobrane ${when}.`;
    if (Date.now() - at > STALE_AFTER) text += ' To dość dawno, więc wyniki mogą być nieaktualne.';
    for (const err of data.errors || []) text += ' ' + err + '.';
    $('updated').textContent = text;
  }

  // --- Start ---

  const settings = loadSettings();
  buildForm(settings);
  fetch(DATA_URL + (DATA_URL.includes('?') ? '&' : '?') + 't=' + Date.now())
    .then((res) => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then((json) => {
      data = json;
      $('day').max = A.warsawDay(A.warsawTime(data.to, -12));
      buildVenueFilter(settings);
      showUpdated();
      render();
    })
    .catch(() => setStatus('Nie udało się wczytać grafików. Spróbuj odświeżyć stronę za chwilę.', 'warn'));
})();
