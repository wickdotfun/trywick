import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { buybackWallet, runBuyback } from '../lib/buyback.js';
import { candleForest, candleTotals, coinBurnLog, coinPage } from '../lib/candles.js';
import { burnTotals } from '../lib/cycles.js';
import { publicMatch } from '../lib/matches.js';
import { ensureSchema } from '../lib/schema.js';
import { setAsideSelf, shareTotals } from '../lib/sharing.js';
import { base58 } from '../lib/solana.js';
import { fakeChain } from './helpers/chain.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Un coin lancé sur WICK avec « Make it burn » à 20 % : le wallet burn reçoit 25 % des fees
// (20 % pour le coin lui-même + 5 % pour $WICK), l'équipe 5 %.
async function world() {
  const kp = Keypair.generate();
  const env = {
    DB: fakeD1(), TOKEN_MINT: Keypair.generate().publicKey.toBase58(),
    BUYBACK_SECRET_KEY: base58(kp.secretKey), BURN_WALLET: kp.publicKey.toBase58(), SOLANA_RPC: 'https://rpc.test',
  };
  await ensureSchema(env.DB);
  const mint = Keypair.generate().publicKey.toBase58();
  await env.DB.prepare(`INSERT INTO matches (mint, creator, name, symbol, uri, ip, created_at, seq, lit_at,
      share_bps, share_team_bps, self_bps, share_state) VALUES (?, 'C', 'Moth', 'MOTH', 'u', 'i', 0, 1, 1, 3000, 500, 2000, 'shared')`)
    .bind(mint).run();
  return { env, mint, wallet: await buybackWallet(env) };
}

async function distribution(db, mint, id, wickLamports) {
  await db.prepare("INSERT INTO shares (id, mint, at, sig, total_lamports, status, wick_lamports) VALUES (?, ?, 0, ?, 0, 'ok', ?)")
    .bind(id, mint, `sig${id}`, wickLamports).run();
  return db.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first();
}

test('make it burn: the coin\'s share of each distribution is set aside, then queued once it is enough', async () => {
  const { env, mint } = await world();
  const db = env.DB;
  // 1re distribution : le wallet burn reçoit 0,005 SOL, dont 4/5 pour le coin (0,004) : pas assez.
  assert.equal(await setAsideSelf(db, await distribution(db, mint, 1, 5_000_000), 5_000_000, 10), 0);
  let m = await db.prepare('SELECT self_pending FROM matches WHERE mint = ?').bind(mint).first();
  assert.equal(m.self_pending, 4_000_000);
  // 2e : 0,01 SOL reçus, 0,008 pour le coin : 0,012 au total, en file (moins de quoi payer le réseau).
  assert.equal(await setAsideSelf(db, await distribution(db, mint, 2, 10_000_000), 10_000_000, 20), 0.0115);
  m = await db.prepare('SELECT self_pending FROM matches WHERE mint = ?').bind(mint).first();
  assert.equal(m.self_pending, 0);
  const { results } = await db.prepare("SELECT * FROM burns WHERE kind = 'coin'").all();
  assert.equal(results.length, 1);
  assert.equal(results[0].ref, `${mint}:2`);
  assert.equal(results[0].sol, 0.0115);
  // La part qui brûle $WICK ne compte que le reste : 0,003 SOL sur 0,015.
  const totals = await shareTotals(db);
  assert.equal(totals.selfSharedSol, 0.012);
  assert.equal(totals.sharedSol, 0.003);
});

