import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair, SystemInstruction, Transaction } from '@solana/web3.js';
import { launchFee } from '../lib/buyback.js';
import { CONFIG } from '../lib/config.js';
import { supplyCandle } from '../lib/candle.js';
import { checkMilestones, hallList } from '../lib/hall.js';
import { leaderboard, titleFor } from '../lib/leaderboard.js';
import { pickMarkets } from '../lib/markets.js';
import { settleFee } from '../lib/matches.js';
import { ensureSchema } from '../lib/schema.js';
import { setSetting } from '../lib/settings.js';
import { base58, buildFeeTx, checkFeeTx, signTransaction } from '../lib/solana.js';
import { buybackWallet } from '../lib/buyback.js';
import { matchCaption, runTelegram } from '../lib/telegram.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const rpcOk = (result) => Response.json({ jsonrpc: '2.0', id: 1, result });

async function db() {
  const d = fakeD1();
  await ensureSchema(d);
  return d;
}

test('the candle is the $WICK supply: 0.5% per candle, never rebuilt', () => {
  assert.deepEqual(supplyCandle(0, 0.5), { number: 1, melted: 0, burnedPct: 0, stepPct: 0.5, consumed: 0 });
  const c = supplyCandle(1.2, 0.5);
  assert.equal(c.number, 3);
  assert.equal(c.consumed, 2);
  assert.ok(Math.abs(c.melted - 0.4) < 1e-9);
  assert.equal(supplyCandle(1.0, 0.5).number, 3);   // pile sur le palier : la bougie n° 2 est consumée
});

