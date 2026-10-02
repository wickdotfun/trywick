import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { buybackWallet, parseSecretKey, runBuyback } from '../lib/buyback.js';
import { tickCycle } from '../lib/cycles.js';
import { ensureSchema } from '../lib/schema.js';
import { base58, buildBurnTx, signTransaction } from '../lib/solana.js';
import { fakeD1 } from './helpers/d1.js';

const MIN = 60_000;
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('reads Phantom (base58) and CLI ([…]) secret keys', () => {
  const kp = Keypair.generate();
  const a = parseSecretKey(base58(kp.secretKey));
  const b = parseSecretKey(JSON.stringify([...kp.secretKey]));
  assert.deepEqual([...a.publicKey], [...kp.publicKey.toBytes()]);
  assert.deepEqual([...b.seed], [...a.seed]);
  assert.throws(() => parseSecretKey('abc'));
});

test('the wallet signs exactly like Solana does', async () => {
  const kp = Keypair.generate();
  const wallet = await buybackWallet({ BUYBACK_SECRET_KEY: base58(kp.secretKey) });
  assert.equal(wallet.publicKey, kp.publicKey.toBase58());

  const other = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: other.publicKey, lamports: 1 })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const mine = await signTransaction(tx.serialize(), wallet);
  tx.sign([kp]);
  assert.deepEqual([...mine], [...tx.serialize()]);

  // Une clé publique qui ne va pas avec la graine est refusée.
  const bad = new Uint8Array(kp.secretKey);
  bad.set(other.publicKey.toBytes(), 32);
  await assert.rejects(buybackWallet({ BUYBACK_SECRET_KEY: base58(bad) }), /bad_secret_key/);
});

test('the burn transaction is a valid SPL Burn, signed by the owner', async () => {
  const owner = Keypair.generate();
  const account = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const bytes = buildBurnTx({
    owner: owner.publicKey.toBase58(), tokenAccount: account, mint, tokenProgram: TOKEN_PROGRAM,
    amount: 123456789012345n, blockhash: BLOCKHASH,
  });
  const wallet = await buybackWallet({ BUYBACK_SECRET_KEY: base58(owner.secretKey) });
  const signed = await signTransaction(bytes, wallet);
  const tx = Transaction.from(signed);
  assert.equal(tx.feePayer.toBase58(), owner.publicKey.toBase58());
  assert.equal(tx.recentBlockhash, BLOCKHASH);
  assert.ok(tx.verifySignatures());
  assert.equal(tx.instructions.length, 1);
  const ix = tx.instructions[0];
  assert.equal(ix.programId.toBase58(), TOKEN_PROGRAM);
  assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [account, false, true], [mint, false, true], [owner.publicKey.toBase58(), true, true],
  ]);
  assert.equal(ix.data[0], 8);
  assert.equal(ix.data.readBigUInt64LE(1), 123456789012345n);
});

// Un faux Solana + PumpPortal : un wallet qui achète 1 000 000 de jetons à chaque achat.
function fakeChain(wallet, { lamports, held = 5_000_000n, failBuy = false }) {
  const calls = [];
  let tokens = held;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body;
    if (String(url).includes('pumpportal')) {
      const req = JSON.parse(body);
      calls.push(`portal:${req.action}`);
      const msg = new TransactionMessage({
        payerKey: new PublicKey(wallet.publicKey), recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(wallet.publicKey), toPubkey: new PublicKey(wallet.publicKey), lamports: sent.length + 1 })],
      }).compileToV0Message();
      return new Response(new VersionedTransaction(msg).serialize());
    }
    const { method, params } = JSON.parse(body);
    calls.push(method);
    const ok = (result) => Response.json({ jsonrpc: '2.0', id: 1, result });
    switch (method) {
      case 'getBalance': return ok({ value: lamports });
      case 'getTokenAccountsByOwner': return ok({ value: [{ pubkey: 'Acc1111111111111111111111111111111111111111', account: { owner: TOKEN_PROGRAM, data: { parsed: { info: { tokenAmount: { amount: String(tokens), decimals: 6 } } } } } }] });
      case 'sendTransaction': {
        const raw = Buffer.from(params[0], 'base64');
        const tx = VersionedTransaction.deserialize(raw);
        const sig = base58(tx.signatures[0]);
        const key = await crypto.subtle.importKey('raw', new PublicKey(wallet.publicKey).toBytes(), { name: 'Ed25519' }, false, ['verify']);
        assert.ok(await crypto.subtle.verify('Ed25519', key, tx.signatures[0], tx.message.serialize()));
        sent.push(sig);
        if (sent.length === 2 && !failBuy) tokens += 1_000_000n; // 1er envoi = collecte, 2e = achat
        return ok(sig);
      }
      case 'getSignatureStatuses': {
        const fail = failBuy && params[0][0] === sent[1];
        return ok({ value: [{ confirmationStatus: 'confirmed', err: fail ? { InstructionError: [0, 'x'] } : null }] });
      }
      case 'getLatestBlockhash': return ok({ value: { blockhash: BLOCKHASH } });
      default: throw new Error(`unexpected rpc ${method}`);
    }
  };
  return { calls, sent, tokens: () => tokens };
}

