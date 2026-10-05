// Le compte X d'un coin (lib/xoperator.js).
// POST /api/x/start  { mint, wallet, message, signature } : le créateur prouve que c'est son coin,
//                     et reçoit l'adresse où autoriser l'app de WICK sur X.
// GET  /api/x/callback : X renvoie le créateur ici ; il revient ensuite sur la page de son coin.
// POST /api/x/unlink { mint, wallet, message, signature } : le créateur reprend son compte.
import { getMatch } from '../../lib/matches.js';
import { allowIp } from '../../lib/keepers.js';
import { ipHash, json } from '../../lib/http.js';
import { isPubkey } from '../../lib/launch.js';
import { ensureSchema } from '../../lib/schema.js';
import { checkProof, finishAuth, startAuth, unlinkX, xAppReady } from '../../lib/xoperator.js';

async function proven(request, env, action) {
  const b = await request.json().catch(() => null);
  if (!isPubkey(b?.mint) || !isPubkey(b?.wallet)) return { error: 'bad_request', status: 400 };
  const m = await getMatch(env.DB, b.mint);
  if (!m || m.seq == null) return { error: 'unknown_mint', status: 404 };
  if (m.creator !== b.wallet) return { error: 'not_creator', status: 403 };
  if (!(await checkProof({ ...b, action }, Date.now()))) return { error: 'bad_signature', status: 403 };
  return { m };
}

export async function xStart({ request, env }) {
  await ensureSchema(env.DB);
  if (!xAppReady(env)) return json({ error: 'x_off' }, 503);
  if (!(await allowIp(env.DB, 'x', await ipHash(request, env), Date.now()))) return json({ error: 'too_many' }, 429);
  const p = await proven(request, env, 'link');
  if (p.error) return json({ error: p.error }, p.status);
  const url = await startAuth(env, { mint: p.m.mint, origin: new URL(request.url).origin }, Date.now());
  return json({ url });
}

export async function xCallback({ request, env }) {
  await ensureSchema(env.DB);
  const u = new URL(request.url);
  const back = (mint, status) => Response.redirect(`${u.origin}/?x=${status}${mint ? `#coin/${mint}` : ''}`, 302);
  if (!xAppReady(env)) return back(null, 'off');
  if (u.searchParams.get('error')) {
    const a = await env.DB.prepare('SELECT mint FROM x_auth WHERE state = ?').bind(u.searchParams.get('state') || '').first();
    return back(a?.mint, 'denied');
  }
  try {
    const res = await finishAuth(env, { state: u.searchParams.get('state'), code: u.searchParams.get('code') }, Date.now());
    return back(res.mint, res.error ? 'failed' : 'linked');
  } catch (err) {
    console.error('x callback', err.message);
    return back(null, 'failed');
  }
}

export async function xUnlink({ request, env }) {
  await ensureSchema(env.DB);
  const p = await proven(request, env, 'unlink');
  if (p.error) return json({ error: p.error }, p.status);
  return json({ ok: await unlinkX(env, p.m.mint) });
}
