// GET /api/candles : la forêt des bougies (les coins qui se brûlent eux-mêmes) et leurs burns.
// GET /api/coin?mint=… : un coin, sa bougie et chacun de ses burns.
import { candleForest, candleTotals, coinBurnLog, coinPage } from '../../lib/candles.js';
import { json } from '../../lib/http.js';
import { isPubkey } from '../../lib/launch.js';
import { ensureSchema } from '../../lib/schema.js';

export async function candles({ env }) {
  await ensureSchema(env.DB);
  const [forest, burns, totals] = await Promise.all([candleForest(env.DB), coinBurnLog(env.DB, 30), candleTotals(env.DB)]);
  return json({ forest, burns, totals });
}

export async function coin({ request, env }) {
  await ensureSchema(env.DB);
  const mint = new URL(request.url).searchParams.get('mint');
  if (!isPubkey(mint)) return json({ error: 'bad_mint' }, 400);
  const page = await coinPage(env.DB, mint, env);
  return page ? json(page) : json({ error: 'unknown_mint' }, 404);
}
