// GET /api/state?since=… : la bougie, ses allumettes (les nouvelles seulement si since est donné).
import { CONFIG } from '../../lib/config.js';
import { json, tokenInfo } from '../../lib/http.js';
import { worldState } from '../../lib/matches.js';
import { ensureSchema } from '../../lib/schema.js';

export async function state({ request, env }) {
  await ensureSchema(env.DB);
  const since = Number(new URL(request.url).searchParams.get('since')) || 0;
  const world = await worldState(env, Date.now(), since);
  return json({ ...world, token: tokenInfo(env), launch: { maxDevBuy: CONFIG.maxDevBuySol } });
}
