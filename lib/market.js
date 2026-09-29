// Le prix du coin, via l'API publique de DexScreener (sans clé).
// Mis en cache une minute en base pour ne pas la marteler.
import { CONFIG } from './config.js';
import { moodFor } from './candles.js';
import { getKv, setKv } from './store.js';

const API = 'https://api.dexscreener.com/tokens/v1/solana/';

// Parmi toutes les paires, on garde celle où notre token est la base et
// qui a le plus de liquidité (ou de volume, tant qu'il est sur la courbe pump.fun).
export function pickPair(pairs, mint) {
  const own = (pairs || []).filter((p) => p?.baseToken?.address === mint);
  if (!own.length) return null;
  const weight = (p) => (p.liquidity?.usd ?? 0) * 1e6 + (p.volume?.h24 ?? 0);
  return own.reduce((best, p) => (weight(p) > weight(best) ? p : best));
}

async function fetchMarket(mint) {
  const res = await fetch(API + mint, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  const pair = pickPair(await res.json(), mint);
  if (!pair) return null;
  return {
    symbol: pair.baseToken.symbol,
    priceUsd: Number(pair.priceUsd) || null,
    change1h: pair.priceChange?.h1 ?? null,
    change24h: pair.priceChange?.h24 ?? null,
    marketCap: pair.marketCap ?? pair.fdv ?? null,
    volume24h: pair.volume?.h24 ?? null,
    liquidity: pair.liquidity?.usd ?? null,
    url: pair.url ?? null,
  };
}

export async function getMarket(env, now) {
  const mint = env.TOKEN_MINT || CONFIG.fallbackMint;
  const tracking = env.TOKEN_MINT ? 'token' : 'sol';

  // En local, on peut forcer une humeur : DEV_CHANGE=-12 → panique.
  if (env.DEV_CHANGE !== undefined && env.DEV_CHANGE !== '') {
    const change1h = Number(env.DEV_CHANGE);
    return { tracking, mint, symbol: 'DEV', change1h, mood: moodFor(change1h), fresh: true };
  }

  const cached = await getKv(env.DB, 'market');
  if (cached && cached.mint === mint && now - cached.at < CONFIG.marketCacheMs) return cached;

  try {
    const data = await fetchMarket(mint);
    const market = { tracking, mint, ...(data || {}), mood: moodFor(data?.change1h), at: now };
    await setKv(env.DB, 'market', market);
    return market;
  } catch {
    // DexScreener ne répond pas : on garde la dernière valeur connue, sinon calme.
    return cached ?? { tracking, mint, change1h: null, mood: 'calme', at: now };
  }
}
