// Les allumettes vivantes : le market cap de chaque coin lancé sur WICK, lu sur DexScreener
// (gratuit, sans clé), avec son volume sur 24 h. Le cron rafraîchit chaque minute les coins de la bougie en cours et
// ceux des dernières 24 h, les plus anciennement vus d'abord.
const API = 'https://api.dexscreener.com/tokens/v1/solana/';
const BATCH = 30;            // DexScreener accepte 30 adresses par requête
const PER_RUN = 60;

// Pour chaque coin, la paire la plus liquide : son market cap et sa variation sur 24 h.
export function pickMarkets(pairs) {
  const best = new Map();
  for (const p of pairs || []) {
    const mint = p?.baseToken?.address;
    if (!mint) continue;
    const liq = p.liquidity?.usd ?? 0;
    const prev = best.get(mint);
    if (!prev || liq > prev.liq) {
      best.set(mint, { liq, mcap: p.marketCap ?? p.fdv ?? null, change: p.priceChange?.h24 ?? null, vol: p.volume?.h24 ?? null });
    }
  }
  return best;
}

export async function refreshMarkets(env, now, openCycleId) {
  const { results } = await env.DB.prepare(
    `SELECT mint FROM matches WHERE seq IS NOT NULL AND (cycle = ? OR lit_at > ?)
     ORDER BY mcap_at ASC LIMIT ?`,
  ).bind(openCycleId ?? -1, now - 24 * 3600_000, PER_RUN).all();
  let updated = 0;
  for (let i = 0; i < results.length; i += BATCH) {
    const mints = results.slice(i, i + BATCH).map((r) => r.mint);
    let pairs;
    try {
      const res = await fetch(API + mints.join(','), { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`dexscreener_${res.status}`);
      pairs = await res.json();
    } catch (err) {
      console.log('markets', err.message);
      return updated;
    }
    const found = pickMarkets(pairs);
    await env.DB.batch(mints.map((mint) => {
      const m = found.get(mint);
      return m
        ? env.DB.prepare(
          `UPDATE matches SET mcap = ?, change24h = ?, vol24h = ?, mcap_at = ?,
             mcap_peak = MAX(COALESCE(mcap_peak, 0), COALESCE(?, 0)), vol_peak = MAX(COALESCE(vol_peak, 0), COALESCE(?, 0))
           WHERE mint = ?`,
        ).bind(m.mcap, m.change, m.vol, now, m.mcap, m.vol, mint)
        : env.DB.prepare('UPDATE matches SET mcap_at = ? WHERE mint = ?').bind(now, mint);
    }));
    updated += found.size;
  }
  return updated;
}
