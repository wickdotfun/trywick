// Ce que renvoient toutes les routes : ma bougie, la communauté, le marché.
import { cooldownsFor } from '../../lib/candles.js';
import { publicMarket, tokenInfo } from '../../lib/http.js';
import { getMarket } from '../../lib/market.js';
import { playerFromRequest } from '../../lib/players.js';
import { ensureSchema } from '../../lib/schema.js';
import { allQuests, questStates } from '../../lib/quests.js';
import { getKv, recentEvents } from '../../lib/store.js';
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

// Les quêtes ajoutées par le dev changent rarement : gardées une minute en mémoire.
let extraCache = null;
async function extraQuests(db, now) {
  if (extraCache && now - extraCache.at < 60_000) return extraCache.list;
  extraCache = { at: now, list: (await getKv(db, 'quests.extra')) || [] };
  return extraCache.list;
}
export function forgetQuestCache() { extraCache = null; }

// Les quêtes d'un joueur : la liste complète et l'état de chacune.
export async function loadQuests(env, ctx, now) {
  const quests = allQuests(await extraQuests(env.DB, now));
  const { results } = ctx.player
    ? await env.DB.prepare('SELECT quest, started_at, done_at FROM quests WHERE player_id = ?').bind(ctx.player.row.id).all()
    : { results: [] };
  const rows = new Map(results.map((r) => [r.quest, r]));
  const view = candleView(ctx.candle, now, ctx.market.mood);
  const stats = {
    feedStreak: view?.alive ? view.feedStreak : 0,
    stageIndex: view?.alive ? view.stageIndex : 0,
    feeds: view?.alive ? view.feeds : 0,
    visitStreak: ctx.player?.view.visitStreak ?? 0,
  };
  return { quests, rows, states: questStates(quests, rows, stats, now) };
}

// Pour l'accueil : combien de quêtes faites, et la prochaine.
async function questSummary(env, ctx, now) {
  if (!ctx.player) return null;
  const { states } = await loadQuests(env, ctx, now);
  const cur = states.find((q) => q.status === 'current');
  return {
    done: states.filter((q) => q.status === 'done').length,
    total: states.length,
    current: cur ? { id: cur.id, title: cur.title, rewardMs: cur.rewardMs, ready: Boolean(cur.ready) } : null,
  };
}

export async function snapshot(env, now, ctx) {
  const { market, player, candle } = ctx;
  const [world, feed, rank, quests] = await Promise.all([
    community(env, now), recentEvents(env.DB), rewardRank(env.DB, candle, player?.row), questSummary(env, ctx, now),
  ]);
  return {
    now,
    quests,
    me: player ? { ...player.view, rewardRank: rank } : null,
    candle: candleView(candle, now, market.mood),
    cooldowns: cooldownsFor(candle, now),
    market: publicMarket(market),
    token: tokenInfo(env),
    feed,
    ...world,
  };
}