test('a consumed candle enters the hall once, with its story', async () => {
  const env = { DB: await db(), TOKEN_MINT: 'Mint', SOLANA_RPC: 'https://rpc.test' };
  // 10 M de $WICK brûlés sur une supply de départ de 1 Md : 1 % = 2 bougies consumées.
  await env.DB.prepare("INSERT INTO burns (kind, ref, created_at, status, burned_ui, sol, burned_at, burn_sig) VALUES ('candle', '1', 0, 'burned', 10000000, 1.5, 50, 'Sig1')").run();
  await env.DB.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, mcap)
    VALUES ('HotMint', 'C1', 'Hot', 'HOT', 'x', 'i', 0, 1, 5, 90000), ('ColdMint', 'C2', 'Cold', 'COLD', 'x', 'i', 0, 2, 6, 1000)`).run();
  globalThis.fetch = async () => rpcOk({ value: { uiAmountString: '990000000' } });
  assert.equal(await checkMilestones(env, 100), 2);
  assert.equal(await checkMilestones(env, 200), 0);
  const hall = await hallList(env.DB);
  assert.deepEqual(hall.map((h) => h.number), [2, 1]);
  assert.equal(hall[1].launches, 2);
  assert.equal(hall[1].top.symbol, 'HOT');
  assert.equal(hall[1].pct, 0.5);
  assert.equal(hall[1].burned, 5_000_000);
  assert.equal(hall[1].sol, 1.5);
  assert.equal(hall[1].burns, 1);
  assert.equal(hall[1].sig, 'Sig1');
});

test('the launch fee only exists while the buyback runs', async () => {
  const kp = Keypair.generate();
  const env = { DB: await db(), BUYBACK_SECRET_KEY: base58(kp.secretKey), BURN_WALLET: kp.publicKey.toBase58() };
  assert.equal(await launchFee(env), null);                                   // pas de $WICK encore
  env.TOKEN_MINT = Keypair.generate().publicKey.toBase58();
  // 50 % pour le burn, 50 % pour l'équipe (le dev wallet), dans la même transaction.
  assert.deepEqual(await launchFee(env), {
    lamports: 20_000_000,
    to: kp.publicKey.toBase58(),
    burn: 10_000_000,
    team: { to: CONFIG.launch.deployer, lamports: 10_000_000 },
    teamWallet: CONFIG.launch.deployer,
  });
  assert.equal((await launchFee({ ...env, TEAM_FEE_BPS: '0' })).burn, 20_000_000);
  assert.equal((await launchFee({ ...env, TEAM_FEE_BPS: '0' })).team, null);
  assert.equal(await launchFee({ ...env, LAUNCH_FEE_SOL: '0' }), null);
  await setSetting(env.DB, 'buyback.paused', true);
  assert.equal(await launchFee(env), null);                                   // en pause : gratuit
});

test('the fee transfer is two real System transfers, and only the right ones are accepted', async () => {
  const payer = Keypair.generate(), burn = Keypair.generate().publicKey.toBase58(), team = Keypair.generate().publicKey.toBase58();
  const transfers = [{ to: burn, lamports: 10_000_000 }, { to: team, lamports: 10_000_000 }];
  const bytes = buildFeeTx({ from: payer.publicKey.toBase58(), transfers, blockhash: BLOCKHASH });
  const ixs = Transaction.from(bytes).instructions.map((ix) => SystemInstruction.decodeTransfer(ix));
  assert.deepEqual(ixs.map((d) => [d.fromPubkey.toBase58(), d.toPubkey.toBase58(), Number(d.lamports)]),
    [[payer.publicKey.toBase58(), burn, 10_000_000], [payer.publicKey.toBase58(), team, 10_000_000]]);

  const want = { from: payer.publicKey.toBase58(), transfers };
  assert.equal(checkFeeTx(bytes, want), 'unsigned');
  const wallet = await buybackWallet({ BUYBACK_SECRET_KEY: base58(payer.secretKey), BURN_WALLET: payer.publicKey.toBase58() });
  const signed = await signTransaction(bytes, wallet);
  assert.equal(checkFeeTx(signed, want), null);
  assert.equal(checkFeeTx(signed, { ...want, transfers: [{ to: burn, lamports: 20_000_000 }] }), 'bad_fee_tx');
  assert.equal(checkFeeTx(signed, { ...want, transfers: [transfers[0], { to: Keypair.generate().publicKey.toBase58(), lamports: 10_000_000 }] }), 'bad_fee_tx');
  // Le créateur ne peut pas garder la part de l'équipe (ni celle du burn).
  const burnOnly = await signTransaction(buildFeeTx({ from: payer.publicKey.toBase58(), transfers: [transfers[0]], blockhash: BLOCKHASH }), wallet);
  assert.equal(checkFeeTx(burnOnly, want), 'bad_fee_tx');
  assert.equal(checkFeeTx(new Uint8Array([1, 2]), want), 'bad_fee_tx');
});

test('the burn wallet key can only be the planned burn wallet, never the dev wallet', async () => {
  const kp = Keypair.generate();
  const secret = base58(kp.secretKey);
  await assert.rejects(buybackWallet({ BUYBACK_SECRET_KEY: secret }), /wrong_burn_wallet/);
  await assert.rejects(buybackWallet({ BUYBACK_SECRET_KEY: secret, BURN_WALLET: '', DEPLOYER_WALLET: kp.publicKey.toBase58() }), /dev_wallet_key/);
  assert.equal((await buybackWallet({ BUYBACK_SECRET_KEY: secret, BURN_WALLET: kp.publicKey.toBase58() })).publicKey, kp.publicKey.toBase58());
  assert.equal(CONFIG.buyback.wallet, '5siQxef4aUDVRpYDjiSsjQrxju7xMXTRhfdD1KgXM69Z');
});

test('a paid launch fee joins the burn queue, once', async () => {
  const env = { DB: await db(), SOLANA_RPC: 'https://rpc.test' };
  await env.DB.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, fee_lamports, fee_sig, fee_state, sent_at)
    VALUES ('M1', 'C', 'N', 'S', 'x', 'i', 0, 1, 10, 20000000, 'Sig', 'sent', 10)`).run();
  globalThis.fetch = async () => rpcOk({ value: [{ confirmationStatus: 'confirmed', err: null }] });
  const row = await env.DB.prepare("SELECT * FROM matches WHERE mint = 'M1'").first();
  assert.equal(await settleFee(env, row, 20), 'paid');
  await settleFee(env, row, 30);                          // une 2e fois (ligne pas à jour) : pas de 2e burn
  const { results } = await env.DB.prepare("SELECT * FROM burns WHERE kind = 'match'").all();
  assert.equal(results.length, 1);
  assert.equal(results[0].sol, 0.0195);
  assert.equal(results[0].status, 'queued');
});

