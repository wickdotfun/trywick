import assert from 'node:assert/strict';
import test from 'node:test';
import { PHRASE_WORDS, WORDS, checkName, newName, newPhrase, normalizePhrase } from '../lib/players.js';

test('a new phrase has 12 words from our own list', () => {
  const words = newPhrase().split(' ');
  assert.equal(words.length, PHRASE_WORDS);
  assert.ok(words.every((w) => WORDS.includes(w)));
  assert.equal(new Set(WORDS).size, WORDS.length, 'no duplicate words');
  assert.ok(WORDS.every((w) => /^[a-z]+$/.test(w)), 'plain lowercase words');
  assert.ok(WORDS.length >= 256, 'at least 96 bits for 12 words');
});

test('phrases are normalized: case, accents, punctuation, numbering', () => {
  const phrase = newPhrase();
  const messy = phrase.split(' ').map((w, i) => `${i + 1}. ${w.toUpperCase()}`).join(',\n');
  assert.equal(normalizePhrase(messy), phrase);
  const [a, b] = WORDS;
  assert.equal(normalizePhrase(`  ${a.toUpperCase()}   ${b} ${phrase.split(' ').slice(2).join(' ')}`), [a, b, ...phrase.split(' ').slice(2)].join(' '));
});

test('wrong phrases are rejected before any lookup', () => {
  assert.equal(normalizePhrase(WORDS.slice(0, 2).join(' ')), null, 'too short');
  assert.equal(normalizePhrase(`${newPhrase()} ${WORDS[0]}`), null, 'too long');
  // A wallet seed (English BIP39 words) never matches our list.
  assert.equal(normalizePhrase('abandon ability able about above absent absorb abstract absurd abuse access accident'), null);
  assert.equal(normalizePhrase('cat dog lion moon sun river apple orange banana ocean forest candle'), null);
  // Common BIP39 words are simply not in our list.
  for (const w of ['cat', 'dog', 'moon', 'candle', 'fire', 'zoo', 'abandon', 'zebra', 'panda', 'mango']) assert.ok(!WORDS.includes(w), w);
  assert.equal(normalizePhrase(null), null);
});

test('random names are valid usernames', () => {
  for (let i = 0; i < 200; i++) {
    const n = newName();
    assert.match(n, /^[A-Za-z]+\d{2}$/);
    assert.deepEqual(checkName(n), { name: n });
  }
});

test('usernames: 3-20 letters, numbers or _, no impersonation', () => {
  assert.deepEqual(checkName('@Akimbo365'), { name: 'Akimbo365' });
  assert.deepEqual(checkName('  cool_name  '), { name: 'cool_name' });
  assert.equal(checkName('ab').error, 'short');
  assert.equal(checkName('a'.repeat(21)).error, 'long');
  assert.equal(checkName('hello world').error, 'chars');
  assert.equal(checkName('émile').error, 'chars');
  for (const n of ['wick', 'WICK_team', 'trywickdotfun', 'wickdotfun', 'WickOfficial', 'admin', 'Support']) assert.equal(checkName(n).error, 'reserved', n);
  assert.deepEqual(checkName('Wicked'), { name: 'Wicked' });
});
