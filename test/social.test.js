import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { MILESTONES, cardSvg, milestoneFile, staticCards, usdShort } from '../lib/cards.js';
import { ensureSchema } from '../lib/schema.js';
import { getSetting } from '../lib/settings.js';
import { postText, publish, runSocial } from '../lib/social.js';
import { oauthHeader, xPost } from '../lib/x.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const MIN = 60_000;
const NOW = 1_800_000_000_000;
const MINT = Keypair.generate().publicKey.toBase58();
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const X_KEYS = { X_API_KEY: 'ck', X_API_SECRET: 'cs', X_ACCESS_TOKEN: 'at', X_ACCESS_SECRET: 'as' };

// Un faux monde : DEX Screener (profil payé ou pas, market cap), Telegram, X, et les cartes du site.
function fakeWorld({ paid = false, mcap = 20_000, tgFails = false } = {}) {
  const sent = { telegram: [], x: [], media: 0 };
  const state = { paid, mcap, tgFails };
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('/orders/v1/solana/')) return Response.json(state.paid ? [{ type: 'tokenProfile', status: 'approved', paymentTimestamp: 1 }] : []);
    if (url.includes('/tokens/v1/solana/')) return Response.json([{ marketCap: state.mcap, info: null }]);
    if (url.includes('api.telegram.org')) {
      if (state.tgFails) return Response.json({ ok: false, description: 'chat not found' });
      const f = init.body;
      sent.telegram.push({ caption: f.get('caption'), photo: f.get('photo'), markup: JSON.parse(f.get('reply_markup') || 'null') });
      return Response.json({ ok: true, result: { message_id: 100 + sent.telegram.length } });
    }
    if (url === 'https://api.x.com/2/media/upload') {
      assert.match(init.headers.authorization, /^OAuth /);
      sent.media++;
      return Response.json({ data: { id: '777', media_key: '3_777' } });
    }
    if (url === 'https://api.x.com/2/tweets') {
      sent.x.push(JSON.parse(init.body));
      return Response.json({ data: { id: `90${sent.x.length}`, text: 'ok' } });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { sent, state };
}

async function env(extra = {}) {
  const db = fakeD1();
  await ensureSchema(db);
  const files = [];
  return {
    DB: db, TOKEN_MINT: MINT, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '@wick', files,
    ASSETS: { fetch: async (req) => { files.push(new URL(req.url).pathname); return new Response(PNG); } },
    ...extra,
  };
}

test('the cards: one per moment, milestones named and drawn from the same template', () => {
  assert.equal(usdShort(100_000), '$100K');
  assert.equal(usdShort(2_500_000), '$2.5M');
  assert.equal(milestoneFile(1_000_000), 'mcap-1m.png');
  const files = staticCards().map((c) => c.file);
  assert.deepEqual(files.slice(0, 3), ['live.png', 'dex-paid.png', 'mcap-50k.png']);
  assert.equal(files.length, 2 + MILESTONES.length);
  const lock = cardSvg('lock', { ticker: 'WICK', amount: 34029058, pct: 3.4, until: 'Oct 30, 2027', where: 'Stream<flow>' });
  assert.match(lock, /34,029,058/);
  assert.match(lock, /\$WICK LOCKED/);
  assert.match(lock, /Unlocks Oct 30, 2027/);
  assert.match(lock, /Stream&lt;flow&gt;/, 'text is escaped');
  assert.match(cardSvg('dexpaid', { ticker: 'WICK' }), /DEX PAID/);
});

