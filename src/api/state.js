// GET /api/state : ma bougie (si j'ai un jeton), la communauté, le fil, le marché.
import { json } from '../../lib/http.js';
import { context, snapshot } from './common.js';

export async function onRequestGet({ request, env }) {
  const now = Date.now();
  return json(await snapshot(env, now, await context(request, env, now)));
}
