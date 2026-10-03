import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exploreLaunches, walletProfile } from '../lib/explore.js';
import { launchTotals } from '../lib/cycles.js';
import { ensureSchema } from '../lib/schema.js';
import { fakeD1 } from './helpers/d1.js';

const NOW = 10 * 86_400_000;
const DAY = 86_400_000;

async function seeded() {
  const db = fakeD1();
  await ensureSchema(db);
  // mint, creator, seq, lit_at, vol24h, mcap_peak, vol_peak, holder, fee
  const rows = [
    ['old', 'Alice', 1, NOW - 5 * DAY, 90_000, 150_000, 90_000, 0, 'paid'],
    ['hot', 'Alice', 2, NOW - DAY, 40_000, 60_000, 40_000, 1, 'paid'],
    ['new', 'Bob', 3, NOW - 1000, 10, 5_000, 10, 0, 'failed'],
  ];
  for (const [mint, creator, seq, lit, vol, peak, vpeak, holder, fee] of rows) {
    await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, vol24h, mcap, mcap_at,
        mcap_peak, vol_peak, holder, fee_lamports, fee_state, signature)
      VALUES (?, ?, 'n', ?, 'x', 'i', 0, ?, ?, ?, 1000, ?, ?, ?, ?, 20000000, ?, ?)`)
      .bind(mint, creator, mint.toUpperCase(), seq, lit, vol, NOW - 60_000, peak, vpeak, holder, fee, `sig-${mint}`).run();
  }
  await db.prepare("INSERT INTO burns (kind, ref, created_at, status, burned_ui, sol) VALUES ('match', 'old', 0, 'burned', 70000, 0.0195), ('match', 'new', 0, 'burned', 90000, 0.0195), ('match', 'hot', 0, 'burned', 50000, 0.0195)").run();
  return db;
}

test('Explore: trending, new, top volume and biggest burner', async () => {
  const db = await seeded();
  const order = async (sort) => (await exploreLaunches(db, { sort, now: NOW })).coins.map((c) => c.mint);
  assert.deepEqual(await order('trending'), ['hot', 'new']);          // les 3 derniers jours seulement
  assert.deepEqual(await order('new'), ['new', 'hot', 'old']);
  assert.deepEqual(await order('volume'), ['old', 'hot', 'new']);
  assert.deepEqual(await order('burner'), ['new', 'old', 'hot']);
  assert.equal((await exploreLaunches(db, { sort: 'nope', now: NOW })).sort, 'trending');
  const coin = (await exploreLaunches(db, { sort: 'new', now: NOW })).coins[2];
  assert.equal(coin.volume, 90_000);
  assert.equal(coin.burned, 70_000);
  assert.equal(coin.sig, 'sig-old');
  assert.equal(coin.fee, 0.02);
  assert.equal((await exploreLaunches(db, { sort: 'new', now: NOW })).coins[0].fee, null);   // son Ignition Fee a échoué
  const page = await exploreLaunches(db, { sort: 'new', limit: 2, now: NOW });
  assert.equal(page.coins.length, 2);
  assert.equal(page.more, true);
});

test('Your flames: launches, burns, rank and achievements', async () => {
  const db = await seeded();
  const p = await walletProfile(db, 'Alice', NOW);
  assert.equal(p.launches, 2);
  assert.equal(p.burned, 120_000);
  assert.equal(p.volume24h, 130_000);
  assert.equal(p.ignitionSol, 0.04);
  assert.equal(p.holder, true);
  assert.deepEqual(p.rank, { rank: 1, of: 2 });
  const done = p.achievements.filter((a) => a.done).map((a) => a.id);
  assert.deepEqual(done, ['first', 'burn100k', 'golden', 'busy', 'viral']);
  assert.deepEqual(p.coins.map((c) => c.mint), ['hot', 'old']);

  const nobody = await walletProfile(db, 'Nobody', NOW);
  assert.equal(nobody.launches, 0);
  assert.equal(nobody.rank, null);
  assert.equal(nobody.title, null);
  assert.ok(nobody.achievements.every((a) => !a.done));
});

test('Dashboard: launches, ignition fees paid and 24h volume', async () => {
  const db = await seeded();
  assert.deepEqual(await launchTotals(db, NOW), {
    launches: 3, ignitionSol: 0.04, ignitionTeamSol: 0, ignitionBurnSol: 0.04, volume24h: 130_010, lastLaunch: { mint: 'new', symbol: 'NEW', at: NOW - 1000, sig: 'sig-new' },
  });
});
