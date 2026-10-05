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
  assert.match(by['Telegram bot'].detail, /does not look like a bot token \(it has no ":"/);
  assert.doesNotMatch(by['Telegram bot'].detail, /bad/);
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

test('a used-up AI quota and a busy DEX Screener are notes, not failures; Telegram says how to fix its token', async () => {
  const { getSetting } = await import('../lib/settings.js');
  const { dexReset } = await import('../lib/dex.js');
  dexReset();
  const db = fakeD1();
  await ensureSchema(db);
  let dexCalls = 0;
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('dexscreener')) { dexCalls++; return new Response('slow down', { status: 429 }); }
    if (url.includes('telegram')) return Response.json({ ok: false, error_code: 401, description: 'Unauthorized' });
    return Response.json({});
  };
  const now = Date.UTC(2026, 9, 5, 12);
  const ai = { run: async () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); } };
  const r = await selfTest({ DB: db, AI: ai, TELEGRAM_BOT_TOKEN: ' "bot123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq" ' }, now);
  const by = Object.fromEntries(r.steps.map((s) => [s.name, s]));
  assert.equal(by['AI binding (Workers AI)'].ok, true);
  assert.equal(by['AI binding (Workers AI)'].warn, true);
  assert.match(by['AI binding (Workers AI)'].detail, /00:00 UTC/);
  assert.equal(await getSetting(db, 'ai.out', null), Math.floor(now / 86_400_000));
  assert.equal(by['DEX Screener (markets, Scout)'].warn, true);
  assert.equal(dexCalls, 2, 'one retry, then a pause');
  assert.equal(by['Telegram bot'].ok, false);
  assert.match(by['Telegram bot'].detail, /revoked[\s\S]*@BotFather/);
  dexReset();
});

test('the Telegram token is cleaned of what people paste around it', async () => {
  const { tgToken, tgTokenProblem } = await import('../lib/tgtoken.js');
  const tok = '123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq';
  for (const raw of [tok, ` ${tok}\n`, `bot${tok}`, `"${tok}"`, `https://api.telegram.org/bot${tok}/getMe`]) {
    assert.equal(tgToken({ TELEGRAM_BOT_TOKEN: raw }), tok, raw);
    assert.equal(tgTokenProblem({ TELEGRAM_BOT_TOKEN: raw }), null, raw);
  }
  assert.match(tgTokenProblem({ TELEGRAM_BOT_TOKEN: '123456789:short' }), /after ":"/);
  assert.match(tgTokenProblem({ TELEGRAM_BOT_TOKEN: 'AAbbcc:ddeeffgghhiijjkkllmmnnooppqqrrss' }), /bot number/);
});

test('with the free backup brain set, a used-up Workers AI quota is green: agents keep answering', async () => {
  const { dexReset } = await import('../lib/dex.js');
  dexReset();
  const db = fakeD1();
  await ensureSchema(db);
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('groq')) return Response.json({ choices: [{ message: { content: 'OK' } }] });
    return Response.json([]);
  };
  const ai = { run: async () => { throw new Error('4006: daily free allocation of 10,000 neurons'); } };
  const r = await selfTest({ DB: db, AI: ai, GROQ_API_KEY: 'gsk_test' });
  const by = Object.fromEntries(r.steps.map((s) => [s.name, s]));
  assert.equal(by['AI binding (Workers AI)'].ok, true);
  assert.equal(by['AI binding (Workers AI)'].warn, undefined);
  assert.match(by['AI binding (Workers AI)'].detail, /backup brain/);
  assert.equal(by['Backup brain (Groq, free)'].ok, true);
  assert.match(by['Backup brain (Groq, free)'].detail, /OK/);
});
