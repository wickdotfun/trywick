import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureSchema } from '../lib/schema.js';
import { selfTest } from '../lib/selftest.js';
import { fakeD1 } from './helpers/d1.js';

test('the admin test says exactly what works and what does not', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('pumpportal')) return new Response(new Uint8Array(400));
    if (url.includes('dexscreener')) return Response.json([]);
    if (url.includes('telegram')) return Response.json({ ok: false, description: 'Unauthorized' });
    return Response.json({ jsonrpc: '2.0', id: 1, result: { value: { blockhash: 'Hash1111' } } });
  };
  const r = await selfTest({ DB: db, TELEGRAM_BOT_TOKEN: 'bad', SOLANA_RPC: 'https://rpc.test' });
  const by = Object.fromEntries(r.steps.map((s) => [s.name, s]));
  assert.equal(r.ok, false);
  assert.equal(by['Database (D1)'].ok, true);
  assert.match(by['AI binding (Workers AI)'].detail, /No AI binding/);
  assert.match(by['AI at launch (coin, logo)'].detail, /off by design/);
  assert.match(by['Pinata (image upload)'].detail, /PINATA_JWT is not set/);
  assert.equal(by['Solana RPC'].ok, true);
  assert.equal(by['PumpPortal (builds the launch)'].ok, true);
  assert.match(by['Telegram bot'].detail, /Unauthorized/);
  assert.match(by['Other settings'].detail, /IP_SALT/);
});

test('the admin test lifts the AI pause as soon as the AI answers again (after upgrading the plan)', async () => {
  const { setSetting, getSetting } = await import('../lib/settings.js');
  const db = fakeD1();
  await ensureSchema(db);
  await setSetting(db, 'ai.out', 20731);
  globalThis.fetch = async () => Response.json({});
  const r = await selfTest({ DB: db, AI: { run: async () => ({ response: 'OK' }) } });
  assert.match(r.steps.find((s) => s.name === 'AI binding (Workers AI)').detail, /AI pause lifted/);
  assert.equal(await getSetting(db, 'ai.out', 'gone'), null);
});
