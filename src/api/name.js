// GET /api/name?n=Akimbo365 : ce pseudo est-il libre ?  → { name, available } ou { error }
// GET /api/name?random=1     : un pseudo libre au hasard → { name, available: true }
import { json } from '../../lib/http.js';
import { checkName, nameTaken, randomFreeName } from '../../lib/players.js';
import { ensureSchema } from '../../lib/schema.js';

export async function onRequestGet({ request, env }) {
  await ensureSchema(env.DB);
  const params = new URL(request.url).searchParams;
  if (params.has('random')) return json({ name: await randomFreeName(env.DB), available: true });
  const { name, error } = checkName(params.get('n'));
  if (error) return json({ error });
  return json({ name, available: !await nameTaken(env.DB, name) });
}
