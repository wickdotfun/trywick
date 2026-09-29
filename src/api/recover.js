// POST /api/recover { phrase } : retrouver sa flamme sur un nouvel appareil.
// Limité à 10 essais par quart d'heure et par IP.
import { ipHash, json } from '../../lib/http.js';
import { recoverPlayer } from '../../lib/players.js';
import { ensureSchema } from '../../lib/schema.js';
import { getKv, setKv } from '../../lib/store.js';

const WINDOW = 15 * 60_000;
const MAX_TRIES = 10;

export async function onRequestPost({ request, env }) {
  const now = Date.now();
  await ensureSchema(env.DB);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const key = `recover:${await ipHash(request, env)}`;
  const tries = await getKv(env.DB, key);
  const fresh = tries && now - tries.since < WINDOW ? tries : { n: 0, since: now };
  if (fresh.n >= MAX_TRIES) return json({ error: 'too_many' }, 429);
  await setKv(env.DB, key, { n: fresh.n + 1, since: fresh.since });

  const result = await recoverPlayer(env.DB, body?.phrase, now);
  if (result.error) return json({ error: result.error }, 400);
  return json({ token: result.token, me: result.player });
}
