import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candleOfSeq, candleState } from '../lib/candle.js';
import { matchesPerCandle } from '../lib/config.js';

test('a fresh world: candle #1, nothing melted', () => {
  assert.deepEqual(candleState(0, 1000), {
    number: 1, matches: 0, perCandle: 1000, melted: 0, burnedOut: 0, firstSeq: 1,
  });
});

test('the candle melts one match at a time', () => {
  const s = candleState(250, 1000);
  assert.equal(s.number, 1);
  assert.equal(s.matches, 250);
  assert.equal(s.melted, 0.25);
});

test('the last match finishes the candle and a new one starts', () => {
  const s = candleState(1000, 1000);
  assert.equal(s.burnedOut, 1);
  assert.equal(s.number, 2);
  assert.equal(s.matches, 0);
  assert.equal(s.firstSeq, 1001);
  assert.equal(candleOfSeq(1000, 1000), 1);
  assert.equal(candleOfSeq(1001, 1000), 2);
});

test('matches per candle can be changed from the environment', () => {
  assert.equal(matchesPerCandle({}), 1000);
  assert.equal(matchesPerCandle({ MATCHES_PER_CANDLE: '500' }), 500);
  assert.equal(matchesPerCandle({ MATCHES_PER_CANDLE: 'nope' }), 1000);
  assert.equal(matchesPerCandle({ MATCHES_PER_CANDLE: '0' }), 1000);
});