test('DEX paid: posted once, with its card, on Telegram (and X when its keys are set)', async () => {
  const w = fakeWorld({ paid: true });
  const e = await env(X_KEYS);
  assert.deepEqual(await runSocial(e, NOW), ['dexpaid']);
  assert.equal(w.sent.telegram.length, 1);
  assert.match(w.sent.telegram[0].caption, /DEX PAID/);
  assert.match(w.sent.telegram[0].caption, new RegExp(MINT));
  assert.equal(w.sent.telegram[0].markup.inline_keyboard[0][1].url, `https://dexscreener.com/solana/${MINT}`);
  assert.deepEqual(e.files, ['/cards/dex-paid.png']);
  assert.equal(w.sent.media, 1);
  assert.deepEqual(w.sent.x[0].media, { media_ids: ['777'] });
  assert.match(w.sent.x[0].text, /^dex paid\./);
  assert.ok(!/https?:\/\//.test(w.sent.x[0].text), 'no link in the X text (a link costs more)');
  assert.equal((await getSetting(e.DB, 'social.dexpaid')).status, 'posted');

  assert.equal(await runSocial(e, NOW + MIN), null, 'checked every 3 minutes at most');
  assert.equal(await runSocial(e, NOW + 4 * MIN), null, 'never twice');
  assert.equal(w.sent.telegram.length, 1);
});

test('market cap milestones: the highest crossed, once each, never again after a dip', async () => {
  const w = fakeWorld({ mcap: 30_000 });
  const e = await env();
  assert.equal(await runSocial(e, NOW), null, 'below $50K: nothing');
  w.state.mcap = 130_000;
  assert.deepEqual(await runSocial(e, NOW + 4 * MIN), ['mcap.100000'], 'jumps straight to $100K, skipping $50K');
  assert.match(w.sent.telegram[0].caption, /\$100K/);
  assert.equal(e.files.at(-1), '/cards/mcap-100k.png');
  w.state.mcap = 80_000;
  assert.equal(await runSocial(e, NOW + 8 * MIN), null);
  w.state.mcap = 140_000;
  assert.equal(await runSocial(e, NOW + 12 * MIN), null, 'back above $100K: not posted again');
  w.state.mcap = 260_000;
  assert.deepEqual(await runSocial(e, NOW + 16 * MIN), ['mcap.250000']);
  assert.equal(w.sent.telegram.length, 2);
});

test('nothing before $WICK is live; a failed Telegram post is retried; no channel is recorded', async () => {
  fakeWorld({ paid: true });
  const before = await env({ TOKEN_MINT: undefined });
  assert.equal(await runSocial(before, NOW), null);

  const w = fakeWorld({ paid: true, tgFails: true });
  const e = await env();
  await runSocial(e, NOW);
  assert.equal(await getSetting(e.DB, 'social.dexpaid'), null, 'released: tried again next time');
  w.state.tgFails = false;
  await runSocial(e, NOW + 4 * MIN);
  assert.equal((await getSetting(e.DB, 'social.dexpaid')).status, 'posted');

  fakeWorld({ paid: true });
  const quiet = await env({ TELEGRAM_BOT_TOKEN: undefined });
  await runSocial(quiet, NOW);
  assert.equal((await getSetting(quiet.DB, 'social.dexpaid')).status, 'no_channel');
});

test('the lock post: amount, share of the supply, date, proof link', async () => {
  const w = fakeWorld();
  const e = await env(X_KEYS);
  const text = postText('lock', { amount: 34029058, pct: 3.4029058, until: 'Oct 30, 2027', where: 'Streamflow', link: 'https://app.streamflow.finance/contract/solana/abc' }, e);
  assert.match(text.caption, /34,029,058 \$WICK \(3\.4% of the supply\) locked until Oct 30, 2027 on Streamflow/);
  assert.match(text.caption, /<a href="https:\/\/app\.streamflow\.finance\/contract\/solana\/abc">Streamflow<\/a>/);
  assert.match(text.x, /^tokens are locked\./);
  const out = await publish(e, 'lock.manual.1', { image: PNG, mint: MINT, ...text }, { once: false });
  assert.deepEqual({ telegram: out.telegram, x: out.x }, { telegram: 101, x: '901' });
  assert.equal(w.sent.telegram.length, 1);
});

test('X: OAuth 1.0a signature (HMAC-SHA1 over the method, URL and oauth params)', async () => {
  const header = await oauthHeader(X_KEYS, 'POST', 'https://api.x.com/2/tweets', { nonce: 'abc', timestamp: 1700000000 });
  const params = { oauth_consumer_key: 'ck', oauth_nonce: 'abc', oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '1700000000', oauth_token: 'at', oauth_version: '1.0' };
  const base = `POST&${encodeURIComponent('https://api.x.com/2/tweets')}&${encodeURIComponent(Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&'))}`;
  const expected = createHmac('sha1', 'cs&as').update(base).digest('base64');
  assert.ok(header.includes(`oauth_signature="${encodeURIComponent(expected)}"`));
  for (const k of Object.keys(params)) assert.ok(header.includes(`${k}="`), k);

  const w = fakeWorld();
  assert.equal(await xPost(X_KEYS, { text: 'hello', image: PNG }), '901');
  assert.deepEqual(w.sent.x[0], { text: 'hello', media: { media_ids: ['777'] } });
});