test('DexScreener: the most liquid pair of each coin', () => {
  const m = pickMarkets([
    { baseToken: { address: 'A' }, liquidity: { usd: 10 }, marketCap: 5000, priceChange: { h24: -3 } },
    { baseToken: { address: 'A' }, liquidity: { usd: 900 }, marketCap: 80000, priceChange: { h24: 42 }, volume: { h24: 1234 } },
    { baseToken: { address: 'B' }, fdv: 12000 },
  ]);
  assert.deepEqual({ ...m.get('A'), liq: undefined }, { liq: undefined, mcap: 80000, change: 42, vol: 1234 });
  assert.equal(m.get('B').mcap, 12000);
});

test('Pyromaniacs: ranked by $WICK burned by their launches, with titles', async () => {
  const d = await db();
  const rows = [['a1', 'Alice', 1], ['a2', 'Alice', 2], ['a3', 'Alice', 3], ['b1', 'Bob', 4]];
  for (const [mint, creator, seq] of rows) {
    await d.prepare("INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, mcap) VALUES (?, ?, 'n', ?, 'x', 'i', 0, ?, ?, ?)")
      .bind(mint, creator, mint.toUpperCase(), seq, seq, seq * 1000).run();
  }
  await d.prepare("INSERT INTO burns (kind, ref, created_at, status, burned_ui) VALUES ('match', 'b1', 0, 'burned', 500), ('match', 'a1', 0, 'burned', 100)").run();
  const board = await leaderboard(d, 1e12);
  assert.deepEqual(board.map((r) => [r.creator, r.launches, r.burned, r.title]), [['Bob', 1, 500, 'Spark'], ['Alice', 3, 100, 'Firestarter']]);
  assert.equal(board[1].best.symbol, 'A3');
  assert.equal(titleFor(25), 'Pyromaniac');
});

test('Telegram: one clean post per match with its photo, updated once its fee is burned', async () => {
  const env = { DB: await db(), TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '@wick' };
  await env.DB.prepare(`INSERT INTO matches (mint, creator, name, symbol, image, uri, ip, created_at, seq, lit_at, holder, fee_lamports, fee_state, cycle)
    VALUES ('M1', 'C', 'Frog <Wick>', 'FROG', 'https://ipfs.io/ipfs/x', 'x', 'i', 0, 1, 1000, 1, 20000000, 'paid', 3)`).run();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.telegram.org/')) return Response.json([]);
    const method = String(url).split('/').pop();
    calls.push({ method, body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: 77 } });
  };
  assert.equal(await runTelegram(env, 2000), 1);
  assert.equal(calls[0].method, 'sendPhoto');
  assert.equal(calls[0].body.photo, 'https://ipfs.io/ipfs/x');
  assert.match(calls[0].body.caption, /NEW MATCH STRUCK<\/b> · #1/);
  assert.match(calls[0].body.caption, /<b>Frog &lt;Wick&gt;<\/b> · <b>\$FROG<\/b>/);
  assert.match(calls[0].body.caption, /<code>M1<\/code>/);
  assert.match(calls[0].body.caption, /👑 \$WICK holder/);
  assert.match(calls[0].body.caption, /Ignition Fee: 0.02 SOL → <i>buying \$WICK to burn…<\/i>/);
  assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].url, 'https://pump.fun/coin/M1');
  assert.equal(await runTelegram(env, 3000), 0);                         // jamais deux fois

  await env.DB.prepare("INSERT INTO burns (kind, ref, created_at, status, burned_ui, burned_at, burn_sig) VALUES ('match', 'M1', 0, 'burned', 12345, 4000, 'BurnSig')").run();
  assert.equal(await runTelegram(env, 5000), 1);
  assert.equal(calls[1].method, 'editMessageCaption');
  assert.equal(calls[1].body.message_id, 77);
  assert.match(calls[1].body.caption, /<b>12.3K \$WICK burned<\/b> ✅ <a href="https:\/\/solscan.io\/tx\/BurnSig">TX<\/a>/);
  assert.equal(await runTelegram(env, 6000), 0);

  // Une bougie consumée.
  await env.DB.prepare("INSERT INTO hall (number, started_at, completed_at, launches, burned, pct, top_symbol) VALUES (1, 0, 5500, 12, 5000000, 0.5, 'FROG')").run();
  assert.equal(await runTelegram(env, 7000), 1);
  assert.match(calls[2].body.text, /CANDLE #001 — FULLY MELTED/);
  assert.match(calls[2].body.text, /0.50% of the \$WICK supply<\/b> just went up in smoke/);
  assert.match(calls[2].body.text, /Hottest coin: <b>\$FROG<\/b>/);

  // Un buyback, façon bot de burn.
  await env.DB.prepare("INSERT INTO burns (kind, ref, created_at, status, burned_ui, burned_at, sol, buy_sig, burn_sig) VALUES ('candle', '42', 0, 'burned', 3120431, 7500, 0.84, 'B1', 'B2')").run();
  assert.equal(await runTelegram(env, 8000), 1);
  assert.match(calls[3].body.text, /^(🔥){17}\n<b>\$WICK BUYBACK &amp; BURN<\/b> · #42/u);
  assert.match(calls[3].body.text, /Burned: <b>3,120,431 \$WICK<\/b>/);
  assert.match(calls[3].body.text, /Buy TX<\/a> · <a href="https:\/\/solscan.io\/tx\/B2">Burn TX/);
});

