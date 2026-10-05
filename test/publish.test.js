import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { logAction } from '../lib/operator.js';
import { handleUpdate, isHighlight, runPublish, webhookSecret } from '../lib/publish.js';
import { ensureSchema } from '../lib/schema.js';
import { telegramHook } from '../src/api/telegram.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = 1_000 * DAY + 5 * HOUR;
const GROUP = -100123;

// Un faux Telegram : qui est admin, ce qui est envoyé, et les groupes qui ont retiré le bot.
function fakeTelegram({ admins = [7], gone = [] } = {}) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop();
    const body = JSON.parse(init.body);
    if (method === 'getChatMember') return Response.json({ ok: true, result: { status: admins.includes(body.user_id) ? 'administrator' : 'member' } });
    if (method === 'setWebhook') return Response.json({ ok: true, result: true });
    if (method === 'getMe') return Response.json({ ok: true, result: { username: 'WickFireBot' } });
    if (gone.includes(body.chat_id)) return Response.json({ ok: false, description: 'Forbidden: bot was kicked from the supergroup chat' });
    sent.push({ method, ...body });
    return Response.json({ ok: true, result: { message_id: sent.length } });
  };
  return sent;
}

async function world() {
  const db = fakeD1();
  await ensureSchema(db);
  const mint = Keypair.generate().publicKey.toBase58();
  await db.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, keeper_style, keeper_model, self_bps, image, mcap, vol24h, change24h, keeper_thought, op_kit)
    VALUES (?, 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, ?, 'degen', 'llama', 2000, 'https://ipfs.io/ipfs/x', 120000, 40000, 12, 'we are so early', ?)`)
    .bind(mint, NOW - DAY, JSON.stringify({ telegram: '$MOTH is live.\n\nCA: x', x: [], lore: '' })).run();
  await logAction(db, mint, { kind: 'launched', title: 'Launched $MOTH on pump.fun', at: NOW - DAY, ref: 'launched' });
  return { env: { DB: db, TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '@wick', SITE_URL: 'https://trywick.fun' }, db, mint };
}
const msg = (text, from = 7, type = 'supergroup') => ({ message: { text, from: { id: from }, chat: { id: GROUP, type, title: 'Moth army' } } });

test('a group admin links a coin with /link <CA>: its kit is posted, and the Operator logs it', async () => {
  const { env, db, mint } = await world();
  const sent = fakeTelegram();
  assert.equal(await handleUpdate(env, msg(`/link ${mint}`), NOW), 'linked');
  assert.equal(sent[0].method, 'sendPhoto');
  assert.equal(sent[0].photo, 'https://ipfs.io/ipfs/x');
  assert.match(sent[0].caption, /\$MOTH is live\./);
  assert.match(sent[0].caption, /my milestones, my burns, and a recap every day/);
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].url, `https://trywick.fun/#coin/${mint}`);
  const row = await db.prepare('SELECT * FROM op_channels').first();
  assert.equal(row.chat_id, String(GROUP));
  assert.equal((await db.prepare("SELECT title FROM operator_log WHERE kind = 'posted'").first()).title, 'Started posting in a Telegram group');
  assert.equal(await handleUpdate(env, msg(`/link ${mint}`), NOW), 'already');
  assert.equal(await handleUpdate(env, msg('/link $moth'), NOW), 'already', 'by ticker too');
});

test('only admins link; unknown coins are refused; /unlink stops it', async () => {
  const { env, mint } = await world();
  const sent = fakeTelegram();
  assert.equal(await handleUpdate(env, msg(`/link ${mint}`, 99), NOW), 'not_admin');
  assert.equal(await handleUpdate(env, msg(`/link ${Keypair.generate().publicKey.toBase58()}`), NOW), 'unknown');
  assert.equal(await handleUpdate(env, { message: { text: '/start', chat: { id: 5, type: 'private' } } }, NOW), 'help');
  assert.equal(await handleUpdate(env, msg('hello there'), NOW), null);
  await handleUpdate(env, msg(`/link ${mint}`), NOW);
  assert.equal(await handleUpdate(env, msg('/unlink'), NOW), 'unlinked');
  assert.match(sent.at(-1).text, /Unlinked/);
});

