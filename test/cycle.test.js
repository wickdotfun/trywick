import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cycleProgress } from '../lib/candle.js';
import { cycleTiming } from '../lib/config.js';
import { tickCycle } from '../lib/cycles.js';
import { ensureSchema } from '../lib/schema.js';
import { fakeD1 } from './helpers/d1.js';

const MIN = 60_000;
const timing = { durationMs: 30 * MIN, matchMs: MIN };

test('a candle melts in 30 minutes', () => {
  assert.equal(cycleProgress({ startedAt: 0, matches: 0 }, 0, timing).melted, 0);
  assert.equal(cycleProgress({ startedAt: 0, matches: 0 }, 15 * MIN, timing).melted, 0.5);
  const end = cycleProgress({ startedAt: 0, matches: 0 }, 30 * MIN, timing);
  assert.equal(end.done, true);
  assert.equal(end.remainingMs, 0);
});

test('every match takes one minute off', () => {
  const p = cycleProgress({ startedAt: 0, matches: 10 }, 5 * MIN, timing);
  assert.equal(p.remainingMs, 15 * MIN);
  assert.equal(p.melted, 0.5);
  assert.equal(cycleProgress({ startedAt: 0, matches: 40 }, 0, timing).done, true);
});

test('timing can be changed from the environment', () => {
  assert.deepEqual(cycleTiming({}), timing);
  assert.deepEqual(cycleTiming({ CYCLE_MINUTES: '10', MATCH_MINUTES: '0.5' }), { durationMs: 10 * MIN, matchMs: MIN / 2 });
  assert.deepEqual(cycleTiming({ CYCLE_MINUTES: 'nope', MATCH_MINUTES: '-1' }), timing);
});

test('the candle burns out on time and a new one is lit', async () => {
  const env = { DB: fakeD1() };
  await ensureSchema(env.DB);
  const first = await tickCycle(env, 0);
  assert.equal(first.id, 1);
  assert.equal((await tickCycle(env, 29 * MIN)).id, 1);
  const second = await tickCycle(env, 30 * MIN);
  assert.equal(second.id, 2);
  assert.equal(second.started_at, 30 * MIN);
  const old = await env.DB.prepare('SELECT * FROM cycles WHERE id = 1').first();
  assert.equal(old.status, 'ended');
  assert.equal(old.ended_at, 30 * MIN);
  // Une seule bougie allumée, même si on insiste.
  await env.DB.prepare('INSERT OR IGNORE INTO cycles (started_at) VALUES (?)').bind(31 * MIN).run();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM cycles WHERE ended_at IS NULL').first();
  assert.equal(n, 1);
});
