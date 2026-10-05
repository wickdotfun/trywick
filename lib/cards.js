// Les cartes de $WICK (1600 × 900, en SVG) : les images des grands moments, postées sur Telegram
// et X. Le même modèle sert partout :
// - scripts/cards.mjs les dessine d'avance (public/cards/*.png) : lancement, DEX payé, paliers de
//   market cap. Le Worker les poste telles quelles (dessiner sur le serveur coûterait trop de CPU).
// - La page d'admin dessine dans le navigateur celles qui ont des chiffres à elles (tokens lockés).
//
// assets : { logo, wordmark } en data: URI (le logo W et le mot « WICK »).

import { LIBRARY, libraryFile } from './posts.js';
import { hasPostLayout, postSvg } from './postcards.js';

export const W = 1600, H = 900;
export const FONTS = ['Geist-Black.ttf', 'Geist-Bold.ttf', 'Geist-Medium.ttf', 'GeistMono-Medium.ttf'];

// Les paliers de market cap qui ont leur carte (et leur post).
export const MILESTONES = [50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];
export const usdShort = (n) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

// Les cartes dessinées d'avance : fichier, sorte, données (et celles de la bibliothèque de posts).
export function staticCards(ticker = 'WICK') {
  return [
    { file: 'live.png', kind: 'live', data: { ticker } },
    { file: 'dex-paid.png', kind: 'dexpaid', data: { ticker } },
    ...MILESTONES.map((n) => ({ file: `mcap-${usdShort(n).slice(1).toLowerCase()}.png`, kind: 'mcap', data: { ticker, mcap: n } })),
    ...LIBRARY.map((p) => ({ file: libraryFile(p.id), kind: 'post', data: { id: p.id, ticker } })),
  ];
}
export const milestoneFile = (n) => `mcap-${usdShort(n).slice(1).toLowerCase()}.png`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// La taille d'un titre pour qu'il tienne dans sa largeur (estimation : Geist Black ≈ 0,64 em par lettre).
const fit = (text, max, width, em = 0.64) => Math.min(max, Math.floor(width / (Math.max(1, [...text].length) * em)));

const CHECK = 'M5 12.5 9.5 17 19 7.5';
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>';

// Ce que dit chaque carte.
function content(kind, d) {
  const t = `$${d.ticker || 'WICK'}`;
  switch (kind) {
    case 'live':
      return { eyebrow: 'NOW LIVE ON PUMP.FUN', title: `${t} IS LIVE`, sub: 'Every coin gets an agent.',
        chips: ['Its own AI agent', `Every launch burns ${t}`] };
    case 'dexpaid':
      return { eyebrow: 'DEX SCREENER', title: 'DEX PAID', sub: `${t} is official on DEX Screener.`,
        chips: ['Profile live', 'Socials linked', 'Official CA'], check: true };
    case 'mcap':
      return { eyebrow: 'NEW MILESTONE', title: usdShort(d.mcap), sub: `${t} market cap.`,
        chips: ['Every coin gets an agent', `Burning ${t}`] };
    case 'lock': {
      const amount = Math.round(d.amount || 0).toLocaleString('en-US');
      const pct = d.pct ? `${+d.pct.toFixed(2)}% of supply` : null;
      const nc = d.cancelable === false ? ' · non-cancelable' : '';
      return { eyebrow: 'TOKENS LOCKED', title: amount, unit: `${t} LOCKED`, sub: d.until ? `Unlocks ${d.until}${nc}` : `Locked on-chain${nc}.`,
        chips: [pct, d.where || 'Streamflow'].filter(Boolean), lock: true };
    }
    case 'coin': {
      // La carte d'un coin lancé sur WICK (dessinée dans le navigateur, depuis sa page).
      const sym = `$${d.symbol || 'COIN'}`;
      return { eyebrow: 'LIVE ON WICK', title: sym, sub: [d.name, d.mind ? `Agent on ${d.mind}` : null].filter(Boolean).join(' · '),
        chips: [d.burnPct ? `Burns ${d.burnPct}% of its fees` : 'Launched on pump.fun', 'AI agent'], operator: true };
    }
    case 'post':
      // Un post de la bibliothèque (lib/posts.js) : son texte et son icône.
      return { eyebrow: d.eyebrow, title: d.title, sub: d.sub, chips: d.chips || [],
        lock: d.icon === 'lock', operator: d.icon === 'agent', check: d.icon === 'check' };
    default:
      return { eyebrow: '', title: t, sub: '', chips: [] };
  }
}

