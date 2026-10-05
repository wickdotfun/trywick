import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { CONFIG } from '../lib/config.js';
import { answerOf, runJournal, spendAi, textOf } from '../lib/keepers.js';
import { ensureSchema } from '../lib/schema.js';
import { askKeeper, blocked, parseSpark, sparkCoin, sparkImage } from '../lib/spark.js';
import { getSetting } from '../lib/settings.js';
import { fakeD1 } from './helpers/d1.js';

const HOUR = 3_600_000;
const NOW = 500 * HOUR;
const SPARK = JSON.stringify({ name: 'Dragon Candle', ticker: 'drgn', description: 'A tiny dragon that only breathes birthday candles.', intro: 'I keep the candle of $DRGN.', image: 'a tiny red dragon blowing a candle' });

function fakeAI(reply) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      const r = typeof reply === 'function' ? reply(model, input, calls.length) : reply;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
async function env(ai) {
  const db = fakeD1();
  await ensureSchema(db);
  return { DB: db, AI: ai, TOKEN_TICKER: 'WICK' };
}
async function coin(e, extra = {}) {
  const mint = Keypair.generate().publicKey.toBase58();
  const row = { keeper_style: 'degen', keeper_model: 'qwen', description: 'Moths love the flame.', self_bps: 0, mcap: 50_000, lit_at: NOW - 3 * HOUR, ...extra };
  await e.DB.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, keeper_model,
      keeper_intro, description, self_bps, mcap, vol24h) VALUES (?, 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, ?, ?, 'hi', ?, ?, ?, 9000)`)
    .bind(mint, row.lit_at, row.keeper_style, row.keeper_model, row.description, row.self_bps, row.mcap).run();
  return mint;
}

test('a Spark answer is cleaned to pump.fun limits, and refused when unusable or off-limits', () => {
  const s = parseSpark(`<think>hmm</think>Here: ${SPARK}`.replace('<think>hmm</think>', ''));
  assert.deepEqual(s, { name: 'Dragon Candle', symbol: 'DRGN', description: 'A tiny dragon that only breathes birthday candles.', intro: 'I keep the candle of $DRGN.', visual: 'a tiny red dragon blowing a candle' });
  assert.equal(parseSpark('no json at all'), null);
  assert.equal(parseSpark(JSON.stringify({ name: 'X', ticker: 'A', description: 'd' })), null, 'ticker too short');
  assert.equal(parseSpark(JSON.stringify({ name: 'Porn Coin', ticker: 'PRN', description: 'd' })), null);
  const long = parseSpark(JSON.stringify({ name: 'A'.repeat(60), ticker: '$super-long-ticker!', description: 'ok' }));
  assert.equal(long.name.length, CONFIG.limits.name);
  assert.equal(long.symbol, 'SUPERLON');
  assert.ok(blocked('a naked cat') && !blocked('a cat scared of fire') && !blocked('Sussex candles'));
});

test('reasoning models: only the answer counts, an unfinished thought is no answer', () => {
  assert.equal(answerOf('<think>let me see</think> {"a":1}'), '{"a":1}');
  assert.equal(answerOf('thinking without the opening tag</think>done'), 'done');
  assert.equal(answerOf('<think>still thinking…'), '');
  assert.equal(textOf({ output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'hmm' }] }, { type: 'message', content: [{ type: 'output_text', text: 'yo' }] }] }), 'yo');
});

test('Spark: the chosen mind invents the coin, in its personality', async () => {
  const ai = fakeAI({ response: SPARK });
  const e = await env(ai);
  const res = await sparkCoin(e, { idea: 'a tiny dragon who breathes birthday candles', style: 'pyro', model: 'mistral', ip: 'ip1', now: NOW });
  assert.equal(res.value.symbol, 'DRGN');
  assert.deepEqual(res.value.mind, { id: 'mistral', name: 'Mistral Small 3.1', by: 'Mistral', logo: '/brand/ai/mistral.svg' });
  assert.equal(ai.calls.length, 1);
  assert.match(ai.calls[0].model, /mistral/);
  assert.match(ai.calls[0].input.messages[0].content, /obsessed with fire/);
  assert.match(ai.calls[0].input.messages[1].content, /tiny dragon/);
  assert.equal((await getSetting(e.DB, 'ai.day')).spark, 1);
});

test('Spark: a bad answer from the chosen mind falls back to Llama; no AI, bad ideas and spam are refused', async () => {
  const ai = fakeAI((model) => ({ response: model.includes('deepseek') ? '<think>…' : SPARK }));
  const e = await env(ai);
  const res = await sparkCoin(e, { idea: 'moth coin', model: 'deepseek', ip: 'ip1', now: NOW });
  assert.equal(res.value.mind.id, 'llama');
  assert.deepEqual(ai.calls.map((c) => c.model.split('/')[1]), ['deepseek-ai', 'meta']);

  assert.equal((await sparkCoin(await env(undefined), { idea: 'moth coin', ip: 'x', now: NOW })).error, 'ai_off');
  assert.equal((await sparkCoin(e, { idea: 'hi', ip: 'x', now: NOW })).error, 'bad_idea');
  assert.equal((await sparkCoin(e, { idea: 'a nude moth', ip: 'x', now: NOW })).error, 'blocked_idea');
  for (let i = 0; i < CONFIG.keepers.perIpHour.spark - 1; i++) await sparkCoin(e, { idea: 'moth coin', ip: 'ip1', now: NOW });
  assert.equal((await sparkCoin(e, { idea: 'moth coin', ip: 'ip1', now: NOW })).error, 'too_many', 'per visitor and per hour');
  assert.ok((await sparkCoin(e, { idea: 'moth coin', ip: 'ip1', now: NOW + HOUR + 1 })).value, 'an hour later it works again');
});

test('the daily AI budget is per use: Spark running out never stops the Keepers', async () => {
  const e = await env(fakeAI({ response: SPARK }));
  for (let i = 0; i < CONFIG.keepers.daily.spark; i++) assert.ok(await spendAi(e.DB, 'spark', NOW));
  assert.equal(await spendAi(e.DB, 'spark', NOW), false);
  assert.equal((await sparkCoin(e, { idea: 'moth coin', ip: 'ip9', now: NOW })).error, 'ai_busy');
  assert.ok(await spendAi(e.DB, 'keeper', NOW));
  assert.ok(await spendAi(e.DB, 'spark', NOW + 24 * HOUR), 'a new day, a new budget');
});

test('the logo: Leonardo Phoenix paints it from the Operator\'s art direction; FLUX if Phoenix fails', async () => {
  const jpeg = new Uint8Array(2000).fill(7);
  // Phoenix renvoie un flux d'octets.
  const ai = fakeAI((model) => (model.includes('leonardo') ? new Response(jpeg).body : null));
  const e = await env(ai);
  const res = await sparkImage(e, { visual: 'a tiny red dragon, glossy 3D render', name: 'Dragon Candle', ip: 'ip1', now: NOW });
  assert.equal(res.bytes.length, 2000);
  assert.equal(res.model, '@cf/leonardo/phoenix-1.0');
  assert.match(ai.calls[0].input.prompt, /tiny red dragon/);
  assert.match(ai.calls[0].input.prompt, /No text/);
  assert.equal(ai.calls[0].input.width, 1024);
  // Phoenix en panne : FLUX (base64).
  const flux = await env(fakeAI((model) => (model.includes('leonardo') ? new Error('quota') : { image: Buffer.from(jpeg).toString('base64') })));
  const r2 = await sparkImage(flux, { visual: 'a dragon', name: 'x', ip: 'ip1', now: NOW });
  assert.equal(r2.model, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal((await sparkImage(e, { visual: 'a naked dragon', name: 'x', ip: 'ip1', now: NOW })).error, 'blocked_idea');
  const broken = await env(fakeAI(new Error('down')));
  assert.equal((await sparkImage(broken, { visual: 'a dragon', name: 'x', ip: 'ip1', now: NOW })).error, 'ai_failed');
});

test('Spark can surprise: no idea needed, the Operator invents the concept', async () => {
  const ai = fakeAI({ response: SPARK });
  const e = await env(ai);
  const res = await sparkCoin(e, { idea: '', surprise: true, ip: 'ip3', now: NOW });
  assert.equal(res.value.symbol, 'DRGN');
  assert.match(ai.calls[0].input.messages[1].content, /invent an original memecoin concept yourself/);
  assert.equal((await sparkCoin(e, { idea: '', ip: 'ip3', now: NOW })).error, 'bad_idea', 'without surprise, an idea is needed');
});

test('a coin\'s Keeper answers its holders in character, from the coin\'s real facts', async () => {
  const ai = fakeAI({ response: 'ser we are just getting started, the candle is lit' });
  const e = await env(ai);
  const mint = await coin(e);
  const res = await askKeeper(e, { mint, question: 'what is the story?', ip: 'ip1', now: NOW });
  assert.equal(res.value.answer, 'ser we are just getting started, the candle is lit');
  assert.deepEqual(res.value.keeper, { name: 'Operator of $MOTH', label: 'Degen', model: 'Qwen3 30B', by: 'Qwen', logo: '/brand/ai/qwen.svg' });
  const sys = ai.calls[0].input.messages[0].content;
  assert.match(sys, /Operator of \$MOTH/);
  assert.match(sys, /Moths love the flame/);
  assert.match(sys, /\$50,000/);
  assert.match(sys, /Never give financial advice/);
  assert.equal(ai.calls[0].input.messages[1].content, 'what is the story?');
  assert.equal((await askKeeper(e, { mint: 'nope', question: 'hi there', ip: 'ip1', now: NOW })).error, 'unknown_coin');
  assert.equal((await askKeeper(e, { mint, question: '?', ip: 'ip1', now: NOW })).error, 'bad_question');
});

test('The Wick knows WICK: its rules and its numbers', async () => {
  const ai = fakeAI({ response: 'Every coin here is a candle.' });
  const e = await env(ai);
  await coin(e, { self_bps: 2000 });
  const res = await askKeeper(e, { mint: 'wick', question: 'what is wick?', ip: 'ip1', now: NOW });
  assert.equal(res.value.keeper.name, 'The Wick');
  const sys = ai.calls[0].input.messages[0].content;
  assert.match(sys, /You are The Wick/);
  assert.match(sys, /not launched yet/);
  assert.match(sys, /"coins_launched":1/);
  assert.match(sys, /"coins_burning_themselves":1/);
  assert.match(sys, /locked on-chain/);
});

test('the journal: once a day, a Keeper writes a line its holders see', async () => {
  const ai = fakeAI({ response: '"Volume is up, the wax is warm."' });
  const e = await env(ai);
  const mint = await coin(e);
  assert.equal(await runJournal(e, NOW), 1);
  const row = await e.DB.prepare('SELECT keeper_thought, keeper_thought_at FROM matches WHERE mint = ?').bind(mint).first();
  assert.deepEqual({ ...row }, { keeper_thought: 'Volume is up, the wax is warm.', keeper_thought_at: NOW });
  assert.match(ai.calls[0].input.messages[1].content, /journal/);
  assert.equal(await runJournal(e, NOW + HOUR), 0, 'not again the same day');
  assert.equal(await runJournal(e, NOW + 21 * HOUR), 1);
  assert.equal((await getSetting(e.DB, 'ai.day')).journal, 1, 'counted in its own budget (a new day)');
  const quiet = await env(undefined);
  await coin(quiet);
  assert.equal(await runJournal(quiet, NOW), 0, 'without AI, no journal line (nothing made up)');
});
