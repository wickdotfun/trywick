// GET /api/candle?id=12 : la fiche publique d'une bougie (pour la partager).
import { json } from '../../lib/http.js';
import { getMarket } from '../../lib/market.js';
import { ensureSchema } from '../../lib/schema.js';
import { candleById, candleView, freshCandle } from '../../lib/world.js';

export async function onRequestGet({ request, env }) {
  const now = Date.now();
  await ensureSchema(env.DB);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);
  const market = await getMarket(env, now);
  const candle = await freshCandle(env, await candleById(env.DB, id), now, market.mood);
  if (!candle) return json({ error: 'not_found' }, 404);
  return json({ candle: candleView(candle, now, market.mood) });
}
