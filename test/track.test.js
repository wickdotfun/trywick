import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { refreshMarkets } from '../lib/markets.js';
import { crossed, missions, nextStep } from '../lib/missions.js';
import { operatorLog } from '../lib/operator.js';
import { ensureSchema } from '../lib/schema.js';
import { trackBurn, trackMarket } from '../lib/track.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = 900 * DAY;

async function coin(extra = {}) {
  const db = fakeD1();
  await ensureSchema(db);
  const mint = Keypair.generate().publicKey.toBase58();
  const m = { keeper_style: 'degen', self_bps: 2000, lit_at: NOW - 10 * DAY, self_burned: 0, self_burns: 0, ...extra };
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, keeper_model, self_bps,
      self_burned, self_burns, self_sol, share_state) VALUES (?, 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, ?, 'llama', ?, ?, ?, 0.4, 'shared')`)
    .bind(mint, m.lit_at, m.keeper_style, m.self_bps, m.self_burned, m.self_burns).run();
  const row = () => db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
  return { db, mint, row };
}

test('steps: the highest crossed since the last one, and the next one', () => {
  const steps = [10, 25, 50, 100];
  assert.equal(crossed(steps, 60), 50);
  assert.equal(crossed(steps, 60, 50), null);
  assert.equal(crossed(steps, 120, 25), 100);
  assert.equal(crossed(steps, 5), null);
  assert.equal(crossed(steps, null), null);
  assert.equal(nextStep(steps, 25), 50);
  assert.equal(nextStep(steps, 100), null);
});

test('market milestones: noted once each, the highest crossed, 15 minutes apart, never again after a dip', async () => {
  const { db, mint, row } = await coin();
  const r = await row();
  assert.equal(await trackMarket(db, r, { mcap: 130_000, vol: 60_000 }, NOW), 'mcap:100000');
  let log = await operatorLog(db, mint);
  assert.equal(log[0].title, 'Reached a $100K market cap');
  assert.equal(log[0].detail, '$MOTH trades at a $130K market cap.');
  assert.equal(await trackMarket(db, await row(), { mcap: 130_000, vol: 60_000 }, NOW + 5 * MIN), null, 'cooling down');
  assert.equal(await trackMarket(db, await row(), { mcap: 130_000, vol: 60_000 }, NOW + 16 * MIN), 'vol:50000');
  assert.equal(await trackMarket(db, await row(), { mcap: 40_000, vol: 1_000 }, NOW + 40 * MIN), null);
  assert.equal(await trackMarket(db, await row(), { mcap: 140_000, vol: 1_000 }, NOW + 60 * MIN), null, 'back above $100K: not again');
  log = await operatorLog(db, mint);
  assert.deepEqual(log.map((e) => e.title), ['$50K traded in 24 hours', 'Reached a $100K market cap']);
  assert.equal((await row()).op_mcap, 100_000);
});

test('a coin without an Operator is not tracked', async () => {
  const { db, row } = await coin({ keeper_style: null });
  assert.equal(await trackMarket(db, await row(), { mcap: 500_000, vol: 0 }, NOW), null);
});

test('burn milestones: the share of its own supply the coin burned', async () => {
  const { db, mint, row } = await coin({ self_burned: 26_000_000, self_burns: 4 });
  assert.equal(await trackBurn(db, mint, NOW), 'burn:2.5');
  assert.equal((await operatorLog(db, mint))[0].title, '2.5% of the $MOTH supply burned');
  assert.equal((await row()).op_burn, 2.5);
  assert.equal(await trackBurn(db, mint, NOW + DAY), null);
});

test('the market refresh follows Operator coins for 30 days and notes their milestones', async () => {
  const { db, mint } = await coin({ lit_at: NOW - 12 * DAY });
  const old = await coin({ lit_at: NOW - 40 * DAY });
  await old.db.prepare('SELECT 1').first();
  globalThis.fetch = async (url) => Response.json(String(url).split('/').pop().split(',').map((a) => ({ baseToken: { address: a }, marketCap: 260_000, liquidity: { usd: 1 }, volume: { h24: 0 } })));
  assert.equal(await refreshMarkets({ DB: db }, NOW, null), 1);
  assert.equal((await operatorLog(db, mint))[0].title, 'Reached a $250K market cap');
  assert.equal(await refreshMarkets({ DB: old.db }, NOW, null), 0, 'past 30 days: no longer followed');
});

test('missions: what it did, what it aims for, what it always does', () => {
  const log = [
    { at: NOW - HOUR, kind: 'intro', title: 'First words' },
    { at: NOW - 2 * HOUR, kind: 'sealed', title: 'Locked' },
    { at: NOW - 3 * HOUR, kind: 'launched', title: 'Launched' },
  ];
  const fresh = missions({ symbol: 'MOTH', self_bps: 2000, self_pending: 4_000_000, self_burns: 0, mcap: 30_000, op_mcap: 25_000 }, log, NOW);
  assert.deepEqual(fresh.map((x) => [x.id, x.status]), [['launch', 'done'], ['seal', 'done'], ['intro', 'done'], ['kit', 'active'], ['mcap', 'active'], ['burn', 'active'], ['journal', 'done'], ['watch', 'ongoing']]);
  const mcap = fresh.find((x) => x.id === 'mcap');
  assert.equal(mcap.title, 'Reach a $50K market cap');
  assert.equal(mcap.progress, 0.6);
  assert.equal(fresh.find((x) => x.id === 'burn').title, 'Make its first burn');
  assert.equal(fresh.find((x) => x.id === 'burn').progress, 0.4);

  const burning = missions({ symbol: 'MOTH', self_bps: 2000, self_burns: 3, self_burned: 12_000_000, op_burn: 1, mcap: null, op_mcap: 0 }, log, NOW + 2 * DAY);
  assert.equal(burning.find((x) => x.id === 'burn').title, 'Burn 2.5% of the $MOTH supply');
  assert.equal(burning.find((x) => x.id === 'journal').status, 'active', 'no journal line in the last 24 hours');
  assert.equal(burning.find((x) => x.id === 'mcap').hint, 'Waiting for its first trades on DEX Screener');

  const plain = missions({ symbol: 'MOTH', self_bps: 0, mcap: 9_000, op_mcap: 0 }, [], NOW);
  assert.deepEqual(plain.map((x) => x.id), ['launch', 'intro', 'kit', 'mcap', 'journal', 'watch']);
});
