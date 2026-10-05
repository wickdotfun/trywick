// GET /api/crew : le crew au travail (lib/crew.js).
import { crewPage } from '../../lib/crew.js';
import { json } from '../../lib/http.js';
import { ensureSchema } from '../../lib/schema.js';

export async function crew({ env }) {
  await ensureSchema(env.DB);
  return json(await crewPage(env.DB));
}