export function cardSvg(kind, data = {}, assets = {}) {
  // Les posts de la bibliothèque ont chacun leur mise en page (lib/postcards.js).
  if (kind === 'post' && hasPostLayout(data.id)) return postSvg(data.id, data, assets);
  const c = content(kind, data);
  const X = 790, RIGHT = W - 110, width = RIGHT - X;
  const size = fit(c.title, 168, width);
  const titleY = c.unit ? 470 : 500;
  // Les pastilles, côte à côte (largeur estimée : Geist Medium ≈ 0,55 em).
  // Une pastille qui ne tiendrait pas dans la carte n'est pas dessinée.
  let cx = X;
  const chips = c.chips.map((label) => {
    const w = Math.round(label.length * 28 * 0.56 + 80);
    if (cx + w > RIGHT + 30) return '';
    const g = `<g transform="translate(${cx} 640)">
      <rect width="${w}" height="64" rx="32" fill="rgba(255,190,90,0.08)" stroke="rgba(255,196,110,0.38)" stroke-width="2"/>
      <circle cx="34" cy="32" r="13" fill="url(#gold)"/>
      <path d="${CHECK}" transform="translate(22 20)" fill="none" stroke="#1d1003" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="58" y="42" font-family="Geist" font-weight="500" font-size="27" fill="#f6e8d4">${esc(label)}</text>
    </g>`;
    cx += w + 16;
    return g;
  }).join('');
  const icon = c.lock
    ? `<g transform="translate(${X} 268) scale(2.1)" fill="none" stroke="#ffc05a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LOCK}</g>`
    : c.operator
      ? `<g transform="translate(${X} 268)"><rect width="50" height="50" rx="14" fill="url(#gold)"/><g transform="translate(9 8) scale(1.35)" fill="none" stroke="#1d1003" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9.5" width="14" height="10" rx="3"/><path d="M9.5 14.5h.01M14.5 14.5h.01M12 9.5V7M12 2.8c.8.9 1.2 1.6 1.2 2.2a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.3 1.2-2.2z"/></g></g>`
    : c.check
      ? `<g transform="translate(${X} 268)"><circle cx="25" cy="25" r="25" fill="url(#gold)"/><path d="${CHECK}" transform="translate(13 13)" fill="none" stroke="#1d1003" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></g>`
      : `<g transform="translate(${X + 25} 293)"><circle r="12" fill="#3ddc84"/><circle r="22" fill="none" stroke="rgba(61,220,132,0.4)" stroke-width="3"/></g>`;
  const ex = X + 68;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="390" cy="470" r="560" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff8a1c" stop-opacity="0.42"/>
      <stop offset="0.45" stop-color="#b8420a" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#070403" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="1450" cy="40" r="620" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffb347" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#070403" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4d2"/><stop offset="0.3" stop-color="#ffd978"/><stop offset="0.62" stop-color="#f1b440"/><stop offset="1" stop-color="#d0821c"/>
    </linearGradient>
    <linearGradient id="fire" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd27a"/><stop offset="0.5" stop-color="#ffa033"/><stop offset="1" stop-color="#f0700f"/>
    </linearGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M56 0H0V56" fill="none" stroke="rgba(255,200,150,0.045)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="#070403"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#glow2)"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="34" fill="none" stroke="rgba(255,196,110,0.22)" stroke-width="2"/>
  ${assets.coin
    ? `<defs><clipPath id="coinclip"><rect x="150" y="230" width="480" height="480" rx="120"/></clipPath></defs>
  <rect x="140" y="220" width="500" height="500" rx="128" fill="none" stroke="url(#gold)" stroke-width="6" opacity="0.9"/>
  <image x="150" y="230" width="480" height="480" preserveAspectRatio="xMidYMid slice" clip-path="url(#coinclip)" xlink:href="${assets.coin}" href="${assets.coin}"/>`
    : assets.logo ? `<image x="110" y="190" width="560" height="560" xlink:href="${assets.logo}" href="${assets.logo}"/>` : ''}
  ${assets.wordmark ? `<image x="${RIGHT - 250}" y="78" width="250" height="62" xlink:href="${assets.wordmark}" href="${assets.wordmark}"/>` : ''}
  ${icon}
  <text x="${ex}" y="305" font-family="Geist Mono" font-weight="500" font-size="30" letter-spacing="6" fill="#ffc05a">${esc(c.eyebrow)}</text>
  <text x="${X - 4}" y="${titleY}" font-family="Geist" font-weight="900" font-size="${size}" letter-spacing="-2" fill="url(#fire)">${esc(c.title)}</text>
  ${c.unit ? `<text x="${X}" y="${titleY + 78}" font-family="Geist" font-weight="900" font-size="62" letter-spacing="1" fill="#fbf3ea">${esc(c.unit)}</text>` : ''}
  <text x="${X}" y="${c.unit ? 612 : 584}" font-family="Geist" font-weight="500" font-size="${fit(c.sub, c.unit ? 34 : 40, width, 0.52)}" fill="#e9dccb">${esc(c.sub)}</text>
  ${chips}
  <line x1="${X}" y1="770" x2="${RIGHT}" y2="770" stroke="rgba(255,196,110,0.18)" stroke-width="2"/>
  <text x="${X}" y="822" font-family="Geist Mono" font-weight="500" font-size="30" fill="#ffc05a">trywick.fun</text>
  <text x="${RIGHT}" y="822" text-anchor="end" font-family="Geist" font-weight="500" font-size="30" fill="#b6a797">Every coin gets an agent.</text>
</svg>`;
}
