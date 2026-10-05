// L'IA, côté API (lib/spark.js) :
//   POST /api/spark        { idea, style, model } → le coin inventé par le Keeper
//   POST /api/spark/image  { visual, name }       → son logo (image/jpeg)
//   POST /api/ask          { mint | 'wick', question } → la réponse du Keeper
import { ipHash, json } from '../../lib/http.js';
import { ensureSchema } from '../../lib/schema.js';
import { askKeeper, sparkCoin, sparkImage } from '../../lib/spark.js';

const STATUS = { bad_idea: 400, blocked_idea: 400, bad_question: 400, unknown_coin: 404, too_many: 429, ai_busy: 503, ai_off: 503, ai_failed: 502 };
const fail = (error) => json({ error }, STATUS[error] || 400);
const body = (request) => request.json().catch(() => null);

export async function spark({ request, env }) {
  await ensureSchema(env.DB);
  const b = await body(request);
  const res = await sparkCoin(env, { idea: b?.idea, style: b?.style, model: b?.model, surprise: b?.surprise === true, ip: await ipHash(request, env) });
  return res.error ? fail(res.error) : json(res.value);
}

export async function sparkLogo({ request, env }) {
  await ensureSchema(env.DB);
  const b = await body(request);
  const res = await sparkImage(env, { visual: b?.visual, name: b?.name, ip: await ipHash(request, env) });
  if (res.error) return fail(res.error);
  return new Response(res.bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
}

export async function ask({ request, env }) {
  await ensureSchema(env.DB);
  const b = await body(request);
  const res = await askKeeper(env, { mint: b?.mint, question: b?.question, ip: await ipHash(request, env) });
  return res.error ? fail(res.error) : json(res.value);
}
