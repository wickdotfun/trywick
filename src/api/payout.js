// POST /api/payout { address } : l'adresse Solana PUBLIQUE où le joueur veut recevoir une
// récompense. Jamais de connexion de wallet, jamais de clé privée : une clé ou une seed
// collée par erreur est refusée (format différent). { address: null } l'efface.
import { json } from '../../lib/http.js';
import { setPayout } from '../../lib/players.js';
import { isSolanaAddress } from '../../lib/rewards.js';
import { forgetCommunityCache } from '../../lib/world.js';
import { context, snapshot } from './common.js';

export async function onRequestPost({ request, env }) {
  const now = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const address = body?.address == null ? null : String(body.address).trim();
  if (address !== null && !isSolanaAddress(address)) return json({ error: 'bad_address' }, 400);
  const ctx = await context(request, env, now);
  if (!ctx.player) return json({ error: 'no_player' }, 401);
  // Une adresse = un seul joueur (sinon, 6 comptes pourraient viser la même récompense).
  if (address) {
    const taken = await env.DB.prepare('SELECT id FROM players WHERE payout = ? AND id != ?').bind(address, ctx.player.row.id).first();
    if (taken) return json({ error: 'address_taken' }, 409);
  }
  ctx.player = { row: { ...ctx.player.row, payout: address }, view: await setPayout(env.DB, ctx.player.row, address) };
  forgetCommunityCache();
  return json({ ok: true, ...await snapshot(env, now, ctx) });
}
