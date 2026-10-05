import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { coinPage } from '../lib/candles.js';
import { cleanPost, parseKit, runKits, templateKit } from '../lib/kit.js';
import { operatorLog } from '../lib/operator.js';
import { ensureSchema } from '../lib/schema.js';
import { getSetting } from '../lib/settings.js';
import { fakeD1 } from './helpers/d1.js';

const HOUR = 3_600_000;
const NOW = 700 * HOUR;
const KIT = {
  lore: 'Moths chase the flame. This one caught it, and now it keeps it burning for everyone.',
  x: ['$MOTH is live and the candle is lit. Come watch it burn.', 'Every moth dreams of the flame. $MOTH got there first.', 'Its Operator logs every move. Every burn has a receipt.'],
  telegram: '$MOTH is live.\n\nThe candle is lit.\nIts Operator is on duty.',
};
const ai = (reply) => ({ calls: [], async run(model, input) { this.calls.push({ model, input }); return reply; } });

async function coin(extra = {}) {
  const db = fakeD1();
  await ensureSchema(db);
  const mint = Keypair.generate().publicKey.toBase58();
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, keeper_model, self_bps, description)
    VALUES (?, 'C', 'Moth Flame', 'MOTH', 'u', 'i', 0, 1, ?, 'poet', 'mistral', ?, 'A moth that finally caught the flame.')`)
    .bind(mint, extra.lit_at ?? NOW - HOUR, extra.self_bps ?? 2000).run();
  return { db, mint };
}

test('a post is cleaned: no links, hashtags, emojis or quotes around it, cut to length', () => {
  assert.equal(cleanPost('"Buy now https://x.com #moon 🔥 lfg"', 100), 'Buy now lfg');
  assert.equal(cleanPost('a  b\n\n\n\nc', 100, true), 'a b\n\nc');
  assert.equal(cleanPost('one two three four', 10), 'one two…');
});

test('the AI kit is used when it is complete and clean; otherwise nothing', () => {
  const k = parseKit(`<think>hm</think>${JSON.stringify(KIT)}`);
  assert.equal(k.ai, true);
  assert.equal(k.x.length, 3);
  assert.equal(parseKit(JSON.stringify({ ...KIT, x: KIT.x.slice(0, 2) })), null, 'three X posts');
  assert.equal(parseKit(JSON.stringify({ ...KIT, lore: 'a porn moth that chases the flame forever and ever' })), null, 'off-limits');
  assert.equal(parseKit('no json'), null);
});

test('the template kit: every coin gets one, with its numbers', () => {
  const t = templateKit({ symbol: 'MOTH', name: 'Moth Flame', description: 'A moth that finally caught the flame.', self_bps: 3000 });
  assert.equal(t.ai, false);
  assert.match(t.x[0], /30% of its creator fees buy it back and burn it/);
  assert.match(t.telegram, /^\$MOTH is live\.\n\nA moth/);
  assert.match(templateKit({ symbol: 'X', name: 'X', self_bps: 0 }).x[0], /every coin is a candle/);
});

test('right after the launch, its Operator writes the kit once, with the CA, and logs it', async () => {
  const { db, mint } = await coin();
  const brain = ai({ response: JSON.stringify(KIT) });
  const env = { DB: db, AI: brain };
  assert.equal(await runKits(env, NOW), 1);
  assert.match(brain.calls[0].model, /mistral/);
  assert.match(brain.calls[0].input.messages[0].content, /Operator of \$MOTH/);
  assert.equal(await runKits(env, NOW + HOUR), 0, 'once');
  const page = await coinPage(db, mint);
  const kit = page.operator.kit;
  assert.equal(kit.ai, true);
  assert.equal(kit.x[0], `${KIT.x[0]}\n\nCA: ${mint}`);
  assert.equal(kit.x[1], KIT.x[1]);
  assert.ok(kit.telegram.endsWith(`CA: ${mint}`));
  assert.equal(page.operator.missions.find((x) => x.id === 'kit').status, 'done');
  const log = await operatorLog(db, mint);
  assert.equal(log[0].title, 'Prepared the launch kit');
  assert.equal((await getSetting(db, 'ai.day')).kit, 1, 'its own daily budget');
});

test('without AI, the kit comes from its templates; coins older than 7 days are left alone', async () => {
  const { db, mint } = await coin();
  assert.equal(await runKits({ DB: db }, NOW), 1);
  const kit = (await coinPage(db, mint)).operator.kit;
  assert.equal(kit.ai, false);
  assert.match((await operatorLog(db, mint))[0].detail, /from its templates/);
  const old = await coin({ lit_at: NOW - 8 * 24 * HOUR });
  assert.equal(await runKits({ DB: old.db }, NOW), 0);
});
