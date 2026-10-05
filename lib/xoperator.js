// L'Operator sur X : chaque coin peut avoir son compte X, où son Operator poste tout seul.
//
// 1. Le créateur du coin prouve que c'est le sien : son wallet signe un message (pas une
//    transaction), vérifié ici (Ed25519).
// 2. Il se connecte à X et autorise l'app de WICK (OAuth 2.0 avec PKCE). Les jetons sont gardés
//    chiffrés dans la base (AES-GCM, clé dérivée de X_CLIENT_SECRET).
// 3. Le cron poste à sa place : les 3 posts X de son kit, puis ses paliers, ses burns et son
//    journal. Jamais de lien (un post avec lien coûte bien plus cher sur l'API X), 4 posts par jour
//    au plus, 3 heures d'écart. Les posts sont payés par la part crew du coin : comme un esprit
//    premium, ses 7 premiers jours, puis tant que son crew gagne de quoi les payer.
// Actif seulement si l'app X est réglée : X_CLIENT_ID et X_CLIENT_SECRET (Cloudflare Secrets).
import { CONFIG } from './config.js';
import { cleanPost, readKit } from './kit.js';
import { premiumFunded } from './minds.js';
import { logAction } from './operator.js';
import { blocked } from './safety.js';
import { fromBase58 } from './solana.js';

const X = CONFIG.operator.x;
const DAY = 86_400_000;
const AUTH = 'https://x.com/i/oauth2/authorize';
const TOKEN = 'https://api.x.com/2/oauth2/token';
const API = 'https://api.x.com/2';

export const xAppReady = (env) => Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET);
export const callbackUrl = (origin) => `${origin}/api/x/callback`;

// ------------------------------------------------------------ la preuve du créateur
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export { proofMessage } from './xproof.js';

// Le message est-il bien signé par ce wallet, pour ce coin, il y a moins de 10 minutes ?
export async function checkProof({ message, signature, wallet, mint, action }, now) {
  const text = String(message || '');
  const at = Date.parse(text.match(/\nTime: (\S+)$/)?.[1] || '');
  if (!text.includes(`\nCoin: ${mint}\n`) || !text.includes(`\nWallet: ${wallet}\n`)) return false;
  if (action === 'unlink' ? !text.startsWith('WICK: disconnect') : !text.startsWith('WICK: let its Operator')) return false;
  if (!(Math.abs(now - at) < 10 * 60_000)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', fromBase58(wallet), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, unb64(String(signature)), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ les jetons, chiffrés
async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wick-x-tokens:${env.X_CLIENT_SECRET}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(out)}`;
}
export async function unseal(env, box) {
  const [iv, data] = String(box || '').split('.');
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(data));
  return new TextDecoder().decode(out);
}

// ------------------------------------------------------------ OAuth 2.0 (PKCE)
// Étape 1 : l'adresse où envoyer le créateur. state et verifier sont gardés 15 minutes.
export async function startAuth(env, { mint, origin }, now) {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  await env.DB.prepare('DELETE FROM x_auth WHERE at < ?').bind(now - 15 * 60_000).run();
  await env.DB.prepare('INSERT INTO x_auth (state, mint, verifier, origin, at) VALUES (?, ?, ?, ?, ?)').bind(state, mint, verifier, origin, now).run();
  const q = new URLSearchParams({
    response_type: 'code', client_id: env.X_CLIENT_ID, redirect_uri: callbackUrl(origin),
    scope: 'tweet.read tweet.write users.read offline.access', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  return `${AUTH}?${q}`;
}

async function tokenCall(env, params) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}` },
    body: new URLSearchParams({ client_id: env.X_CLIENT_ID, ...params }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) throw Object.assign(new Error(`x token ${res.status}: ${data?.error || ''}`), { gone: data?.error === 'invalid_grant' });
  return data;
}

async function saveTokens(env, mint, t, now) {
  await env.DB.prepare('UPDATE x_links SET access_enc = ?, refresh_enc = ?, expires_at = ? WHERE mint = ?')
    .bind(await seal(env, t.access_token), t.refresh_token ? await seal(env, t.refresh_token) : null, now + (t.expires_in || 7200) * 1000, mint).run();
}

// Étape 2 : X renvoie le créateur ici. Renvoie { mint, handle } ou { error }.
export async function finishAuth(env, { state, code }, now) {
  const db = env.DB;
  const a = await db.prepare('SELECT * FROM x_auth WHERE state = ?').bind(String(state || '')).first();
  if (!a || now - a.at > 15 * 60_000 || !code) return { error: 'expired' };
  await db.prepare('DELETE FROM x_auth WHERE state = ?').bind(a.state).run();
  const t = await tokenCall(env, { grant_type: 'authorization_code', code: String(code), redirect_uri: callbackUrl(a.origin), code_verifier: a.verifier });
  const me = await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => null);
  const handle = me?.data?.username;
  if (!handle) return { error: 'no_user' };
  // Ce qu'il a déjà fait n'est pas reposté : il part de maintenant (son kit d'abord).
  const last = await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM operator_log WHERE mint = ?').bind(a.mint).first();
  await db.prepare(`INSERT INTO x_links (mint, user_id, handle, linked_at, last_log_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET user_id = excluded.user_id, handle = excluded.handle, linked_at = excluded.linked_at`)
    .bind(a.mint, me.data.id, handle, now, last.id).run();
  await saveTokens(env, a.mint, t, now);
  await logAction(db, a.mint, { kind: 'posted', at: now, ref: `xlink:${now}`, title: `Took over its X account: @${handle}`, detail: 'Its creator connected it. Its agent posts there now.' });
  return { mint: a.mint, handle };
}

