// GET /api/models : les modèles d'OpenRouter que l'agent d'un coin peut prendre, avec leurs prix.
import { json } from '../../lib/http.js';
import { publicModels } from '../../lib/openrouter.js';
import { ensureSchema } from '../../lib/schema.js';

export async function models({ env }) {
  await ensureSchema(env.DB);
  const res = json(await publicModels(env, Date.now()));
  res.headers.set('cache-control', 'public, max-age=300');
  return res;
}
