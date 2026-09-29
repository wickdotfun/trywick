// Ce que renvoient toutes les routes : ma bougie, la communauté, le marché.
import { cooldownsFor } from '../../lib/candles.js';
import { publicMarket, tokenInfo } from '../../lib/http.js';
import { getMarket } from '../../lib/market.js';
import { playerFromRequest } from '../../lib/players.js';
import { ensureSchema } from '../../lib/schema.js';
import { recentEvents } from '../../lib/store.js';
import { candleView, community, freshCandle, latestCandle, rewardRank, tickWorld } from '../../lib/world.js';

// Prépare une requête : base prête, marché connu, monde à jour, joueur reconnu.
export async function context(request, env, now) {
  await ensureSchema(env.DB);
  const market = await getMarket(env, now);
  await tickWorld(env, now, market.mood);
  const player = await playerFromRequest(env.DB, request, now);
  const candle = player ? await freshCandle(env, await latestCandle(env.DB, player.row.id), now, market.mood) : null;
  return { market, player, candle };
}

export async function snapshot(env, now, { market, player, candle }) {
  const [world, feed, rank] = await Promise.all([
    community(env, now), recentEvents(env.DB), rewardRank(env.DB, candle, player?.row),
  ]);
  return {
    now,
    me: player ? { ...player.view, rewardRank: rank } : null,
    candle: candleView(candle, now, market.mood),
    cooldowns: cooldownsFor(candle, now),
    market: publicMarket(market),
    token: tokenInfo(env),
    feed,
    ...world,
  };
}
