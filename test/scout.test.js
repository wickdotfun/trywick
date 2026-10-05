import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crewPage } from '../lib/crew.js';
import { logAction } from '../lib/operator.js';
import { ensureSchema } from '../lib/schema.js';
import { parseNarratives, plainNarratives, runScout, scoutTokens } from '../lib/scout.js';
import { fakeD1 } from './helpers/d1.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

// DEX Screener, faux : deux flux, puis le marché de leurs tokens.
function fakeDex() {
  const feed = [
    { chainId: 'solana', tokenAddress: 'FROG1', description: 'A frog that runs a casino' },
    { chainId: 'solana', tokenAddress: 'CAT1', description: 'The cat who owns the blockchain' },
    { chainId: 'base', tokenAddress: 'BASE1', description: 'not solana' },
    { chainId: 'solana', tokenAddress: 'TINY1', description: 'too small' },
  ];
  const pair = (address, name, symbol, mcap, vol) => ({ baseToken: { address, name, symbol }, marketCap: mcap, volume: { h24: vol }, priceChange: { h24: 42 }, liquidity: { usd: 1000 }, url: `https://dexscreener.com/solana/${address}` });
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('token-boosts') || url.includes('token-profiles')) return Response.json(feed);
    if (url.includes('/tokens/v1/solana/')) {
      assert.ok(!url.includes('BASE1'), 'only Solana tokens');
      return Response.json([pair('FROG1', 'Casino Frog', 'CFROG', 900_000, 2_000_000), pair('CAT1', 'Chain Cat', 'CCAT', 300_000, 500_000), pair('TINY1', 'Tiny', 'TINY', 5_000, 100)]);
    }
    throw new Error(`unexpected ${url}`);
  };
}

test('scout: Solana tokens only, with their market, big enough, busiest first', async () => {
  fakeDex();
  const tokens = await scoutTokens();
  assert.deepEqual(tokens.map((t) => t.symbol), ['CFROG', 'CCAT']);
  assert.equal(tokens[0].about, 'A frog that runs a casino');
  assert.equal(tokens[0].url, 'https://dexscreener.com/solana/FROG1');
});

test('scout: every narrative cites tokens it really saw', () => {
  const tokens = [{ symbol: 'CFROG' }, { symbol: 'CCAT' }];
  const text = JSON.stringify({ narratives: [
    { title: 'Animal casinos', angle: 'Animals running money games are trending.', idea: 'A hamster who deals blackjack on Solana', sources: ['$CFROG', 'FAKE'] },
    { title: 'Made up', angle: 'x', idea: 'An idea with no real source at all', sources: ['NOPE'] },
  ] });
  const out = parseNarratives(`<think>hmm</think>${text}`, tokens);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].sources, ['CFROG']);
  assert.equal(parseNarratives('no json', tokens), null);
  assert.equal(plainNarratives([{ symbol: 'CFROG', name: 'Casino Frog', about: 'A frog', vol: 2_000_000, change: 42 }])[0].title, '$CFROG is running');
});

test('scout: the cron reads the market every 30 minutes, with the AI or without it', async () => {
  fakeDex();
  const db = fakeD1();
  await ensureSchema(db);
  const answer = JSON.stringify({ narratives: [{ title: 'Animal casinos', angle: 'Frogs and cats run the tables.', idea: 'A hamster who deals blackjack on Solana', sources: ['CFROG', 'CCAT'] }] });
  const env = { DB: db, AI: { run: async () => ({ response: answer }) } };
  assert.equal(await runScout(env, NOW), 1);
  assert.equal(await runScout(env, NOW + 10 * MIN), 0, 'not again before 30 minutes');
  const page = await crewPage(db, NOW);
  assert.equal(page.scout.ai, true);
  assert.equal(page.scout.narratives[0].title, 'Animal casinos');
  assert.deepEqual(page.scout.sources.map((s) => s.symbol), ['CFROG', 'CCAT']);

  const plain = { DB: fakeD1() };
  await ensureSchema(plain.DB);
  assert.equal(await runScout(plain, NOW), 1);
  const s = (await crewPage(plain.DB, NOW)).scout;
  assert.equal(s.ai, false);
  assert.equal(s.narratives[0].title, '$CFROG is running');
});

test('the crew page: what the Operators are doing, their fresh coins, the biggest ones', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, keeper_model, keeper_goal, mcap, self_bps)
    VALUES ('M1', 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, 'analyst', 'qwen', 'meme', 120000, 2000)`).bind(NOW - 3600_000).run();
  await logAction(db, 'M1', { kind: 'launched', title: 'Launched', at: NOW - 3600_000, ref: 'launched' });
  await logAction(db, 'M1', { kind: 'journal', title: 'Journal', detail: 'Volume up.', at: NOW - 60_000 });
  const page = await crewPage(db, NOW);
  assert.equal(page.scout, null);
  assert.deepEqual(page.live.map((e) => e.kind), ['journal'], 'launch rows are shown with the fresh coins');
  assert.equal(page.live[0].coin.symbol, 'MOTH');
  assert.deepEqual(page.live[0].coin.mind.by, 'Qwen');
  assert.equal(page.fresh[0].character, 'Analyst');
  assert.equal(page.fresh[0].goal, 'Meme engine');
  assert.equal(page.fresh[0].burns, 20);
  assert.equal(page.top[0].mcap, 120000);
  assert.deepEqual(page.stats, { coins: 1, actions: 2, burns: 0, posts: 0 });
});
