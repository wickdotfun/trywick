import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedFee } from '../lib/buyback.js';
import { thinkWith } from '../lib/keepers.js';
import { mindBudget, orThink, publicModels, refreshCatalog, runCost, trimModel } from '../lib/openrouter.js';
import { ensureSchema } from '../lib/schema.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { fakeD1 } from './helpers/d1.js';

const NOW = Date.UTC(2026, 9, 6, 12);
const RAW = [
  { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', created: 2, context_length: 1_000_000, pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'qwen/qwen3.8-flash', name: 'Qwen: Qwen3.8 Flash', created: 1, context_length: 1_000_000, pricing: { prompt: '0.00000015', completion: '0.00000047' } },
  { id: 'qwen/qwen3.8-flash:free', name: 'free one', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/auto', name: 'Auto', pricing: { prompt: '-1', completion: '-1' } },
  { id: 'black-forest-labs/flux', name: 'image only', pricing: { prompt: '0.00001', completion: '0.00001' }, architecture: { output_modalities: ['image'] } },
];

async function world() {
  const DB = fakeD1();
  await ensureSchema(DB);
  globalThis.fetch = async (url) => (String(url).endsWith('/models') ? Response.json({ data: RAW }) : Response.json({}));
  await refreshCatalog({ DB }, NOW);
  await setSetting(DB, 'sol.usd', { usd: 150, at: NOW });
  return DB;
}
const coin = async (DB, extra = {}) => {
  const c = { mint: 'MintOR', fee_state: 'paid', fuel_lamports: 50_000_000, mind_or: 'anthropic/claude-sonnet-5.5', ...extra };
  await DB.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, keeper_model, fee_state, fuel_lamports, mind_or, share_team_bps, share_crew_bps)
    VALUES (?, 'C', 'Frog', 'FROG', 'x', 'i', 0, 1, ?, 'analyst', 'gpt-oss', ?, ?, ?, 3000, 2000)`).bind(c.mint, NOW, c.fee_state, c.fuel_lamports, c.mind_or).run();
  return c;
};

test('the catalog keeps the models an agent can use, with their lab and price', async () => {
  const DB = await world();
  const d = await publicModels({ DB }, NOW);
  assert.deepEqual(d.models.map((m) => m.id), ['anthropic/claude-sonnet-5.5', 'qwen/qwen3.8-flash'], 'no free-with-quota, no router, no image-only, newest first');
  assert.equal(d.models[0].name, 'Claude Sonnet 5.5');
  assert.equal(d.models[0].lab, 'Anthropic');
  assert.equal(d.models[0].logo, '/brand/ai/anthropic.svg');
  assert.equal(d.models[0].run, runCost(trimModel(RAW[0])));
  assert.equal(Math.round(d.models[0].run * 1e4) / 1e4, 0.006, '1,500 tokens in and 300 out on Sonnet: $0.006');
  assert.equal(d.ready, false, 'no key: the picker stays closed');
  assert.equal(d.solUsd, 150);
});

test('fuel rides with the team share of the launch fee, to the team wallet that pays the AI', () => {
  const row = { fee_lamports: 10_000_000, team_lamports: 5_000_000, fee_to: 'Burn', team_to: 'Team', fuel_lamports: 50_000_000 };
  assert.deepEqual(expectedFee(row).transfers, [{ to: 'Burn', lamports: 5_000_000 }, { to: 'Team', lamports: 55_000_000 }]);
  assert.deepEqual(expectedFee({ ...row, fuel_lamports: 0 }).transfers, [{ to: 'Burn', lamports: 5_000_000 }, { to: 'Team', lamports: 5_000_000 }]);
});

test('an agent thinks with its OpenRouter model while its budget lasts, pays the exact price, then falls back to a free mind', async () => {
  const DB = await world();
  await coin(DB);
  // 0.05 SOL of fuel at $150 = $7.50, plus 2/3 of what the team wallet got (20% agent of 30% team+agent).
  await DB.prepare("INSERT INTO shares (mint, at, sig, status, team_lamports) VALUES ('MintOR', ?, 'S1', 'ok', 30000000)").bind(NOW).run();
  const b = await mindBudget(DB, 'MintOR', 150);
  assert.equal(b.fuelSol, 0.05);
  assert.equal(b.crewSol, 0.02, '20% of the 30% that reached the team wallet');
  assert.equal(b.leftUsd, (0.05 + 0.02) * 150);

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization });
    return Response.json({ choices: [{ message: { content: 'Burned 1M $FROG.' } }], usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0024 } });
  };
  const env = { DB, OPENROUTER_API_KEY: 'sk-or', AI: { run: async () => ({ response: 'free mind' }) } };
  const r = await thinkWith(env, { model: 'gpt-oss', system: 'You are the agent.', prompt: 'Say something.', now: NOW, coin: { mint: 'MintOR' } });
  assert.equal(r.text, 'Burned 1M $FROG.');
  assert.equal(r.mind.name, 'Claude Sonnet 5.5');
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].auth, 'Bearer sk-or');
  assert.equal(calls[0].body.model, 'anthropic/claude-sonnet-5.5');
  const row = await DB.prepare("SELECT mind_spent, mind_runs FROM matches WHERE mint = 'MintOR'").first();
  assert.equal(row.mind_spent, 0.0024);
  assert.equal(row.mind_runs, 1);
  assert.equal((await getSetting(DB, 'or.day')).usd, 0.0024);

  // Budget empty: the free mind answers, and OpenRouter is not called.
  await DB.prepare("UPDATE matches SET mind_spent = 1000 WHERE mint = 'MintOR'").run();
  const before = calls.length;
  const free = await thinkWith(env, { model: 'gpt-oss', system: 's', prompt: 'p', now: NOW, coin: { mint: 'MintOR' } });
  assert.equal(calls.length, before);
  assert.equal(free.text, 'free mind');
});

test('no fuel until the launch fee is paid, and a daily safety cap for the whole site', async () => {
  const DB = await world();
  await coin(DB, { fee_state: 'sent' });
  assert.equal((await mindBudget(DB, 'MintOR', 150)).leftUsd, 0, 'fee not confirmed yet: its fuel does not count');
  await DB.prepare("UPDATE matches SET fee_state = 'paid' WHERE mint = 'MintOR'").run();
  await setSetting(DB, 'or.day', { day: Math.floor(NOW / 86_400_000), usd: 3 });
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({}); };
  assert.equal(await orThink({ DB, OPENROUTER_API_KEY: 'k' }, { mint: 'MintOR' }, { system: 's', prompt: 'p', maxTokens: 100, temperature: 0.5, now: NOW }), null);
  assert.equal(called, false, '$3 spent today: nothing more until tomorrow');
});
