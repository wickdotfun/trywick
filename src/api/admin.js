// POST /api/admin/paid { week, rank, tx } avec « Authorization: Bearer <ADMIN_KEY> » :
// le dev ajoute la preuve de paiement (signature de la transaction Solana) d'un gagnant.
// Elle s'affiche alors sur le site, avec un lien vers Solscan.
import { json } from '../../lib/http.js';
import { isTxSignature } from '../../lib/rewards.js';
import { ensureSchema } from '../../lib/schema.js';
import { forgetCommunityCache } from '../../lib/world.js';

export async function onRequestPost({ request, env }) {
  const key = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!isTxSignature(body?.tx)) return json({ error: 'bad_tx' }, 400);
  await ensureSchema(env.DB);
  const res = await env.DB.prepare('UPDATE rewards SET tx = ? WHERE week = ? AND rank = ?')
    .bind(body.tx.trim(), Number(body.week), Number(body.rank)).run();
  forgetCommunityCache();
  return json({ ok: res.meta.changes === 1 });
}
