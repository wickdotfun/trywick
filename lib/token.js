// $WICK, le vrai coin, sur sa page du site :
// - son marché (prix, market cap, volume, liquidité), lu sur DexScreener ;
// - sa courbe pump.fun (la part vendue avant de « graduer » sur PumpSwap), lue on-chain ;
// - ses plus gros holders, lus on-chain ;
// - l'achat et la vente depuis le site : PumpPortal construit la transaction pour le wallet du
//   visiteur (pump.fun avant la graduation, PumpSwap après), le wallet signe, le serveur relaie.
//   Le serveur ne relaie que des transactions pump.fun / PumpSwap payées et signées par ce wallet.
import { buybackWallet } from './buyback.js';
import { CONFIG } from './config.js';
import { isPubkey } from './launch.js';
import { readTransaction, rpc } from './solana.js';

const DEX = 'https://api.dexscreener.com/tokens/v1/solana/';
export const PUMPSWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
// Ce que la courbe pump.fun a à vendre au départ (793,1 M de jetons, 6 décimales).
const CURVE_TOKENS = 793_100_000_000_000n;

// La paire de référence : la plus liquide, puis la plus échangée.
export function pickPair(pairs, mint) {
  const mine = (pairs || []).filter((p) => p?.baseToken?.address === mint);
  mine.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0) || (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
  const p = mine[0];
  if (!p) return null;
  return {
    priceUsd: p.priceUsd != null ? Number(p.priceUsd) : null,
    priceSol: p.priceNative != null ? Number(p.priceNative) : null,
    mcap: p.marketCap ?? p.fdv ?? null,
    change: { m5: p.priceChange?.m5 ?? null, h1: p.priceChange?.h1 ?? null, h6: p.priceChange?.h6 ?? null, h24: p.priceChange?.h24 ?? null },
    volume24h: p.volume?.h24 ?? null,
    liquidity: p.liquidity?.usd ?? null,
    buys24h: p.txns?.h24?.buys ?? null,
    sells24h: p.txns?.h24?.sells ?? null,
    dex: p.dexId || null,
    pair: p.pairAddress || null,
    url: p.url || null,
    image: p.info?.imageUrl || null,
    createdAt: p.pairCreatedAt ?? null,
  };
}

// Le compte de la courbe pump.fun : 8 octets d'en-tête, puis les réserves (u64), puis `complete`.
export function readCurve(bytes) {
  if (!bytes || bytes.length < 49) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const realTokens = view.getBigUint64(24, true);
  const realSol = view.getBigUint64(32, true);
  const complete = bytes[48] === 1;
  const left = realTokens > CURVE_TOKENS ? CURVE_TOKENS : realTokens;
  const progress = complete ? 1 : Number(CURVE_TOKENS - left) / Number(CURVE_TOKENS);
  return { progress, complete, sol: Number(realSol) / 1e9 };
}

async function curveOf(env, market) {
  if (!market) return null;
  if (market.dex && market.dex !== 'pumpfun') return { progress: 1, complete: true, sol: null };
  if (!market.pair) return null;
  const res = await rpc(env, 'getAccountInfo', [market.pair, { encoding: 'base64', commitment: 'confirmed' }]);
  // Seulement si c'est bien un compte du programme pump.fun.
  if (!res?.value || res.value.owner !== CONFIG.pumpProgram) return null;
  const bytes = Uint8Array.from(atob(res.value.data[0]), (c) => c.charCodeAt(0));
  return readCurve(bytes);
}