test('a coin that does not burn itself sets nothing aside', async () => {
  const { env, mint } = await world();
  await env.DB.prepare('UPDATE matches SET self_bps = 0, share_bps = 1000 WHERE mint = ?').bind(mint).run();
  assert.equal(await setAsideSelf(env.DB, await distribution(env.DB, mint, 1, 50_000_000), 50_000_000, 10), 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM burns WHERE kind = 'coin'").first()).n, 0);
});

test('a coin burn buys the coin itself, burns it, and melts its own candle, not $WICK\'s', async () => {
  const { env, mint, wallet } = await world();
  const db = env.DB;
  await db.prepare("INSERT INTO burns (kind, ref, created_at, sol) VALUES ('coin', ?, 0, 0.05)").bind(`${mint}:7`).run();
  const chain = fakeChain(wallet, { lamports: 1e9, held: 0n });
  assert.equal(await runBuyback(env, 1000), 'burned');
  assert.equal(chain.buys.length, 1);
  assert.equal(chain.buys[0].mint, mint);            // le coin lui-même, pas $WICK
  assert.equal(chain.buys[0].amount, 0.05);
  const row = await db.prepare("SELECT * FROM burns WHERE kind = 'coin'").first();
  assert.equal(row.status, 'burned');
  assert.equal(row.burned_ui, 1);
  // Sa bougie fond…
  const m = await db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
  assert.deepEqual([m.self_burned, m.self_sol, m.self_burns], [1, 0.05, 1]);
  const candle = publicMatch(m).candle;
  assert.deepEqual({ ...candle, pct: Number(candle.pct.toPrecision(3)) }, { bps: 2000, burned: 1, pct: 1e-7, sol: 0.05, burns: 1, live: true, keeper: null });
  // … mais pas celle de $WICK.
  assert.equal((await burnTotals(db)).burned, 0);
  // La forêt, le fil et la page du coin le montrent.
  assert.equal((await candleForest(db))[0].mint, mint);
  assert.equal((await coinBurnLog(db))[0].symbol, 'MOTH');
  const page = await coinPage(db, mint);
  assert.equal(page.burns.length, 1);
  assert.deepEqual(await candleTotals(db), { candles: 1, candleBurns: 1, candleSol: 0.05 });
  // Le journal de son Operator note le burn, avec sa transaction.
  assert.equal(page.operator.log.length, 1);
  assert.equal(page.operator.log[0].kind, 'burned');
  assert.equal(page.operator.log[0].title, 'Burned 1 $MOTH');
  assert.ok(page.operator.log[0].sig);
});

test('a failed coin buy gives its SOL back to the coin, not to the $WICK pot', async () => {
  const { env, mint, wallet } = await world();
  await env.DB.prepare("INSERT INTO burns (kind, ref, created_at, sol) VALUES ('coin', ?, 0, 0.05)").bind(`${mint}:7`).run();
  fakeChain(wallet, { lamports: 1e9, failBuy: true });
  assert.equal(await runBuyback(env, 1000), 'failed:buy');
  const m = await env.DB.prepare('SELECT self_pending FROM matches WHERE mint = ?').bind(mint).first();
  assert.equal(m.self_pending, 50_500_000);
});

test('a launch with Make it burn at 20% locks 40% creator / 30% burn wallet (20% its candle + 10% $WICK) / 30% team wallet (10% team + 20% crew)', async () => {
  const { feeTx, prepare } = await import('../src/api/launch.js');
  const { CONFIG } = await import('../lib/config.js');
  const { Transaction, TransactionMessage, VersionedTransaction, TransactionInstruction, PublicKey } = await import('@solana/web3.js');
  const { env } = await world();
  env.PINATA_JWT = 'jwt';
  env.IP_SALT = 'x';
  const creator = Keypair.generate(), mintKp = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url === CONFIG.pinataUploadUrl) return Response.json({ data: { cid: 'bafy' } });
    if (url === CONFIG.pumpPortalUrl) {
      const ix = new TransactionInstruction({ programId: new PublicKey(CONFIG.pumpProgram), keys: [{ pubkey: mintKp.publicKey, isSigner: true, isWritable: true }], data: Buffer.from([1]) });
      return new Response(new VersionedTransaction(new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message()).serialize());
    }
    const { method } = JSON.parse(init.body);
    if (method === 'getLatestBlockhash') return Response.json({ jsonrpc: '2.0', id: 1, result: { value: { blockhash } } });
    if (method === 'simulateTransaction') return Response.json({ jsonrpc: '2.0', id: 1, result: { value: { err: null, logs: [] } } });
    throw new Error(`unexpected ${method}`);
  };
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Moth', symbol: 'MOTH', creator: creator.publicKey.toBase58(), mint: mintKp.publicKey.toBase58(), burn: '20', devBuy: '0' })) form.append(k, v);
  form.append('image', new File([new Uint8Array(100)], 'm.png', { type: 'image/png' }));
  const prep = await (await prepare({ request: new Request('http://x/api/launch/prepare', { method: 'POST', body: form }), env })).json();
  assert.equal(prep.feeSol, 0.01);
  assert.equal(prep.selfBps, 2000);
  assert.equal(prep.shareBps, 6000);
  const row = await env.DB.prepare('SELECT self_bps, share_bps, share_team_bps, share_crew_bps FROM matches WHERE mint = ?').bind(mintKp.publicKey.toBase58()).first();
  assert.deepEqual({ ...row }, { self_bps: 2000, share_bps: 6000, share_team_bps: 3000, share_crew_bps: 2000 });
  // Dans la transaction de partage : le créateur 40 %, le wallet burn 30 % (20 % la bougie, 10 % $WICK), l'équipe 30 % (10 % + 20 % le crew).
  // Le coin créé, la fee (et le partage) se signe : sa transaction, faite à ce moment-là.
  await env.DB.prepare("UPDATE matches SET seq = 999, lit_at = 1, fee_state = 'awaiting' WHERE mint = ?").bind(mintKp.publicKey.toBase58()).run();
  const fee = await (await feeTx({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ mint: mintKp.publicKey.toBase58() }) }), env })).json();
  const d = Buffer.from(Transaction.from(Buffer.from(fee.feeTx, 'base64')).instructions.at(-1).data);
  assert.deepEqual([0, 1, 2].map((i) => d.readUInt16LE(44 + i * 34)), [4000, 3000, 3000]);
  // Une part qui n'est pas proposée est ignorée (pas de bougie, partage classique).
  const form2 = new FormData();
  const mint2 = Keypair.generate().publicKey.toBase58();
  for (const [k, v] of Object.entries({ name: 'Moth', symbol: 'MOTH', creator: creator.publicKey.toBase58(), mint: mint2, burn: '42', share: '1', devBuy: '0' })) form2.append(k, v);
  form2.append('image', new File([new Uint8Array(100)], 'm.png', { type: 'image/png' }));
  const prep2 = await (await prepare({ request: new Request('http://x/api/launch/prepare', { method: 'POST', body: form2 }), env })).json();
  assert.equal(prep2.selfBps, 0);
  assert.equal(prep2.shareBps, 4000);
});

