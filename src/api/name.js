// GET /api/name?n=Akimbo365 : ce pseudo est-il libre ?  → { name, available } ou { error }
// GET /api/name?random=1     : un pseudo libre au hasard → { name, available: true }
// Quand le pseudo est libre, la réponse donne aussi son code (à mettre dans la réponse
// au post d'annonce pour allumer sa toute première bougie).
import { json } from '../../lib/http.js';
import { checkName, nameTaken, randomFreeName } from '../../lib/players.js';
import { birthCode } from '../../lib/quests.js';
import { ensureSchema } from '../../lib/schema.js';

export async function onRequestGet({ request, env }) {
  await ensureSchema(env.DB);
  const params = new URL(request.url).searchParams;
  const salt = env.IP_SALT || '';
  if (params.has('random')) {
    const name = await randomFreeName(env.DB);
    return json({ name, available: true, code: await birthCode(name, salt) });
  }
  const { name, error } = checkName(params.get('n'));
  if (error) return json({ error });
  const available = !await nameTaken(env.DB, name);
  return json({ name, available, ...(available ? { code: await birthCode(name, salt) } : {}) });
}
