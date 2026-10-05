import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { adminPause, adminStatus, checkAdmin, recordRun } from '../src/api/admin.js';
import { runBuyback } from '../lib/buyback.js';
import { tickCycle } from '../lib/cycles.js';
import { ensureSchema } from '../lib/schema.js';
import { buybackPaused, getSetting } from '../lib/settings.js';
import { base58 } from '../lib/solana.js';
import { fakeD1 } from './helpers/d1.js';

const KEY = 'a-long-admin-key-1234567890';
const req = (path, { key = KEY, body } = {}) => new Request(`https://wick.test${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

async function makeEnv(extra = {}) {
  const env = { DB: fakeD1(), ADMIN_KEY: KEY, ...extra };
  await ensureSchema(env.DB);
  return env;
}

test('the admin is closed without a (long enough) ADMIN_KEY', async () => {
  assert.equal((await checkAdmin(req('/api/admin/status'), {})).status, 404);
  assert.equal((await checkAdmin(req('/api/admin/status'), { ADMIN_KEY: 'short' })).status, 404);
});

test('a wrong or missing key is refused', async () => {
  const env = await makeEnv();
  assert.equal((await adminStatus({ request: req('/api/admin/status', { key: 'nope' }), env })).status, 401);
  assert.equal((await adminStatus({ request: req('/api/admin/status', { key: null }), env })).status, 401);
  assert.equal((await adminPause({ request: req('/api/admin/pause', { key: 'nope', body: { paused: true } }), env })).status, 401);
  assert.equal(await buybackPaused(env.DB), false);
});

test('status shows the configuration and the candles', async () => {
  const env = await makeEnv();
  const res = await adminStatus({ request: req('/api/admin/status'), env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.paused, false);
  assert.equal(data.checks.tokenMint, null);
  assert.equal(data.wallet.key, 'missing');
  assert.equal(data.candle.number, 1);
  assert.equal(data.cycles.length, 1);

  const bad = await adminStatus({ request: req('/api/admin/status'), env: { ...env, BUYBACK_SECRET_KEY: 'garbage' } });
  assert.equal((await bad.json()).wallet.key, 'invalid');
});

test('pause stops new buybacks, resume lets them run again', async () => {
  const kp = Keypair.generate();
  const env = await makeEnv({ TOKEN_MINT: Keypair.generate().publicKey.toBase58(), BUYBACK_SECRET_KEY: base58(kp.secretKey), BURN_WALLET: kp.publicKey.toBase58() });
  assert.equal((await adminPause({ request: req('/api/admin/pause', { body: { paused: 'yes' } }), env })).status, 400);
  assert.equal((await adminPause({ request: req('/api/admin/pause', { body: { paused: true } }), env })).status, 200);
  assert.equal(await buybackPaused(env.DB), true);

  await tickCycle(env, 0);
  await tickCycle(env, 30 * 60_000);
  assert.equal(await runBuyback(env, 30 * 60_000), 'skipped:paused');
  const row = await env.DB.prepare('SELECT status, note FROM burns WHERE id = 1').first();
  assert.deepEqual({ ...row }, { status: 'skipped', note: 'paused' });

  await adminPause({ request: req('/api/admin/pause', { body: { paused: false } }), env });
  assert.equal(await buybackPaused(env.DB), false);
});

test('cron results and errors are kept for the admin page', async () => {
  const env = await makeEnv();
  assert.equal(await recordRun(env, async () => 'burned'), 'burned');
  assert.equal((await getSetting(env.DB, 'cron.lastRun')).step, 'burned');
  assert.equal(await recordRun(env, async () => { throw new Error('rpc_http_429'); }), 'error: rpc_http_429');
  assert.equal((await getSetting(env.DB, 'cron.lastError')).message, 'rpc_http_429');
});

test('post library: every post has its card and text; one click sends it to Telegram, and an X post can be relayed', async () => {
  const { adminPost, adminSocial } = await import('../src/api/admin.js');
  const { LIBRARY, libraryText } = await import('../lib/posts.js');
  const { existsSync } = await import('node:fs');
  for (const p of LIBRARY) {
    assert.ok(existsSync(new URL(`../public/cards/post-${p.id}.png`, import.meta.url)), `card for ${p.id}`);
    assert.ok(libraryText(p).length <= 280, `${p.id} fits in a post on X`);
    assert.doesNotMatch(libraryText(p), /\$\{|\{site/, 'placeholders are filled');
  }
  assert.match(libraryText(LIBRARY.find((p) => p.id === 'open'), { mint: 'MintW' }), /CA: MintW$/);
  assert.doesNotMatch(libraryText(LIBRARY.find((p) => p.id === 'teaser'), { mint: 'MintW' }), /MintW/);

  const env = await makeEnv({
    TELEGRAM_BOT_TOKEN: '123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq', TELEGRAM_CHAT_ID: '@wick', TOKEN_MINT: 'MintW',
    ASSETS: { fetch: async () => new Response(new Uint8Array([137, 80, 78, 71])) },
  });
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop();
    const body = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].filter(([k]) => k !== 'photo')) : JSON.parse(init.body);
    sent.push({ method, body });
    return Response.json({ ok: true, result: { message_id: 5 } });
  };
  const social = await (await adminSocial({ request: req('/api/admin/social'), env })).json();
  assert.equal(social.library.length, LIBRARY.length);
  assert.match(social.library.find((p) => p.id === 'proof').text, /CA: MintW/);

  const r = await (await adminPost({ request: req('/api/admin/post', { body: { kind: 'library', id: 'open', text: 'gm <3\n\nCA: MintW', channels: ['telegram'] } }), env })).json();
  assert.equal(r.telegram, 5);
  assert.equal(sent[0].method, 'sendPhoto');
  assert.equal(sent[0].body.caption, 'gm &lt;3\n\nCA: <code>MintW</code>');
  assert.equal(r.x, undefined, 'X stays with the button: nothing posted there without keys');

  const bad = await adminPost({ request: req('/api/admin/post', { body: { kind: 'relay', url: 'https://evil.test/x' } }), env });
  assert.equal(bad.status, 400);
  const relay = await (await adminPost({ request: req('/api/admin/post', { body: { kind: 'relay', url: 'https://twitter.com/trywickdotfun/status/123?s=20', note: 'new post' } }), env })).json();
  assert.equal(relay.telegram, 5);
  assert.equal(sent[1].method, 'sendMessage');
  assert.match(sent[1].body.text, /^new post\n\n𝕏 <a href="https:\/\/x.com\/trywickdotfun\/status\/123">/);
  assert.equal(sent[1].body.link_preview_options.url, 'https://x.com/trywickdotfun/status/123');
});