test('a launch with any model and 0.05 SOL of fuel: the fuel goes to the team wallet in the fee transaction', async () => {
  const { feeTx, prepare } = await import('../src/api/launch.js');
  const { CONFIG } = await import('../lib/config.js');
  const { setSetting } = await import('../lib/settings.js');
  const { Transaction, TransactionMessage, VersionedTransaction, TransactionInstruction, PublicKey, SystemProgram } = await import('@solana/web3.js');
  const { env } = await world();
  Object.assign(env, { PINATA_JWT: 'jwt', IP_SALT: 'x', OPENROUTER_API_KEY: 'sk-or' });
  await setSetting(env.DB, 'or.models', { at: Date.now(), models: [{ id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', lab: 'Anthropic', pin: 2e-6, pout: 1e-5, ctx: 1e6, created: 1 }] });
  const creator = Keypair.generate(), mintKp = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url === CONFIG.pinataUploadUrl) return Response.json({ data: { cid: 'bafy' } });
    if (url === CONFIG.pumpPortalUrl) {
      const ix = new TransactionInstruction({ programId: new PublicKey(CONFIG.pumpProgram), keys: [{ pubkey: mintKp.publicKey, isSigner: true, isWritable: true }], data: Buffer.from([1]) });
      return new Response(new VersionedTransaction(new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message()).serialize());
    }
    const { method } = JSON.parse(init.body);
    if (method === 'getLatestBlockhash') return Response.json({ jsonrpc: '2.0', id: 1, result: { value: { blockhash } } });
    if (method === 'simulateTransaction') return Response.json({ jsonrpc: '2.0', id: 1, result: { value: { err: null, logs: [] } } });
    throw new Error(`unexpected ${method}`);
  };
  const launch = async (extra) => {
    const form = new FormData();
    const mint = extra.mint || mintKp.publicKey.toBase58();
    for (const [k, v] of Object.entries({ name: 'Moth', symbol: 'MOTH', creator: creator.publicKey.toBase58(), mint, share: '1', devBuy: '0', ...extra })) form.append(k, v);
    form.append('image', new File([new Uint8Array(100)], 'm.png', { type: 'image/png' }));
    return prepare({ request: new Request('http://x/api/launch/prepare', { method: 'POST', body: form }), env });
  };
  assert.equal((await launch({ mind_or: 'nobody/nothing', fuel: '0', mint: Keypair.generate().publicKey.toBase58() })).status, 400, 'a model that is not in the catalog');
  assert.equal((await launch({ mind_or: 'anthropic/claude-sonnet-5.5', fuel: '7', mint: Keypair.generate().publicKey.toBase58() })).status, 400, 'a fuel that is not offered');
  const prep = await (await launch({ mind_or: 'anthropic/claude-sonnet-5.5', fuel: '0.05' })).json();
  assert.equal(prep.fuelSol, 0.05);
  const row = await env.DB.prepare('SELECT mind_or, fuel_lamports, team_lamports, team_to FROM matches WHERE mint = ?').bind(mintKp.publicKey.toBase58()).first();
  assert.equal(row.mind_or, 'anthropic/claude-sonnet-5.5');
  assert.equal(row.fuel_lamports, 50_000_000);
  await env.DB.prepare("UPDATE matches SET seq = 998, lit_at = 1, fee_state = 'awaiting' WHERE mint = ?").bind(mintKp.publicKey.toBase58()).run();
  const fee = await (await feeTx({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ mint: mintKp.publicKey.toBase58() }) }), env })).json();
  assert.equal(fee.fuelSol, 0.05);
  const transfers = Transaction.from(Buffer.from(fee.feeTx, 'base64')).instructions
    .filter((ix) => ix.programId.equals(SystemProgram.programId))
    .map((ix) => ({ to: ix.keys[1].pubkey.toBase58(), lamports: Number(Buffer.from(ix.data).readBigUInt64LE(4)) }));
  assert.deepEqual(transfers.find((t) => t.to === row.team_to), { to: row.team_to, lamports: row.team_lamports + 50_000_000 });
});
