// GET /api/leaderboard : le classement des Pyromanes (gardé une minute en mémoire).
import { json } from '../../lib/http.js';
import { leaderboard } from '../../lib/leaderboard.js';
import { ensureSchema } from '../../lib/schema.js';

export async function board({ env }) {
  await ensureSchema(env.DB);
  return json({ pyromaniacs: await leaderboard(env.DB, Date.now()) });
}
