import assert from 'node:assert/strict';
import test from 'node:test';
import { isSolanaAddress, isTxSignature, lastDeadline, nextDeadline, shortAddress } from '../lib/rewards.js';
import { traitsFor } from '../lib/traits.js';
import { pickWinners } from '../lib/world.js';

test('the weekly draw is on Sunday at 20:00 UTC', () => {
  // Mercredi 30 septembre 2026, 12 h UTC → le dernier tirage était le dimanche 27 à 20 h.
  const wed = Date.UTC(2026, 8, 30, 12);
  assert.equal(lastDeadline(wed), Date.UTC(2026, 8, 27, 20));
  assert.equal(nextDeadline(wed), Date.UTC(2026, 9, 4, 20));
  // Dimanche 19 h 59 : pas encore ; dimanche 20 h : c'est l'heure.
  assert.equal(lastDeadline(Date.UTC(2026, 9, 4, 19, 59)), Date.UTC(2026, 8, 27, 20));
  assert.equal(lastDeadline(Date.UTC(2026, 9, 4, 20)), Date.UTC(2026, 9, 4, 20));
});

test('only public Solana addresses are accepted', () => {
  assert.ok(isSolanaAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'));
  assert.ok(!isSolanaAddress(''));
  assert.ok(!isSolanaAddress('abandon ability able about above absent absorb abstract absurd abuse access accident'));
  // Une clé privée (88 caractères) n'est pas une adresse.
  assert.ok(!isSolanaAddress('4'.repeat(88)));
  assert.ok(!isSolanaAddress('0OIl'.repeat(10)), 'not base58');
  assert.ok(isTxSignature('5'.repeat(87)));
  assert.ok(!isTxSignature('abc'));
  assert.equal(shortAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), '7xKX…gAsU');
});

test('the eternal flame is gold, and the rest of the look stays', () => {
  for (let seed = 1; seed < 200; seed++) {
    const t = traitsFor(seed, true);
    assert.equal(t.flame.key, 'eternelle');
    assert.equal(t.wax.key, traitsFor(seed).wax.key);
    assert.equal(t.accessory, traitsFor(seed).accessory);
  }
});

test('looks are varied but not endless: 8 waxes, 6 flames, 5 accessories', () => {
  const seen = new Set();
  for (let seed = 1; seed < 20000; seed++) {
    const t = traitsFor(seed);
    seen.add(`${t.wax.key}|${t.flame.key}|${t.accessory}`);
  }
  assert.equal(seen.size, 8 * 6 * 5);
  assert.ok(![...seen].some((k) => k.endsWith('|moustache')), 'no moustache');
});

test('a winner per home: never two winners from the same IP or address', () => {
  const c = (id, ip, payout) => ({ id, ip, payout });
  const picked = pickWinners([c(1, 'a', 'x1'), c(2, 'a', 'x2'), c(3, 'b', 'x1'), c(4, 'c', 'x4'), c(5, 'd', 'x5')], 3);
  assert.deepEqual(picked.map((w) => w.id), [1, 4, 5]);
});
