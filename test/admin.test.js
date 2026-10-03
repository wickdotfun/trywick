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
  const env = await makeEnv({ TOKEN_MINT: Keypair.generate().publicKey.toBase58(), BUYBACK_SECRET_KEY: base58(kp.secretKey) });
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