// Les 10 plus gros holders, avec le propriétaire de chaque compte et ce qu'il est.
async function holdersOf(env, mint, supply, market) {
  const largest = await rpc(env, 'getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  const top = (largest?.value || []).slice(0, 12);
  if (!top.length) return [];
  const infos = await rpc(env, 'getMultipleAccounts', [top.map((a) => a.address), { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const buyback = (await buybackWallet(env).catch(() => null))?.publicKey;
  return top.map((a, i) => {
    const owner = infos?.value?.[i]?.data?.parsed?.info?.owner || null;
    const amount = Number(a.uiAmountString ?? a.uiAmount ?? 0);
    let label = null;
    if (owner && owner === market?.pair) label = market.dex === 'pumpfun' ? 'bonding curve' : 'liquidity pool';
    else if (owner && owner === buyback) label = 'WICK buyback';
    return { owner, amount, pct: supply ? (amount / supply) * 100 : null, label };
  }).filter((h) => h.amount > 0).slice(0, 10);
}

let cache = null;
let holderCache = null;

// Tout ce que la page $WICK affiche. Gardé 20 s en mémoire (les holders : 60 s).
export async function tokenView(env, now) {
  const mint = env.TOKEN_MINT;
  if (!mint) return { mint: null };
  if (cache?.mint === mint && now - cache.at < 20_000) return cache.view;

  let market = null;
  try {
    const res = await fetch(DEX + mint, { headers: { accept: 'application/json' } });
    if (res.ok) market = pickPair(await res.json(), mint);
  } catch (err) {
    console.log('token market', err.message);
  }
  const [curve, supply] = await Promise.all([
    curveOf(env, market).catch(() => null),
    rpc(env, 'getTokenSupply', [mint, { commitment: 'confirmed' }])
      .then((r) => Number(r.value.uiAmountString ?? r.value.uiAmount)).catch(() => null),
  ]);
  let holders = holderCache?.mint === mint ? holderCache.list : null;
  if (!holderCache || holderCache.mint !== mint || now - holderCache.at > 60_000) {
    try {
      holders = await holdersOf(env, mint, supply, market);
      holderCache = { mint, at: now, list: holders };
    } catch (err) {
      console.log('token holders', err.message);
    }
  }
  const view = { mint, market, curve, supply, holders };
  cache = { mint, at: now, view };
  return view;
}

// ------------------------------------------------------------ acheter / vendre
export const TRADE = {
  minBuySol: 0.001,
  maxBuySol: 100,
  slippages: [1, 5, 10, 15, 20, 30, 50],
  priorityFeeSol: 0.0002,
};

// { owner, side: 'buy' | 'sell', amount, slippage } → { value } ou { error }.
// Achat : amount en SOL. Vente : amount en % des $WICK du wallet.
export function validateTrade(body) {
  if (!isPubkey(body?.owner)) return { error: 'bad_owner' };
  const side = body.side === 'sell' ? 'sell' : body.side === 'buy' ? 'buy' : null;
  if (!side) return { error: 'bad_side' };
  const amount = Number(body.amount);
  if (side === 'buy' && !(amount >= TRADE.minBuySol && amount <= TRADE.maxBuySol)) return { error: 'bad_amount' };
  if (side === 'sell' && !(amount >= 1 && amount <= 100)) return { error: 'bad_amount' };
  const slippage = Number(body.slippage ?? 10);
  if (!TRADE.slippages.includes(slippage)) return { error: 'bad_slippage' };
  return { value: { owner: body.owner, side, amount: side === 'buy' ? Math.round(amount * 1e6) / 1e6 : Math.round(amount), slippage } };
}

export async function buildTradeTx(env, t) {
  const res = await fetch(CONFIG.pumpPortalUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: t.owner,
      action: t.side,
      mint: env.TOKEN_MINT,
      amount: t.side === 'buy' ? t.amount : `${t.amount}%`,
      denominatedInSol: t.side === 'buy' ? 'true' : 'false',
      slippage: t.slippage,
      priorityFee: TRADE.priorityFeeSol,
      pool: 'auto',
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw Object.assign(new Error('build_failed'), { detail: `HTTP ${res.status} ${detail}`.trim() });
  }
  return new Uint8Array(await res.arrayBuffer());
}

// Une transaction d'achat ou de vente : payée par `owner`, qu'il est le seul à signer, et qui
// passe par pump.fun ou PumpSwap. signed : toutes les signatures doivent être là.
export function checkTradeTx(bytes, { owner, signed = false }) {
  let tx;
  try { tx = readTransaction(bytes); } catch { return 'bad_tx'; }
  if (tx.header.required !== 1 || tx.signatures.length !== 1) return 'bad_tx';
  if (tx.keys[0] !== owner) return 'wrong_payer';
  const programs = tx.instructions.map((ix) => tx.keys[ix.program]);
  if (!programs.some((p) => p === CONFIG.pumpProgram || p === PUMPSWAP_PROGRAM)) return 'not_pump';
  if (signed && tx.signatures[0].every((b) => b === 0)) return 'unsigned';
  return null;
}
