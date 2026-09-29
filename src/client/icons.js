// Les icônes du site : de simples traits SVG, qui prennent la couleur du texte.
const svg = (d, extra = '') => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;

export const ICONS = {
  // Gestes
  nourrir: svg('<path d="M12 3c3.5 4.2 5.5 7.2 5.5 10a5.5 5.5 0 0 1-11 0C6.5 10.2 8.5 7.2 12 3z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>'),
  abri: svg('<path d="M12 3 5 6v5.5c0 4.2 3 7.6 7 9.5 4-1.9 7-5.3 7-9.5V6l-7-3z"/><path d="m9 12 2 2 4-4"/>'),
  gratter: svg('<path d="M4 20 15 9"/><path d="M15.5 4.5c1.8-.4 3.6.6 4 2.4.4 1.8-.6 3.6-2.4 4l-2.6-3.8 1-2.6z"/><path d="M6 15l3 3"/>'),
  // Divers
  flame: svg('<path d="M12 2.5c-3.6 4.2-6 7.4-6 10.8a6 6 0 0 0 12 0c0-2-1-3.8-2.3-5.5-.3 1.5-1 2.6-2.1 3.2.3-3.1-.3-5.8-1.6-8.5z"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>'),
  book: svg('<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5v-15z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20"/><path d="M8 7h8M8 11h6"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2 2M15 8l2 2"/>'),
  arrow: svg('<path d="M7 17 17 7M8 7h9v9"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  wind: svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
  pulse: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  skull: svg('<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="11.5" r="1.3"/><circle cx="15" cy="11.5" r="1.3"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
  share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/>'),
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  photo: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  quest: svg('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>'),
  dice: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  // Le logo d'X est plein (pas un trait).
  x: '<svg class="ico ico-fill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3z"/></svg>',
  lock: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'),
};

ICONS.light = ICONS.gratter;
ICONS.relight = ICONS.gratter;
ICONS.adopt = ICONS.gratter;