async function world(lamports, opts = {}) {
  const kp = Keypair.generate();
  const env = {
    DB: fakeD1(), TOKEN_MINT: Keypair.generate().publicKey.toBase58(),
    BUYBACK_SECRET_KEY: base58(kp.secretKey), SOLANA_RPC: 'https://rpc.test',
  };
  await ensureSchema(env.DB);
  await tickCycle(env, 0);
  await tickCycle(env, 30 * MIN);          // la bougie n° 1 s'éteint
  const wallet = await buybackWallet(env);
  return { env, chain: fakeChain(wallet, { lamports, ...opts }) };
}

test('a burned-out candle: fees collected, $WICK bought, only the bought tokens burned', async () => {
  const { env, chain } = await world(1.5e9);
  const step = await runBuyback(env, 30 * MIN);
  assert.equal(step, 'burned');
  const row = await env.DB.prepare('SELECT * FROM cycles WHERE id = 1').first();
  assert.equal(row.status, 'burned');
  assert.equal(row.buy_sol, 1.48);                // 1,5 SOL moins la réserve de 0,02
  assert.equal(row.pre_raw, '5000000');
  assert.equal(row.bought_raw, '1000000');        // le dev bag (5 M) n'est pas touché
  assert.equal(row.burned_ui, 1);
  assert.ok(row.buy_sig && row.burn_sig);
  assert.deepEqual(chain.calls.filter((c) => c.startsWith('portal')), ['portal:collectCreatorFee', 'portal:buy']);
  assert.equal(await runBuyback(env, 31 * MIN), null);   // rien d'autre à faire
});

test('an empty pot skips the buyback', async () => {
  const { env } = await world(0.021e9);
  assert.equal(await runBuyback(env, 30 * MIN), 'skipped:empty_pot');
});

test('a failed buy is recorded and nothing is burned', async () => {
  const { env, chain } = await world(1e9, { failBuy: true });
  assert.equal(await runBuyback(env, 30 * MIN), 'failed:buy');
  const row = await env.DB.prepare('SELECT * FROM cycles WHERE id = 1').first();
  assert.equal(row.status, 'failed');
  assert.equal(row.burn_sig, null);
  assert.equal(chain.sent.length, 2);
});

test('without a token or a key, candles still burn but no buyback runs', async () => {
  const env = { DB: fakeD1() };
  await ensureSchema(env.DB);
  await tickCycle(env, 0);
  await tickCycle(env, 30 * MIN);
  assert.equal(await runBuyback(env, 30 * MIN), 'skipped:not_live');
  assert.equal((await env.DB.prepare('SELECT note FROM cycles WHERE id = 1').first()).note, 'not_live');
});

test('two overlapping crons never buy twice', async () => {
  const { env, chain } = await world(1e9);
  await Promise.all([runBuyback(env, 30 * MIN), runBuyback(env, 30 * MIN)]);
  assert.equal(chain.calls.filter((c) => c === 'portal:buy').length, 1);
});
