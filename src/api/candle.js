// GET /api/candle?id=12 : la fiche publique d'une bougie (sa page de profil).
import { json } from '../../lib/http.js';
import { getMarket } from '../../lib/market.js';
import { ensureSchema } from '../../lib/schema.js';
import { candleEvents } from '../../lib/store.js';
import { candleById, candleView, freshCandle } from '../../lib/world.js';

export async function onRequestGet({ request, env }) {
  const now = Date.now();
  await ensureSchema(env.DB);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);
  const market = await getMarket(env, now);
  const candle = await freshCandle(env, await candleById(env.DB, id), now, market.mood);
  if (!candle) return json({ error: 'not_found' }, 404);
  const db = env.DB;
  const [rank, owner, story] = await Promise.all([
    // Sa place parmi les plus vieilles flammes encore allumées.
    candle.diedAt ? null : db.prepare('SELECT COUNT(*) AS n FROM candles WHERE died_at IS NULL AND born_at < ?').bind(candle.bornAt).first(),
    db.prepare('SELECT p.torches AS torches, p.x_handle AS x, (SELECT COUNT(*) FROM candles WHERE player_id = p.id) AS lit FROM players p WHERE p.id = ?').bind(candle.playerId).first(),
    candleEvents(db, id),
  ]);
  return json({
    candle: candleView(candle, now, market.mood),
    profile: {
      rank: rank ? rank.n + 1 : null,
      torches: owner?.torches ?? 0,
      lit: owner?.lit ?? 1,
      // Le compte X lié par la quête « Claim your candle » (public, choisi par le joueur).
      x: owner?.x ?? null,
      story,
    },
  });
}
