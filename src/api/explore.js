// GET /api/launches?sort=trending|new|volume|burner&offset=… : les coins lancés avec WICK.
// GET /api/profile?wallet=… : le profil d'un wallet (« Your flames »).
import { exploreLaunches, walletProfile } from '../../lib/explore.js';
import { json } from '../../lib/http.js';
import { isPubkey } from '../../lib/launch.js';
import { ensureSchema } from '../../lib/schema.js';

export async function launches({ request, env }) {
  await ensureSchema(env.DB);
  const params = new URL(request.url).searchParams;
  return json(await exploreLaunches(env.DB, {
    sort: params.get('sort') || 'trending',
    offset: Number(params.get('offset')) || 0,
    now: Date.now(),
  }));
}

export async function profile({ request, env }) {
  await ensureSchema(env.DB);
  const wallet = new URL(request.url).searchParams.get('wallet');
  if (!isPubkey(wallet)) return json({ error: 'bad_wallet' }, 400);
  return json(await walletProfile(env.DB, wallet, Date.now()));
}
