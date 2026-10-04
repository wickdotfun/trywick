// Petits outils partagés par les pages du site.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const short = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
export const fmt = (n) => n.toLocaleString('en-US');
export const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const sol = (n) => `${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: n >= 10 ? 1 : n >= 1 ? 2 : 4 })} SOL`;
// Une durée lisible : « 1 minute », « 30 minutes », « 6 seconds ».
export function span(ms) {
  if (ms >= 60_000) { const m = Math.round(ms / 6_000) / 10; return `${m} ${m === 1 ? 'minute' : 'minutes'}`; }
  const s = Math.round(ms / 1000);
  return `${s} ${s === 1 ? 'second' : 'seconds'}`;
}
export const solscan = (sig) => `https://solscan.io/tx/${sig}`;
export const pumpUrl = (mint) => `https://pump.fun/coin/${mint}`;

export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Les icônes du site : de simples traits (couleur du texte), à la place des emojis.
const ICONS = {
  flame: '<path d="M12 2.8c.5 3 4.7 5 4.7 9.9a4.7 4.7 0 1 1-9.4 0c0-2.4 1.2-3.6 1.9-5 .6 1.4 1.5 2.1 2.6 2.4-.4-2.6.2-4.9.2-7.3z"/>',
  rocket: '<path d="M5 15c-1.4 1.2-1.9 4.6-1.9 4.6s3.4-.5 4.6-1.9c.7-.8.6-2-.1-2.7a1.9 1.9 0 0 0-2.6 0z"/><path d="m12 15-3-3a20 20 0 0 1 1.8-3.6A11.6 11.6 0 0 1 20.8 3.2c0 2.5-.7 6.8-5.4 9.9A20 20 0 0 1 12 15z"/><path d="M9 12H5s.5-2.7 1.8-3.6C7.3 7.4 10.4 8 10.4 8M12 15v4s2.7-.5 3.6-1.8c1-1.5 0-4.6 0-4.6"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  candle: '<rect x="9" y="9.5" width="6" height="11" rx="1"/><path d="M12 9.5V7.6M12 3.2c.9 1 1.3 1.8 1.3 2.4a1.3 1.3 0 0 1-2.6 0c0-.6.4-1.4 1.3-2.4z"/>',
  crown: '<path d="m3 8 4.5 4 4.5-7 4.5 7L21 8l-2 11H5z"/>',
  wind: '<path d="M3 9h10.5a2.8 2.8 0 1 0-2.8-2.8M3 13h15a2.8 2.8 0 1 1-2.8 2.8M3 17h7"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5.5h3v1.8a3 3 0 0 1-3 3M7 5.5H4v1.8a3 3 0 0 0 3 3"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  star: '<path d="m12 3.5 2 5.6 5.7 1.4-5.7 1.9-2 5.6-2-5.6-5.7-1.9 5.7-1.4z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.5M12 16.8v.1"/>',
  chart: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  zap: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  mountain: '<path d="M2.5 20 9 8.5l3.5 5 2.5-3.5 6.5 10z"/>',
  dashboard: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pillar: '<path d="M3 21h18M5 21V10M19 21V10M9.5 21V10M14.5 21V10M2.5 10 12 3.5l9.5 6.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  keeper: '<rect x="5" y="9.5" width="14" height="10" rx="3"/><path d="M9.5 14.5h.01M14.5 14.5h.01M12 9.5V7M12 2.8c.8.9 1.2 1.6 1.2 2.2a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.3 1.2-2.2z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
// Le logo d'un modèle d'IA (Meta, OpenAI…), servi depuis /brand/ai/.
export const aiLogo = (m, size = 16) => (m?.logo
  ? `<img class="ai-logo" src="${esc(m.logo)}" alt="${esc(m.by)}" width="${size}" height="${size}" loading="lazy" decoding="async">`
  : `<span class="ai-logo mono">${esc(String(m?.by || '?').slice(0, 2))}</span>`);
// La rangée des six modèles qui font tourner les Keepers.
export const aiLogos = (models = [], size = 18) => `<span class="ai-logos">${models.map((m) => `<span class="ai-chip" title="${esc(`${m.name} by ${m.by}`)}">${aiLogo(m, size)}</span>`).join('')}</span>`;

export function icon(name, cls = '') {
  return `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.flame}</svg>`;
}
