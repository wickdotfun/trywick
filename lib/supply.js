// La part de la supply de $WICK brûlée par WICK : ce qu'on a brûlé, rapporté à la supply de
// départ (la supply actuelle + ce qu'on avait brûlé au moment de la lecture). La supply de
// départ ne bouge pas : on la relit toutes les 5 minutes, et la part brûlée, elle, est
// recalculée à chaque fois avec le total des burns (la bougie fond dès qu'un burn passe).
import { rpc } from './solana.js';

let cache = null;

export async function burnedTotal(db) {
  const row = await db.prepare("SELECT COALESCE(SUM(burned_ui), 0) AS burned FROM burns WHERE kind != 'coin' AND status = 'burned'").first();
  return row.burned;
}

export async function originalSupply(env, now, burned) {
  if (!env.TOKEN_MINT) return null;
  if (cache && cache.mint === env.TOKEN_MINT && now - cache.at < 5 * 60_000) return cache.original;
  try {
    const res = await rpc(env, 'getTokenSupply', [env.TOKEN_MINT, { commitment: 'confirmed' }]);
    const supply = Number(res.value.uiAmountString ?? res.value.uiAmount);
    const original = supply + (burned ?? (await burnedTotal(env.DB)));
    cache = { mint: env.TOKEN_MINT, at: now, original };
    return original;
  } catch {
    return cache?.original ?? null;
  }
}

// { burned, original, pct } : pct = la part de la supply brûlée, en %, ou 0 avant $WICK.
export async function supplyBurned(env, now) {
  const burned = await burnedTotal(env.DB);
  const original = await originalSupply(env, now, burned);
  return { burned, original, pct: original ? (burned / original) * 100 : 0 };
}
