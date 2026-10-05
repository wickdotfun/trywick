import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { candleOf } from '../lib/matches.js';
import { cleanLine, keeperChoices, parseDecision, runKeepers, runVoices, textOf, think } from '../lib/keepers.js';
import { ensureSchema } from '../lib/schema.js';
import { getSetting } from '../lib/settings.js';
import { queueSelfBurn, setAsideSelf } from '../lib/sharing.js';
import { fakeD1 } from './helpers/d1.js';

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

// Un faux Workers AI : renvoie ce qu'on lui dit, et note chaque appel.
function fakeAI(reply) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      const r = typeof reply === 'function' ? reply(model, input) : reply;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

// Une bougie avec un Keeper (« Stoic », Llama), 0,02 SOL de fees mises de côté.
async function world({ pending = 20_000_000, style = 'stoic', lastBurn = NOW - 2 * HOUR, ai } = {}) {
  const db = fakeD1();
  await ensureSchema(db);
  const mint = Keypair.generate().publicKey.toBase58();
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, share_bps, share_team_bps,
      self_bps, share_state, keeper_style, keeper_model, self_pending, self_last_burn, mcap, change24h)
    VALUES (?, 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, 3000, 500, 2000, 'shared', ?, 'qwen', ?, ?, 120000, -18)`)
    .bind(mint, NOW - 30 * HOUR, style, pending, lastBurn).run();
  return { env: { DB: db, AI: ai }, db, mint };
}
const coinBurns = async (db) => (await db.prepare("SELECT * FROM burns WHERE kind = 'coin'").all()).results;

test('Workers AI answers are read whatever their shape, and lines are cleaned up', () => {
  assert.equal(textOf({ response: 'hi' }), 'hi');
  assert.equal(textOf({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'yo' }] }] }), 'yo');
  assert.equal(textOf({ choices: [{ message: { content: 'ok' } }] }), 'ok');
  assert.equal(cleanLine('<think>hmm</think> "Burn it 🔥 now https://x.y #wick"'), 'Burn it now');
  assert.ok(cleanLine('x'.repeat(300)).length <= 140);
  assert.deepEqual(parseDecision('Sure! {"action":"wait","line":"Not yet. Let it dip."}'), { action: 'wait', line: 'Not yet. Let it dip.' });
  assert.equal(parseDecision('{"action":"sell everything"}'), null);
  assert.equal(parseDecision('no json here'), null);
  assert.deepEqual(keeperChoices().styles.map((s) => s.id), ['stoic', 'degen', 'poet', 'pyro', 'analyst', 'builder', 'guardian', 'custom']);
});

test('a Keeper that says burn: the burn is queued with its line, on its chosen model', async () => {
  const ai = fakeAI({ response: '{"action":"burn","line":"It dropped. The flame eats."}' });
  const { env, db, mint } = await world({ ai });
  assert.equal(await runKeepers(env, NOW, queueSelfBurn), 1);
  const [b] = await coinBurns(db);
  assert.equal(b.ref, `${mint}:k${NOW}`);
  assert.equal(b.sol, 0.0195);
  assert.equal(b.voice, 'It dropped. The flame eats.');
  assert.equal(ai.calls[0].model, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.match(ai.calls[0].input.messages[0].content, /Operator of \$MOTH/);
  const m = await db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
  assert.equal(m.self_pending, 0);
  assert.equal(m.self_last_burn, NOW);
  assert.equal(candleOf(m).keeper.thought, 'It dropped. The flame eats.');
  assert.equal(candleOf(m).keeper.model, 'Qwen3 30B');
  // Déjà consulté : rien d'autre pendant une heure.
  assert.equal(await runKeepers(env, NOW + 10 * 60_000, queueSelfBurn), 0);
});

test('a Keeper that says wait keeps the SOL for its coin, and thinks again an hour later', async () => {
  const ai = fakeAI({ response: '{"action":"wait","line":"Quiet market. I wait."}' });
  const { env, db, mint } = await world({ ai });
  assert.equal(await runKeepers(env, NOW, queueSelfBurn), 0);
  assert.equal((await coinBurns(db)).length, 0);
  let m = await db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
  assert.equal(m.self_pending, 20_000_000);
  assert.equal(m.keeper_thought, 'Quiet market. I wait.');
  assert.equal(await runKeepers(env, NOW + 30 * 60_000, queueSelfBurn), 0);   // pas avant une heure
  assert.equal(ai.calls.length, 1);
  assert.equal(await runKeepers(env, NOW + HOUR + 1, queueSelfBurn), 0);    // il réfléchit encore
  assert.equal(ai.calls.length, 2);
});

test('guardrails: after 24 h, or above 0.25 SOL, the Keeper burns whatever it says', async () => {
  const wait = { response: '{"action":"wait","line":"Not now."}' };
  const late = await world({ ai: fakeAI(wait), lastBurn: NOW - 25 * HOUR });
  assert.equal(await runKeepers(late.env, NOW, queueSelfBurn), 1);
  assert.match(late.env.AI.calls[0].input.messages[1].content, /MUST burn now/);
  const full = await world({ ai: fakeAI(wait), pending: 300_000_000 });
  assert.equal(await runKeepers(full.env, NOW, queueSelfBurn), 1);
});

test('no AI, a broken model, or no quota left: the Keeper still burns, with a ready-made line', async () => {
  const none = await world({ ai: undefined });
  assert.equal(await runKeepers(none.env, NOW, queueSelfBurn), 1);
  assert.match((await coinBurns(none.db))[0].voice, /\$MOTH|SOL/);
  // Le modèle choisi plante : on essaie le modèle de secours (Llama).
  const ai = fakeAI((model) => (model.includes('qwen') ? new Error('model gone') : { response: '{"action":"burn","line":"Backup mind. Burning."}' }));
  const broken = await world({ ai });
  assert.equal(await runKeepers(broken.env, NOW, queueSelfBurn), 1);
  assert.deepEqual(ai.calls.map((c) => c.model), ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
  assert.equal((await coinBurns(broken.db))[0].voice, 'Backup mind. Burning.');
  // Le quota du jour est épuisé : plus d'appel.
  const quota = await world({ ai: fakeAI({ response: '{"action":"wait","line":"x"}' }) });
  await quota.db.prepare("INSERT INTO settings (k, v) VALUES ('ai.day', ?)").bind(JSON.stringify({ day: Math.floor(NOW / 86_400_000), count: 150 })).run();
  assert.equal(await think(quota.env, { model: 'llama', system: 's', prompt: 'p', now: NOW }), null);
  assert.equal(await runKeepers(quota.env, NOW, queueSelfBurn), 1);
  assert.equal(quota.env.AI.calls.length, 0);
});

test('a candle with a Keeper is not burned on distribution: its Keeper picks the moment', async () => {
  const { db, mint } = await world({ ai: undefined, pending: 0 });
  await db.prepare("INSERT INTO shares (id, mint, at, sig, total_lamports, status, wick_lamports) VALUES (1, ?, 0, 's', 0, 'ok', 50000000)").bind(mint).run();
  const share = await db.prepare('SELECT * FROM shares WHERE id = 1').first();
  assert.equal(await setAsideSelf(db, share, 50_000_000, NOW), 0);
  assert.equal((await db.prepare('SELECT self_pending FROM matches WHERE mint = ?').bind(mint).first()).self_pending, 40_000_000);
  assert.equal((await coinBurns(db)).length, 0);
});

test('voices: a Keeper introduces itself once, and The Wick speaks after each $WICK buyback', async () => {
  const ai = fakeAI({ response: 'I keep the flame of $MOTH. Twenty percent, forever.' });
  const { env, db, mint } = await world({ ai, pending: 0 });
  await db.prepare('UPDATE matches SET lit_at = ? WHERE mint = ?').bind(NOW - HOUR, mint).run();
  await db.prepare("INSERT INTO burns (kind, ref, created_at, sol, status, burned_ui, burned_at) VALUES ('candle', '7', 0, 0.8, 'burned', 1234567, ?)").bind(NOW - 60_000).run();
  assert.equal(await runVoices(env, NOW), 2);
  assert.equal((await db.prepare('SELECT keeper_intro FROM matches WHERE mint = ?').bind(mint).first()).keeper_intro, 'I keep the flame of $MOTH. Twenty percent, forever.');
  assert.ok((await db.prepare("SELECT voice FROM burns WHERE kind = 'candle'").first()).voice);
  assert.equal(await runVoices(env, NOW + 60_000), 0);   // une seule fois
  assert.ok(await getSetting(db, 'ai.day'));
});
