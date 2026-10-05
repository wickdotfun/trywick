import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { runJournal, runKeepers, runVoices } from '../lib/keepers.js';
import { constitution, logAction, onLaunched, onSealed, operatorLog } from '../lib/operator.js';
import { ensureSchema } from '../lib/schema.js';
import { queueSelfBurn } from '../lib/sharing.js';
import { fakeD1 } from './helpers/d1.js';

const HOUR = 3_600_000;
const NOW = 400 * HOUR;
const ai = (reply) => ({ calls: [], async run() { return typeof reply === 'function' ? reply() : reply; } });

async function coin(extra = {}) {
  const db = fakeD1();
  await ensureSchema(db);
  const mint = Keypair.generate().publicKey.toBase58();
  const m = { keeper_style: 'pyro', keeper_model: 'qwen', self_bps: 3000, share_bps: 4000, share_team_bps: 500, share_state: 'shared', self_pending: 0, ...extra };
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, keeper_model,
      self_bps, share_bps, share_team_bps, share_state, self_pending, fee_sig, signature) VALUES (?, 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'FEESIG', 'LAUNCHSIG')`)
    .bind(mint, NOW - 30 * HOUR, m.keeper_style, m.keeper_model, m.self_bps, m.share_bps, m.share_team_bps, m.share_state, m.self_pending).run();
  return { db, mint, row: await db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first() };
}

test('the Constitution: what was set at launch, locked, with its on-chain proof', async () => {
  const { row } = await coin();
  const c = constitution(row);
  assert.equal(c.personality, 'Pyromaniac');
  assert.deepEqual(c.mind, { name: 'Qwen3 30B', by: 'Qwen', logo: '/brand/ai/qwen.svg' });
  assert.deepEqual(c.burn, { pct: 30, wickPct: 5, teamPct: 5, crewPct: 0 });
  assert.equal(c.proof, 'FEESIG');
  assert.deepEqual([c.canSell, c.canMoveFunds, c.locked], [false, false, true]);
  assert.ok(c.rules.some((r) => /only buy back \$MOTH and burn it/.test(r)));
  const plain = constitution({ ...row, self_bps: 0 });
  assert.equal(plain.burn, null);
  assert.equal(plain.proof, null);
  assert.equal(constitution({ ...row, keeper_style: null }), null, 'launched before Operators');
});

test('the log: each action once, newest first', async () => {
  const { db, mint, row } = await coin();
  assert.equal(await onLaunched(db, row, NOW - 30 * HOUR), true);
  assert.equal(await onLaunched(db, row, NOW - 29 * HOUR), false, 'the launch is noted once');
  await onSealed(db, row, NOW - 29 * HOUR);
  assert.equal(await logAction(db, mint, { kind: 'nope', title: 'x' }), false, 'unknown kinds are refused');
  const log = await operatorLog(db, mint);
  assert.deepEqual(log.map((e) => e.kind), ['sealed', 'launched']);
  assert.equal(log[1].title, 'Launched $MOTH on pump.fun');
  assert.equal(log[1].detail, 'Agent summoned: Pyromaniac on Qwen3 30B.');
  assert.equal(log[1].sig, 'LAUNCHSIG');
  assert.equal(log[0].title, 'Locked 30% of creator fees to burn $MOTH');
});

test('its first words, its journal and its decisions all land in its log', async () => {
  const { db, mint } = await coin({ self_pending: 20_000_000 });
  await db.prepare('UPDATE matches SET lit_at = ?, vol24h = 5000 WHERE mint = ?').bind(NOW - HOUR, mint).run();
  let reply = { response: 'Hello holders, I am lit.' };
  const env = { DB: db, AI: ai(() => reply) };
  await runVoices(env, NOW);
  reply = { response: '{"action":"wait","line":"Too calm, I wait."}' };
  await runKeepers(env, NOW, queueSelfBurn);
  await runKeepers(env, NOW + 2 * HOUR, queueSelfBurn);   // a second wait within 6 hours is not noted again
  reply = { response: '{"action":"burn","line":"Now. Burn it."}' };
  await runKeepers(env, NOW + 7 * HOUR, queueSelfBurn);
  reply = { response: 'The wax is warm today.' };
  await runJournal(env, NOW + 30 * HOUR);
  const log = await operatorLog(db, mint);
  assert.deepEqual(log.map((e) => e.kind), ['journal', 'decide', 'wait', 'intro']);
  assert.equal(log[3].detail, 'Hello holders, I am lit.');
  assert.equal(log[2].title, 'Held 0.020 SOL, waiting for a better moment');
  assert.equal(log[1].title, 'Decided to burn: 0.020 SOL');
  assert.equal(log[1].detail, 'Now. Burn it.');
  assert.equal(log[0].detail, 'The wax is warm today.');
});