test('the webhook only accepts Telegram (its secret)', async () => {
  const { env } = await world();
  fakeTelegram();
  const call = (secret) => telegramHook({ env, request: new Request('https://x/api/telegram', { method: 'POST', headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {}, body: JSON.stringify(msg('/status')) }) });
  assert.equal((await call('nope')).status, 401);
  assert.equal((await call(await webhookSecret(env))).status, 200);
});

test('in a linked group: new milestones and burns are posted, 10 minutes apart, then a daily recap', async () => {
  const { env, db, mint } = await world();
  const sent = fakeTelegram();
  await handleUpdate(env, msg(`/link ${mint}`), NOW);
  sent.length = 0;
  await logAction(db, mint, { kind: 'milestone', title: 'Reached a $100K market cap', detail: '$MOTH trades at a $120K market cap.', at: NOW + MIN, ref: 'mcap:100000' });
  await logAction(db, mint, { kind: 'journal', title: 'Journal', detail: 'hm', at: NOW + MIN, ref: 'j' });
  assert.equal(await runPublish(env, NOW + 5 * MIN), 0, 'too soon after the welcome post');
  assert.equal(await runPublish(env, NOW + 11 * MIN), 1);
  const update = sent.find((s) => s.method === 'sendMessage');
  assert.match(update.text, /agent update/);
  assert.match(update.text, /Reached a \$100K market cap/);
  assert.ok(!/Journal/.test(update.text), 'only milestones and burns');
  await logAction(db, mint, { kind: 'burned', title: 'Burned 1,000 $MOTH', detail: '0.1 SOL', sig: 'SIG1', at: NOW + 12 * MIN, ref: 'b1' });
  assert.equal(await runPublish(env, NOW + 15 * MIN), 0);
  assert.equal(await runPublish(env, NOW + 22 * MIN), 1);
  assert.match(sent.filter((s) => s.method === 'sendMessage').at(-1).text, /solscan\.io\/tx\/SIG1/);
  // Plus rien de neuf : le récap du jour, une fois les 24 heures passées.
  assert.equal(await runPublish(env, NOW + 40 * MIN), 0);
  assert.equal(await runPublish(env, NOW + DAY + MIN), 1);
  const recap = sent.at(-1);
  assert.equal(recap.method, 'sendPhoto');
  assert.match(recap.caption, /daily recap/);
  assert.match(recap.caption, /Market cap: <b>\$120K<\/b> \(\+12% 24h\)/);
  assert.match(recap.caption, /we are so early/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operator_log WHERE title = 'Posted its daily recap on Telegram'").first()).n, 1);
});

test('a group that removed the bot is forgotten', async () => {
  const { env, db, mint } = await world();
  fakeTelegram();
  await handleUpdate(env, msg(`/link ${mint}`), NOW);
  fakeTelegram({ gone: [String(GROUP)] });
  await logAction(db, mint, { kind: 'milestone', title: 'Reached a $100K market cap', at: NOW + MIN, ref: 'mcap:100000' });
  await runPublish(env, NOW + 20 * MIN);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM op_channels').first()).n, 0);
});

test('highlights: only big moments go to the WICK channel, never the past', async () => {
  const { env, db, mint } = await world();
  const sent = fakeTelegram();
  await logAction(db, mint, { kind: 'milestone', title: 'Reached a $250K market cap', at: NOW - HOUR, ref: 'mcap:250000' });
  await runPublish(env, NOW);
  assert.equal(sent.length, 0, 'first pass: starts from here');
  await logAction(db, mint, { kind: 'milestone', title: 'Reached a $50K market cap', at: NOW + MIN, ref: 'mcap:50000' });
  await logAction(db, mint, { kind: 'milestone', title: 'Reached a $500K market cap', at: NOW + MIN, ref: 'mcap:500000' });
  await runPublish(env, NOW + 2 * MIN);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, '@wick');
  assert.match(sent[0].caption, /Reached a \$500K market cap/);
  assert.ok(isHighlight('burn:5') && !isHighlight('burn:2.5') && !isHighlight('vol:1000000'));
});