test('Telegram: the daily report, once a day', async () => {
  const env = { DB: await db(), TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '@wick' };
  const day = Date.UTC(2026, 9, 3, 18, 30);
  await env.DB.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at, mcap, tg_state)
    VALUES ('A', 'Alice1111', 'A', 'AAA', 'x', 'i', 0, 1, ?, 245000, 'photo'), ('B', 'Alice1111', 'B', 'BBB', 'x', 'i', 0, 2, ?, 98000, 'photo')`).bind(day - 3600_000, day - 7200_000).run();
  await env.DB.prepare("INSERT INTO burns (kind, ref, created_at, status, burned_ui, burned_at, sol, tg_done) VALUES ('candle', '1', 0, 'burned', 4200000, ?, 1.5, 1)").bind(day - 60_000).run();
  const texts = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.telegram.org/')) return Response.json([]);
    texts.push(JSON.parse(init.body).text);
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  assert.equal(await runTelegram(env, Date.UTC(2026, 9, 3, 17, 0)), 0);       // avant 18 h UTC : rien
  assert.equal(await runTelegram(env, day), 1);
  assert.match(texts[0], /WICK DAILY REPORT<\/b> · Oct 3/);
  assert.match(texts[0], /Coins launched: <b>2<\/b>/);
  assert.match(texts[0], /\$WICK burned: <b>4.2M<\/b>/);
  assert.match(texts[0], /🥇 \$AAA · \$245K mcap\n🥈 \$BBB · \$98K mcap/);
  assert.match(texts[0], /Pyromaniac of the day/);
  assert.equal(await runTelegram(env, day + 3600_000), 0);                       // une seule fois par jour
});

test('Telegram: without an image, a text post; without a token, nothing', async () => {
  const caption = matchCaption({ symbol: 'X', name: 'Y', mint: 'M', fee_lamports: 0, dev_buy: 0.5, twitter: 'https://x.com/y' });
  assert.match(caption, /Dev buy: 0.5 SOL/);
  assert.doesNotMatch(caption, /Ignition/);
  assert.match(caption, /<a href="https:\/\/x.com\/y">𝕏 Twitter<\/a>/);
  assert.equal(await runTelegram({ DB: await db() }, 0), 0);
});
