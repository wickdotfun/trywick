import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keeperChoices, thinkWith } from '../lib/keepers.js';
import { callPremium, crewEarned, premiumFunded } from '../lib/minds.js';
import { CONFIG } from '../lib/config.js';
import { ensureSchema } from '../lib/schema.js';
import { fakeD1 } from './helpers/d1.js';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const mind = (id) => CONFIG.keepers.models.find((m) => m.id === id);
const llama = { run: async () => ({ response: 'Llama speaking.' }) };

async function db() {
  const d = fakeD1();
  await ensureSchema(d);
  return d;
}

test('the minds offered: one per provider, in order; premium ones usable only once their key is set', () => {
  const free = keeperChoices({}).models;
  assert.deepEqual(free.map((m) => m.by), ['OpenAI', 'Anthropic', 'Google', 'Qwen', 'xAI', 'DeepSeek', 'MiniMax', 'Mistral', 'Moonshot', 'Z.ai']);
  assert.equal(free.find((m) => m.id === 'llama'), undefined, 'Llama is the fallback, not offered');
  assert.deepEqual(free.filter((m) => m.premium).map((m) => [m.id, m.available]), [['claude', false], ['grok', false], ['minimax', false]]);
  assert.equal(keeperChoices({ ANTHROPIC_API_KEY: 'k' }).models.find((m) => m.id === 'claude').available, true);
});

test('each provider gets its own request, and its text comes back', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ host: new URL(url).host, url: String(url), headers: init.headers, body });
    if (url.includes('anthropic')) return Response.json({ content: [{ type: 'text', text: 'From Claude.' }] });
    if (url.includes('googleapis')) return Response.json({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'From Gemini.' }] } }] });
    return Response.json({ choices: [{ message: { content: url.includes('x.ai') ? 'From Grok.' : 'From GPT.' } }] });
  };
  const env = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', XAI_API_KEY: 'x', PREMIUM_GPT_MODEL: 'gpt-next' };
  const ask = { system: 'You are an Operator.', prompt: 'Hello', maxTokens: 100, temperature: 0.5 };
  assert.equal(await callPremium(env, mind('claude'), ask), 'From Claude.');
  assert.equal(await callPremium(env, mind('gpt'), ask), 'From GPT.');
  assert.equal(await callPremium(env, mind('gemini'), ask), 'From Gemini.');
  assert.equal(await callPremium(env, mind('grok'), ask), 'From Grok.');
  const [claude, gpt, gemini, grok] = seen;
  assert.equal(claude.headers['x-api-key'], 'a');
  assert.equal(claude.body.system, 'You are an Operator.');
  assert.equal(claude.body.model, 'claude-sonnet-5-5');
  assert.equal(gpt.body.model, 'gpt-next', 'its model can change without a deploy');
  assert.equal(gpt.body.temperature, undefined, 'GPT-5 models keep their default temperature');
  assert.equal(gpt.headers.authorization, 'Bearer o');
  assert.match(gemini.url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(gemini.headers['x-goog-api-key'], 'g');
  assert.equal(grok.host, 'api.x.ai');
});

test('a coin gets its premium mind for 7 days, then while its crew earns enough', async () => {
  const d = await db();
  await d.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, share_team_bps, share_crew_bps)
    VALUES ('M1', 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, 3000, 2000)`).bind(NOW - 10 * DAY).run();
  const coin = { mint: 'M1', lit_at: NOW - 10 * DAY };
  assert.equal(await premiumFunded(d, null, NOW), true, 'Spark, before the launch');
  assert.equal(await premiumFunded(d, { ...coin, lit_at: NOW - DAY }, NOW), true, 'first 7 days');
  assert.equal(await premiumFunded(d, coin, NOW), false);
  // Le wallet de l'équipe a reçu 0,03 SOL : 2/3 pour le crew = 0,02 SOL.
  await d.prepare("INSERT INTO shares (mint, at, sig, status, team_lamports) VALUES ('M1', ?, 's1', 'ok', 30000000)").bind(NOW - DAY).run();
  await d.prepare("INSERT INTO shares (mint, at, sig, status, team_lamports) VALUES ('M1', ?, 's2', 'ok', 90000000)").bind(NOW - 9 * DAY).run();
  assert.equal(await crewEarned(d, 'M1', NOW), 20_000_000, 'only the last 7 days, only its crew part');
  assert.equal(await premiumFunded(d, coin, NOW), true);
});

test('thinking with a premium mind: it answers, or Llama takes over, and the site knows which', async () => {
  const d = await db();
  globalThis.fetch = async () => Response.json({ content: [{ type: 'text', text: 'Claude here.' }] });
  const base = { model: 'claude', system: 's', prompt: 'p', now: NOW, coin: { mint: 'M1', lit_at: NOW - DAY } };
  const a = await thinkWith({ DB: d, AI: llama, ANTHROPIC_API_KEY: 'k' }, base);
  assert.deepEqual([a.text, a.mind.id], ['Claude here.', 'claude']);
  const noKey = await thinkWith({ DB: d, AI: llama }, base);
  assert.deepEqual([noKey.text, noKey.mind.id], ['Llama speaking.', 'llama']);
  globalThis.fetch = async () => new Response('{"error":"overloaded"}', { status: 529 });
  const down = await thinkWith({ DB: d, AI: llama, ANTHROPIC_API_KEY: 'k' }, base);
  assert.equal(down.mind.id, 'llama', 'a provider error falls back to the free mind');
  const strict = await thinkWith({ DB: d, AI: llama, ANTHROPIC_API_KEY: 'k' }, { ...base, fallback: false });
  assert.equal(strict.text, null);
});
