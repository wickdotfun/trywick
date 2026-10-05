import assert from 'node:assert/strict';
import { test } from 'node:test';
import { thinkWith } from '../lib/keepers.js';
import { burnsCsv, crewBook, proofPage, teamLock } from '../lib/proof.js';
import { ensureSchema } from '../lib/schema.js';
import { fakeD1 } from './helpers/d1.js';

const NOW = 1_800_000_000_000;

async function world() {
  const db = fakeD1();
  await ensureSchema(db);
  // Un coin partagé (60/20/10/10, Make it burn 20 %), payé ; ses distributions ; des burns.
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, fee_state, fee_lamports, team_lamports,
      share_bps, share_team_bps, share_crew_bps, self_bps, share_state) VALUES ('MOTHmint', 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, 'paid', 10000000, 5000000, 6000, 3000, 2000, 2000, 'shared')`).bind(NOW - 86_400_000).run();
  await db.prepare("INSERT INTO shares (mint, at, sig, status, total_lamports, wick_lamports, self_lamports, team_lamports) VALUES ('MOTHmint', ?, 's', 'ok', 1000000000, 300000000, 200000000, 300000000)").bind(NOW - 3600_000).run();
  const burn = (kind, ref, sol, burned, at, sig) => db.prepare("INSERT INTO burns (kind, ref, created_at, sol, status, burned_ui, burned_at, burn_sig, buy_sig) VALUES (?, ?, ?, ?, 'burned', ?, ?, ?, ?)")
    .bind(kind, ref, at, sol, burned, at, sig, `buy-${sig}`).run();
  await burn('match', 'MOTHmint', 0.005, 2000, NOW - 3000, 'B1');
  await burn('candle', '7', 0.4, 160000, NOW - 2000, 'B2');
  await burn('coin', 'MOTHmint:1', 0.2, 5_000_000, NOW - 1000, 'B3');
  await db.prepare("INSERT INTO operator_log (mint, at, kind, title, detail, ref) VALUES ('MOTHmint', ?, 'posted', 'Posted on X (@moth)', 'gm', 'x:1')").bind(NOW).run();
  return db;
}

test('proof: the wallets, the rules, and where every SOL went', async () => {
  const db = await world();
  const p = await proofPage({ DB: db, TOKEN_MINT: 'WICKmint' }, NOW);
  assert.deepEqual(p.wallets.map((w) => w.role), ['burn', 'team']);
  assert.equal(p.wallets[0].address, '5siQxef4aUDVRpYDjiSsjQrxju7xMXTRhfdD1KgXM69Z');
  assert.equal(p.wallets[1].address, '7ZMMe1Zhtspzq84w3Tf4iVYMd6jjuPxxRa1zz3eeLANN');
  assert.deepEqual(p.rules.split, { creatorPct: 60, crewPct: 20, burnPct: 10, teamPct: 10 });
  assert.deepEqual(p.rules.ignition, { burnPct: 50, teamPct: 50 });
  assert.equal(p.rules.wickCreatorFees, 'team');
  const f = p.flows;
  assert.deepEqual([f.ignitionSol, f.ignitionBurnSol, f.ignitionTeamSol], [0.01, 0.005, 0.005]);
  // Le wallet burn a reçu 0,3 SOL : 0,2 pour la bougie du coin, 0,1 pour $WICK. L'équipe 0,3 : 0,2 crew, 0,1 équipe.
  assert.equal(f.shareBurnSol, 0.1);
  assert.equal(f.shareSelfSol, 0.2);
  assert.equal(f.shareCrewSol, 0.2);
  assert.ok(Math.abs(f.shareTeamSol - 0.1) < 1e-9);
  assert.deepEqual([f.wickBurned, f.wickBurns, f.coinBurns, f.coinBurnSol], [162000, 2, 1, 0.2]);
  assert.deepEqual(p.receipts.map((r) => [r.kind, r.symbol, r.sig]), [['coin', 'MOTH', 'B3'], ['candle', null, 'B2'], ['match', 'MOTH', 'B1']]);
  assert.equal(p.crew.xPosts, 1);
  assert.equal(p.lock, null, 'no lock shown until there is one');
});

test('proof: what the crews spent, counted for real', async () => {
  const db = await world();
  globalThis.fetch = async () => Response.json({ content: [{ type: 'text', text: 'Claude here.' }] });
  const env = { DB: db, ANTHROPIC_API_KEY: 'k', AI: { run: async () => ({ response: 'Llama.' }) } };
  await thinkWith(env, { model: 'claude', system: 's', prompt: 'p', now: NOW });
  await thinkWith(env, { model: 'claude', system: 's', prompt: 'p', now: NOW });
  await thinkWith(env, { model: 'llama', system: 's', prompt: 'p', now: NOW });
  const c = await crewBook(db);
  assert.equal(c.premiumCalls, 2, 'only premium calls');
  assert.equal(c.spentUsd, Math.round((2 * c.rates.premiumUsdPerCall + c.rates.xUsdPerPost) * 100) / 100);
  assert.equal(c.earnedSol, 0.2);
});

test('proof: the team lock, only when it is real', () => {
  assert.equal(teamLock({}), null);
  assert.equal(teamLock({ TEAM_LOCK_URL: 'javascript:alert(1)' }), null);
  assert.deepEqual(teamLock({ TEAM_LOCK_URL: 'https://app.streamflow.finance/contract/solana/mainnet/abc', TEAM_LOCK_AMOUNT: '24050303', TEAM_LOCK_UNTIL: '2027-01-04T05:00:00Z' }),
    { url: 'https://app.streamflow.finance/contract/solana/mainnet/abc', amount: 24050303, until: Date.parse('2027-01-04T05:00:00Z') });
});

test('proof: every burn in a CSV', async () => {
  const csv = await burnsCsv(await world());
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'date_utc,kind,token,sol,burned,burn_tx,buy_tx');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /,coin,MOTH,0\.2,5000000,B3,buy-B3$/);
  assert.match(lines[2], /,buyback,WICK,0\.4,160000,B2,buy-B2$/);
});

test('a lock posted from the admin shows on the Proof page', async () => {
  const { proofPage } = await import('../lib/proof.js');
  const { setSetting } = await import('../lib/settings.js');
  const { ensureSchema } = await import('../lib/schema.js');
  const { fakeD1 } = await import('./helpers/d1.js');
  const DB = fakeD1();
  await ensureSchema(DB);
  assert.equal((await proofPage({ DB })).lock, null);
  await setSetting(DB, 'team.lock', { url: 'https://app.streamflow.finance/contract/solana/X', amount: 50_000_000, until: null, where: 'Streamflow' });
  assert.equal((await proofPage({ DB })).lock.url, 'https://app.streamflow.finance/contract/solana/X');
});
