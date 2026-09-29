import assert from 'node:assert/strict';
import test from 'node:test';
import { advance, applyAction, candleView, cooldownsFor, moodFor, newCandle, stageIndexFor, waxLost } from '../lib/candles.js';
import { traitsFor } from '../lib/traits.js';
import { CONFIG, DAY, HOUR } from '../lib/config.js';
import { pickPair } from '../lib/market.js';

const T0 = 1_000_000_000_000;
const baby = () => newCandle({ id: 1, playerId: 'p', name: 'Braise Timide #0001', color: '#fff', seed: 42 }, T0);

test('a new candle starts alive with some wax', () => {
  const v = candleView(baby(), T0, 'calme');
  assert.equal(v.alive, true);
  assert.equal(v.stage, 'bougie');
  assert.equal(v.wax, CONFIG.waxAtBirth);
  assert.equal(v.nextStage.key, 'chandelle');
});

test('wax melts at the same speed whatever the chart does', () => {
  assert.equal(waxLost(T0, T0 + 10 * HOUR), 10 * CONFIG.waxDecayPerHour);
  const calm = advance(baby(), T0 + 10 * HOUR, 'calme').candle;
  const panic = advance(baby(), T0 + 10 * HOUR, 'panique').candle;
  assert.equal(calm.wax, panic.wax, 'a dump never melts a candle faster');
});

test('a pumping chart makes candles grow faster, never slower', () => {
  const g = (mood) => advance(baby(), T0 + 10 * HOUR, mood).candle.growth;
  assert.equal(g('calme'), 10 * HOUR);
  assert.equal(g('panique'), 10 * HOUR);
  assert.equal(g('content'), 15 * HOUR);
  assert.equal(g('euphorie'), 20 * HOUR);
  assert.equal(candleView(baby(), T0, 'euphorie').boost, 2);
});

test('a forgotten candle dies at the exact moment its wax runs out', () => {
  const hours = CONFIG.waxAtBirth / CONFIG.waxDecayPerHour;
  const { candle, events } = advance(baby(), T0 + 100 * HOUR, 'calme');
  assert.equal(events[0].kind, 'died');
  assert.equal(candle.diedAt, T0 + hours * HOUR);
  const v = candleView(candle, T0 + 200 * HOUR, 'calme');
  assert.equal(v.alive, false);
  assert.equal(v.ageMs, hours * HOUR, 'a dead candle stops aging');
});

test('feeding, with a cooldown', () => {
  const c = advance(baby(), T0 + HOUR, 'calme').candle;
  const fed = applyAction(c, 'nourrir', T0 + HOUR);
  assert.equal(fed.candle.wax, Math.min(CONFIG.waxMax, c.wax + CONFIG.feedWax));
  assert.equal(fed.candle.feeds, 1);
  assert.equal(applyAction(fed.candle, 'nourrir', T0 + 2 * HOUR).error, 'cooldown');
  assert.ok(cooldownsFor(fed.candle, T0 + 2 * HOUR).nourrir > 0);
  assert.ok(applyAction(fed.candle, 'nourrir', T0 + HOUR + CONFIG.cooldown.nourrir).candle);
  assert.equal(applyAction(c, 'abri', T0).error, 'unknown_action');
});

test('dead candles cannot be cared for', () => {
  const dead = advance(baby(), T0 + 1000 * HOUR, 'calme').candle;
  assert.equal(applyAction(dead, 'nourrir', T0 + 1000 * HOUR).error, 'no_candle');
  assert.equal(applyAction(null, 'nourrir', T0).error, 'no_candle');
});

test('candles evolve with growth: taper on day 1, candlestick on day 3, torch on day 7', () => {
  assert.equal(stageIndexFor(0), 0);
  assert.equal(stageIndexFor(1 * DAY), 1);
  assert.equal(stageIndexFor(3 * DAY), 2);
  assert.equal(stageIndexFor(7 * DAY), 3);
  // Nourrie assez souvent, elle devient torche au bout de 7 jours, et entre au Hall of Fame.
  let c = baby();
  const events = [];
  for (let t = T0; t <= T0 + 7 * DAY; t += 6 * HOUR) {
    const r = advance(c, t, 'calme');
    events.push(...r.events);
    c = applyAction(r.candle, 'nourrir', t).candle;
  }
  assert.deepEqual(events.map((e) => e.detail), ['chandelle', 'chandelier', 'torche']);
  const v = candleView(c, T0 + 7 * DAY, 'calme');
  assert.equal(v.stage, 'torche');
  assert.equal(v.torchAt, T0 + 7 * DAY);
  assert.equal(v.nextStage, null);
  // En pleine euphorie, la chandelle arrive en 12 h.
  assert.equal(advance(baby(), T0 + 12 * HOUR, 'euphorie').candle.stage, 1);
});

test('every candle gets a stable unique look', () => {
  const a = traitsFor(42);
  assert.deepEqual(traitsFor(42), a, 'same seed, same look');
  assert.ok(a.wax.color && a.flame.color && a.accessory);
  assert.equal(a.rarity, undefined, 'no rarity');
  const looks = new Set(Array.from({ length: 200 }, (_, i) => JSON.stringify(traitsFor(i * 7919 + 1))));
  assert.ok(looks.size > 100, 'looks are varied');
  assert.deepEqual(candleView(baby(), T0, 'calme').look, a);
});

test('mood follows the 1h price change', () => {
  assert.equal(moodFor(12), 'euphorie');
  assert.equal(moodFor(3), 'content');
  assert.equal(moodFor(0), 'calme');
  assert.equal(moodFor(-5), 'stress');
  assert.equal(moodFor(-20), 'panique');
  assert.equal(moodFor(null), 'calme');
});

test('dexscreener: the pair with our token as base and the most liquidity wins', () => {
  const mint = 'MINT';
  const pairs = [
    { baseToken: { address: 'OTHER' }, liquidity: { usd: 1e9 } },
    { baseToken: { address: mint }, liquidity: { usd: 10 }, volume: { h24: 5 } },
    { baseToken: { address: mint }, liquidity: { usd: 500 } },
  ];
  assert.equal(pickPair(pairs, mint), pairs[2]);
  assert.equal(pickPair([], mint), null);
});
