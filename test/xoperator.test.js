import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logAction } from '../lib/operator.js';
import { ensureSchema } from '../lib/schema.js';
import { base58 } from '../lib/solana.js';
import { checkProof, finishAuth, nextPost, proofMessage, runXPosts, seal, startAuth, unseal, xText } from '../lib/xoperator.js';
import { xStart } from '../src/api/x.js';
import { fakeD1 } from './helpers/d1.js';

const HOUR = 3_600_000;
const env0 = { X_CLIENT_ID: 'cid', X_CLIENT_SECRET: 'csecret' };
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

// Un vrai wallet Solana (Ed25519) qui signe un message, comme Phantom.
async function wallet() {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const address = base58(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  const sign = async (text) => b64(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(text)));
  return { address, sign };
}

async function coin(db, { creator, litAt, kit = true }) {
  const mint = base58(crypto.getRandomValues(new Uint8Array(32)));
  const opKit = kit ? JSON.stringify({ x: ['$MOTH is live on pump.fun. https://pump.fun/x\n\nCA: ' + mint, 'Moth: a moth that caught the flame.', '$MOTH has its own AI Operator.'] }) : null;
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, op_kit)
    VALUES (?, ?, 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, 'stoic', ?)`).bind(mint, creator, litAt, opKit).run();
  return mint;
}

test('the creator proves the coin is theirs with a wallet signature', async () => {
  const w = await wallet();
  const now = Date.now();
  const mint = base58(crypto.getRandomValues(new Uint8Array(32)));
  const message = proofMessage({ symbol: 'MOTH', mint, wallet: w.address, at: now });
  const signature = await w.sign(message);
  assert.equal(await checkProof({ message, signature, wallet: w.address, mint }, now), true);
  assert.equal(await checkProof({ message, signature, wallet: w.address, mint }, now + 11 * 60_000), false, 'too old');
  assert.equal(await checkProof({ message, signature, wallet: w.address, mint, action: 'unlink' }, now), false, 'another action');
  const other = await wallet();
  assert.equal(await checkProof({ message, signature: await other.sign(message), wallet: w.address, mint }, now), false, 'signed by someone else');
  assert.equal(await checkProof({ message: message.replace(mint, 'X'), signature, wallet: w.address, mint }, now), false);
});

test('its X tokens are stored encrypted', async () => {
  const box = await seal(env0, 'secret-token');
  assert.ok(!box.includes('secret'));
  assert.equal(await unseal(env0, box), 'secret-token');
  await assert.rejects(unseal({ X_CLIENT_SECRET: 'other' }, box));
});

test('posts: no links, nothing blocked, the kit first, then what its Operator did', () => {
  assert.equal(xText('Look https://scam.example now please'), 'Look now please');
  assert.equal(xText('short'), null);
  const link = { symbol: 'MOTH', kit_i: 3, op_kit: JSON.stringify({ x: ['a', 'b', 'c'] }) };
  const fresh = [{ kind: 'journal', detail: 'Quiet day. The wax waits.' }, { kind: 'milestone', title: 'Reached a $50K market cap', detail: '$MOTH trades at a $52K market cap.' }];
  assert.equal(nextPost(link, fresh).text, '$MOTH: Reached a $50K market cap.\n\n$MOTH trades at a $52K market cap.');
  assert.equal(nextPost(link, [fresh[0]]).text, 'Quiet day. The wax waits.\n\n$MOTH');
  assert.equal(nextPost({ ...link, kit_i: 0, op_kit: JSON.stringify({ x: ['$MOTH is live, with its own Operator.'] }) }, fresh).kit, true);
  assert.equal(nextPost(link, []), null);
});

test('connect, then its Operator posts on its X: kit first, 3 hours apart, 4 a day, paid by its crew', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  const env = { ...env0, DB: db };
  const w = await wallet();
  let now = 1_800_000_000_000;
  const mint = await coin(db, { creator: w.address, litAt: now - HOUR });
  await logAction(db, mint, { kind: 'journal', title: 'Journal', detail: 'Old line, before X.', at: now - 30 * 60_000 });

  // 1. Le créateur part vers X.
  const url = new URL(await startAuth(env, { mint, origin: 'https://trywick.fun' }, now));
  assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://trywick.fun/api/x/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /tweet\.write.*offline\.access/);

  // 2. X le renvoie : les jetons, son compte.
  const posts = [];
  let tokenCalls = 0;
  globalThis.fetch = async (u, init = {}) => {
    u = String(u);
    if (u.endsWith('/oauth2/token')) {
      tokenCalls++;
      const p = new URLSearchParams(init.body);
      assert.equal(init.headers.authorization, `Basic ${btoa('cid:csecret')}`);
      return Response.json({ access_token: `at-${p.get('grant_type')}-${tokenCalls}`, refresh_token: `rt-${tokenCalls}`, expires_in: 7200 });
    }
    if (u.endsWith('/users/me')) return Response.json({ data: { id: '42', username: 'mothcoin' } });
    if (u.endsWith('/tweets')) {
      posts.push({ auth: init.headers.authorization, text: JSON.parse(init.body).text });
      return Response.json({ data: { id: String(posts.length) } });
    }
    throw new Error(`unexpected ${u}`);
  };
  const done = await finishAuth(env, { state: url.searchParams.get('state'), code: 'c0de' }, now);
  assert.deepEqual(done, { mint, handle: 'mothcoin' });
  const row = await db.prepare('SELECT * FROM x_links WHERE mint = ?').bind(mint).first();
  assert.ok(!row.access_enc.includes('at-'), 'tokens encrypted');
  assert.deepEqual(await finishAuth(env, { state: url.searchParams.get('state'), code: 'c0de' }, now), { error: 'expired' }, 'a state works once');

  // 3. Le cron poste : le kit d'abord, sans lien.
  assert.equal(await runXPosts(env, now), 1);
  assert.equal(posts[0].auth, 'Bearer at-authorization_code-1');
  assert.ok(!/https?:/.test(posts[0].text));
  assert.match(posts[0].text, /CA: /);
  assert.equal(await runXPosts(env, now + HOUR), 0, '3 hours apart');
  await logAction(db, mint, { kind: 'milestone', title: 'Reached a $50K market cap', detail: '$MOTH trades at a $51K market cap.', at: now + HOUR });
  for (let i = 1; i <= 4; i++) await runXPosts(env, now + i * (3 * HOUR + 1));
  assert.equal(posts.length, 4, '4 a day at most');
  assert.equal(posts[3].text, '$MOTH: Reached a $50K market cap.\n\n$MOTH trades at a $51K market cap.', 'kit (3 posts), then the milestone; the old journal line is not reposted');
  assert.ok(tokenCalls >= 2, 'an expired token is refreshed');
  const log = await db.prepare("SELECT title FROM operator_log WHERE mint = ? AND kind = 'posted' ORDER BY id").bind(mint).all();
  assert.equal(log.results[0].title, 'Took over its X account: @mothcoin');
  assert.equal(log.results.at(-1).title, 'Posted on X (@mothcoin)');

  // 4. Après 7 jours, sans gains du crew : il se tait.
  await logAction(db, mint, { kind: 'journal', title: 'Journal', detail: 'Day eight. Still here.', at: now + 8 * 24 * HOUR });
  assert.equal(await runXPosts(env, now + 8 * 24 * HOUR), 0);

  // 5. Accès retiré sur X : le lien est oublié.
  await db.prepare('UPDATE matches SET lit_at = ? WHERE mint = ?').bind(now + 8 * 24 * HOUR, mint).run();
  globalThis.fetch = async (u) => (String(u).endsWith('/tweets') ? new Response('{"title":"Unauthorized"}', { status: 401 }) : Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 7200 }));
  assert.equal(await runXPosts(env, now + 8 * 24 * HOUR + 1), 0);
  assert.equal(await db.prepare('SELECT 1 FROM x_links WHERE mint = ?').bind(mint).first(), null);
});

test('only the coin creator, with a fresh signature, can connect its X', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  const env = { ...env0, DB: db, IP_SALT: 's' };
  const w = await wallet();
  const mint = await coin(db, { creator: w.address, litAt: Date.now() });
  const call = async (b) => xStart({ request: new Request('https://trywick.fun/api/x/start', { method: 'POST', body: JSON.stringify(b) }), env });
  const message = proofMessage({ symbol: 'MOTH', mint, wallet: w.address, at: Date.now() });
  const ok = await call({ mint, wallet: w.address, message, signature: await w.sign(message) });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).url, /^https:\/\/x\.com\/i\/oauth2\/authorize\?/);
  const other = await wallet();
  const m2 = proofMessage({ symbol: 'MOTH', mint, wallet: other.address, at: Date.now() });
  assert.equal((await (await call({ mint, wallet: other.address, message: m2, signature: await other.sign(m2) })).json()).error, 'not_creator');
  assert.equal((await (await call({ mint, wallet: w.address, message, signature: await other.sign(message) })).json()).error, 'bad_signature');
  assert.equal((await xStart({ request: new Request('https://x', { method: 'POST', body: '{}' }), env: { DB: db } })).status, 503, 'off without the X app');
});
