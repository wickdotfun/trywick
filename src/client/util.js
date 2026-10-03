// Petits outils partagés par les pages du site.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const short = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
export const fmt = (n) => n.toLocaleString('en-US');
export const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const sol = (n) => `${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: n >= 10 ? 1 : 2 })} SOL`;
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
