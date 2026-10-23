/*
 * What each room offers, from the venues' own pages (checked October 2026).
 * Keyed by the room ids fetch-data.js writes. area is in m² (null when the
 * venue does not say); drums/keys are true, false or 'extra' (paid rental).
 */
window.ROOM_INFO = {
  // Dźwiękówa, https://dzwiekowa.pl/space/...
  'dzwiekowa-1': { area: 35, drums: true, keys: true },  // Browar: Vision VB Birch, Roland FP-30
  'dzwiekowa-4': {                                       // Bystrzycka 69: Superstar, Roland FP-30
    area: 40, drums: true, keys: true,
    note: 'Pn–pt do 15:00 próby bez perkusji i basu.',
  },
  'dzwiekowa-2': { area: 45, drums: true, keys: true },  // Młyn: Pearl X7, Roland FP-30
  'dzwiekowa-3': { area: 35, drums: true, keys: false }, // Tęczowa A: Pearl Vision VBX
  'dzwiekowa-7': { area: 39, drums: true, keys: false }, // Tęczowa B: Rockstar
  'dzwiekowa-5': { area: 60, drums: true, keys: true },  // Zaklęte Rewiry duża: Superstar, Prestige
  'dzwiekowa-6': {                                       // Zaklęte Rewiry mała: Thomann DP-26
    area: 20, drums: false, keys: true,
    note: 'Sala do prób solo i akustycznych, zamiast perkusji jest cajon.',
  },

  // Plug&Play, https://www.sala-prob.pl/ (sizes given as 7×5 m and 5×5 m)
  'plugandplay-3': { area: 35, drums: true, keys: true }, // Sala 1: Yamaha Stage Custom, Yamaha P35
  'plugandplay-4': { area: 35, drums: true, keys: true }, // Sala 2: Yamaha Stage Custom, Yamaha P35
  'plugandplay-1': { area: 25, drums: true, keys: true }, // Sala A: Pearl Target, Yamaha P35
  'plugandplay-2': { area: 35, drums: true, keys: true }, // Sala B: Yamaha Stage Custom, Yamaha P35

  // Próbówka, https://sala-prob-wroclaw.pl/ (ids are nakiedy.pl service ids)
  'probowka-33259': { area: 25, drums: true, keys: false, note: 'Jest statyw pod klawisze.' }, // Sala A: Mapex M
  'probowka-33311': { area: 35, drums: true, keys: false, note: 'Jest statyw pod klawisze.' }, // Sala B: Mapex Pro M

  // Melodyka, https://saleprobmelodyka.pl/nasz-sprzet
  'melodyka-1': { area: 33, drums: true, keys: true }, // Polmuz Birch 3, M-Audio ProKeys 88

  // Proste i Krzywe, https://prosteikrzywe.pl/red-zone/ etc. (ids are Bookero
  // service ids). No sizes on their site; Red and Green Zone rent keyboards
  // from their backline for 30–50 zł per rehearsal.
  'prosteikrzywe-20536': { area: null, drums: true, keys: 'extra' }, // Red Zone: Pearl Masters
  'prosteikrzywe-20360': { area: null, drums: true, keys: 'extra' }, // Green Zone: Pearl Masters BRX
  'prosteikrzywe-20537': { area: null, drums: true, keys: false },   // X Zone: Tama Superstar Classic
};
