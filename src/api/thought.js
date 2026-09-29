// GET /api/thought?lang=fr : la pensée du moment des bougies (écrite par Claude,
// partagée entre tous les visiteurs, renouvelée toutes les 10 minutes).
import { json } from '../../lib/http.js';
import { getMarket } from '../../lib/market.js';
import { ensureSchema } from '../../lib/schema.js';
import { getThought } from '../../lib/thought.js';
import { community } from '../../lib/world.js';

export async function onRequestGet({ request, env }) {
  const now = Date.now();
  await ensureSchema(env.DB);
  const lang = new URL(request.url).searchParams.get('lang');
  const market = await getMarket(env, now);
  const { stats } = await community(env, now);
  return json(await getThought(env, stats, market, lang, now));
}