export async function unlinkX(env, mint) {
  const row = await env.DB.prepare('SELECT refresh_enc FROM x_links WHERE mint = ?').bind(mint).first();
  if (!row) return false;
  await env.DB.prepare('DELETE FROM x_links WHERE mint = ?').bind(mint).run();
  // On rend aussi le jeton à X (sans attendre la réponse pour décider).
  if (row.refresh_enc) {
    await unseal(env, row.refresh_enc).then((token) => fetch(`${API}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}` },
      body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: env.X_CLIENT_ID }),
    })).catch(() => null);
  }
  return true;
}

// ------------------------------------------------------------ poster
async function accessToken(env, link, now) {
  if (link.expires_at > now + 60_000) return unseal(env, link.access_enc);
  const t = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: await unseal(env, link.refresh_enc) });
  await saveTokens(env, link.mint, t, now);
  return t.access_token;
}

export function xText(text) {
  const s = cleanPost(String(text || '').replace(/https?:\/\/\S+/gi, ''), X.maxChars, true);
  return s.length >= 10 && !blocked(s) && !/https?:|www\./i.test(s) ? s : null;
}

// Le prochain post d'un coin : son kit d'abord (3 posts), puis ce que son Operator a fait.
// link : son lien X et son coin (symbol, op_kit, kit_i) ; fresh : ses nouvelles actions.
export function nextPost(link, fresh) {
  const m = link;
  const kit = readKit(m.op_kit);
  if (kit?.x?.length && link.kit_i < kit.x.length) return { text: xText(kit.x[link.kit_i]), kit: true };
  const sym = `$${m.symbol}`;
  const pick = (kind) => fresh.filter((e) => e.kind === kind).at(-1);
  const e = pick('milestone') || pick('burned') || pick('journal');
  if (!e) return null;
  if (e.kind === 'journal') return { text: xText(`${e.detail}\n\n${sym}`) };
  if (e.kind === 'burned') {
    const voice = String(e.detail || '').match(/“(.+)”/)?.[1];
    return { text: xText(`${e.title}.${voice ? `\n\n${voice}` : ''}\n\nBought back with its own creator fees, on-chain.`) };
  }
  return { text: xText(`${sym}: ${e.title}.\n\n${e.detail || ''}`) };
}

const POSTABLE = ['milestone', 'burned', 'journal'];

export async function runXPosts(env, now) {
  if (!xAppReady(env)) return 0;
  const db = env.DB;
  const today = Math.floor(now / DAY);
  const { results } = await db.prepare(
    `SELECT x.*, m.symbol, m.name, m.lit_at, m.op_kit FROM x_links x JOIN matches m ON m.mint = x.mint
     WHERE x.last_post_at < ? ORDER BY x.last_post_at LIMIT ?`,
  ).bind(now - X.minGapMs, X.perRun).all();
  let posted = 0;
  for (const link of results) {
    if ((link.day === today ? link.day_posts : 0) >= X.perDay) continue;
    if (!(await premiumFunded(db, { mint: link.mint, lit_at: link.lit_at }, now))) continue;
    const { results: fresh } = await db.prepare(`SELECT id, kind, title, detail FROM operator_log WHERE mint = ? AND id > ? AND kind IN (${POSTABLE.map(() => '?').join(',')}) ORDER BY id LIMIT 20`)
      .bind(link.mint, link.last_log_id, ...POSTABLE).all();
    const lastId = fresh.length ? fresh.at(-1).id : link.last_log_id;
    const post = nextPost(link, fresh);
    if (!post?.text) {
      if (lastId !== link.last_log_id) await db.prepare('UPDATE x_links SET last_log_id = ? WHERE mint = ?').bind(lastId, link.mint).run();
      continue;
    }
    let id;
    try {
      const token = await accessToken(env, link, now);
      const res = await fetch(`${API}/tweets`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ text: post.text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(`x post ${res.status}: ${JSON.stringify(data?.detail || data?.title || '').slice(0, 160)}`), { gone: res.status === 401 });
      id = data?.data?.id;
    } catch (err) {
      console.error('operator x', link.mint, err.message);
      // Accès retiré par le créateur sur X : le lien est oublié (il pourra le refaire).
      if (err.gone) await db.prepare('DELETE FROM x_links WHERE mint = ?').bind(link.mint).run();
      continue;
    }
    posted++;
    await db.prepare(`UPDATE x_links SET last_post_at = ?, day = ?, day_posts = ?, posts = posts + 1, kit_i = kit_i + ?, last_log_id = ?, last_post_id = ? WHERE mint = ?`)
      .bind(now, today, (link.day === today ? link.day_posts : 0) + 1, post.kit ? 1 : 0, post.kit ? link.last_log_id : lastId, id || null, link.mint).run();
    await logAction(db, link.mint, { kind: 'posted', at: now, ref: `x:${id || now}`, title: `Posted on X (@${link.handle})`, detail: post.text });
  }
  return posted;
}

// Ce que la page d'un coin montre de son X.
export async function xInfo(env, mint) {
  const row = await env.DB.prepare('SELECT handle, linked_at, posts, last_post_id FROM x_links WHERE mint = ?').bind(mint).first();
  return { enabled: xAppReady(env), handle: row?.handle || null, linkedAt: row?.linked_at || null, posts: row?.posts || 0, lastPost: row?.last_post_id || null, perDay: X.perDay };
}
