import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { prepare, status, submit } from '../src/api/launch.js';
import { launchFee } from '../lib/buyback.js';
import { CONFIG } from '../lib/config.js';
import { ensureSchema } from '../lib/schema.js';
import {
  PUMP_FEES, buildShareTx, checkSignedShareTx, createConfigIx, distributeIx, readSharingConfig, runShares,
  sharingAccounts, shareholdersFor, shareTotals, sweepAmmIx, updateSharesIx,
} from '../lib/sharing.js';
import { base58, buildLegacyTx, findPda, fromBase58, isOnCurve, readTransaction } from '../lib/solana.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const SDK = JSON.parse(readFileSync(new URL('./fixtures/pump-sdk-sharing.json', import.meta.url)));
const norm = (ix) => ({
  program: ix.programId,
  keys: ix.keys.map((k) => [k.pubkey, Boolean(k.isSigner), Boolean(k.isWritable)]),
  data: Buffer.from(ix.data).toString('hex'),
});

test('the fee sharing instructions are exactly those of the official pump.fun SDK', async () => {
  // test/fixtures/pump-sdk-sharing.json : produit par @pump-fun/pump-sdk 2.0.0 pour ces mêmes comptes.
  const a = await sharingAccounts(SDK.mint);
  const holders = shareholdersFor(SDK.creator, SDK.wick, 1000);
  assert.deepEqual(norm(createConfigIx(a, SDK.creator)), SDK.createFeeSharingConfig);
  assert.deepEqual(norm(updateSharesIx(a, SDK.creator, holders)), SDK.updateFeeSharesV2);
  assert.deepEqual(norm(distributeIx(a, SDK.payer, holders.map((h) => h.address))), SDK.distributeCreatorFeesV2);
  assert.deepEqual(norm(sweepAmmIx(a, SDK.payer)), SDK.transferCreatorFeesToPumpV2);
});

test('program addresses (PDA) and the curve check match web3.js', async () => {
  for (let i = 0; i < 25; i++) {
    const mint = Keypair.generate().publicKey;
    const [want] = PublicKey.findProgramAddressSync([Buffer.from('sharing-config'), mint.toBuffer()], new PublicKey(PUMP_FEES));
    assert.equal(await findPda(['sharing-config', fromBase58(mint.toBase58())], PUMP_FEES), want.toBase58());
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    assert.equal(isOnCurve(bytes), PublicKey.isOnCurve(bytes));
    assert.equal(isOnCurve(mint.toBytes()), true);
  }
});

test('a hand-built legacy transaction reads back the same in web3.js', () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const prog = Keypair.generate().publicKey.toBase58();
  const instructions = [
    { programId: prog, keys: [{ pubkey: other, isSigner: false, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: true }], data: Uint8Array.of(1, 2) },
    { programId: SystemProgram.programId.toBase58(), keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: other, isSigner: false, isWritable: true }], data: Uint8Array.of(9) },
  ];
  const tx = Transaction.from(Buffer.from(buildLegacyTx({ payer, instructions, blockhash: BLOCKHASH })));
  assert.equal(tx.feePayer.toBase58(), payer);
  assert.equal(tx.recentBlockhash, BLOCKHASH);
  assert.deepEqual(tx.instructions.map((ix) => ({
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Uint8Array.from(ix.data),
  })), instructions.map((ix) => ({ ...ix, data: Uint8Array.from(ix.data) })));
});

test('the launch-with-sharing transaction: Ignition Fee, then the locked 90/10 split', async () => {
  const creator = Keypair.generate(), mint = Keypair.generate().publicKey.toBase58(), wick = Keypair.generate().publicKey.toBase58();
  const bytes = await buildShareTx({ creator: creator.publicKey.toBase58(), mint, wick, wickBps: 1000, feeLamports: 10_000_000, blockhash: BLOCKHASH });
  assert.ok(bytes.length <= 1232, `too big: ${bytes.length}`);
  const tx = Transaction.from(Buffer.from(bytes));
  const [, , transfer, create, update] = tx.instructions;
  assert.equal(tx.instructions.length, 5);
  assert.equal(transfer.programId.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(transfer.keys[1].pubkey.toBase58(), wick);
  assert.equal(Buffer.from(transfer.data).readBigUInt64LE(4), 10_000_000n);
  assert.equal(create.programId.toBase58(), PUMP_FEES);
  // update_fee_shares_v2 : 2 bénéficiaires, le créateur 9000, WICK 1000.
  const d = Buffer.from(update.data);
  assert.equal(d.readUInt32LE(8), 2);
  assert.equal(base58(d.subarray(12, 44)), creator.publicKey.toBase58());
  assert.equal(d.readUInt16LE(44), 9000);
  assert.equal(base58(d.subarray(46, 78)), wick);
  assert.equal(d.readUInt16LE(78), 1000);

  // Signée par le créateur : acceptée. Modifiée ou pas signée : refusée.
  const message = bytes.subarray(1 + 64);
  const unsigned = Uint8Array.from(bytes);
  assert.equal(checkSignedShareTx(unsigned, message), 'unsigned');
  const signed = VersionedTransaction.deserialize(bytes);
  signed.sign([creator]);
  assert.equal(checkSignedShareTx(signed.serialize(), message), null);
  const other = await buildShareTx({ creator: creator.publicKey.toBase58(), mint, wick: Keypair.generate().publicKey.toBase58(), wickBps: 1000, feeLamports: 10_000_000, blockhash: BLOCKHASH });
  const otherSigned = VersionedTransaction.deserialize(other);
  otherSigned.sign([creator]);
  assert.equal(checkSignedShareTx(otherSigned.serialize(), message), 'bad_share_tx');
});

function sharingConfigBytes({ mint, admin, shareholders, locked = true, status = 1 }) {
  const out = Buffer.alloc(8 + 3 + 64 + 1 + 4 + shareholders.length * 34);
  Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]).copy(out, 0);
  out[8] = 255; out[9] = 2; out[10] = status;
  Buffer.from(fromBase58(mint)).copy(out, 11);
  Buffer.from(fromBase58(admin)).copy(out, 43);
  out[75] = locked ? 1 : 0;
  out.writeUInt32LE(shareholders.length, 76);
  shareholders.forEach((h, i) => { Buffer.from(fromBase58(h.address)).copy(out, 80 + i * 34); out.writeUInt16LE(h.bps, 112 + i * 34); });
  return out;
}

test('reads a sharing config account', () => {
  const mint = Keypair.generate().publicKey.toBase58(), a = Keypair.generate().publicKey.toBase58(), b = Keypair.generate().publicKey.toBase58();
  const cfg = readSharingConfig(sharingConfigBytes({ mint, admin: a, shareholders: [{ address: a, bps: 9000 }, { address: b, bps: 1000 }] }));
  assert.deepEqual(cfg, { status: 'active', mint, admin: a, locked: true, shareholders: [{ address: a, bps: 9000 }, { address: b, bps: 1000 }] });
  assert.equal(readSharingConfig(Buffer.alloc(120)), null);
});

test('the reduced Ignition Fee only exists with sharing', async () => {
  const wallet = Keypair.generate();
  const db = fakeD1();
  await ensureSchema(db);
  const env = { DB: db, TOKEN_MINT: Keypair.generate().publicKey.toBase58(), BUYBACK_SECRET_KEY: base58(wallet.secretKey) };
  assert.deepEqual(await launchFee(env, { shared: true }), { lamports: 10_000_000, to: wallet.publicKey.toBase58(), bps: 1000 });
  assert.deepEqual(await launchFee(env), { lamports: 20_000_000, to: wallet.publicKey.toBase58() });
  assert.equal(await launchFee({ ...env, SHARE_BPS: '0' }, { shared: true }), null);
  assert.equal((await launchFee({ ...env, SHARE_BPS: '2000', LAUNCH_FEE_SHARED_SOL: '0' }, { shared: true })).bps, 2000);
});

// Le parcours complet, avec une fausse chaîne : préparer, signer, soumettre, confirmer, partager,
// puis distribuer les fees et noter la part de WICK.
test('launch with sharing: held until the coin exists, then shared, then distributed', async () => {
  const wallet = Keypair.generate();
  const creator = Keypair.generate(), mintKp = Keypair.generate();
  const mint = mintKp.publicKey.toBase58();
  const db = fakeD1();
  await ensureSchema(db);
  const env = {
    DB: db, TOKEN_MINT: Keypair.generate().publicKey.toBase58(), BUYBACK_SECRET_KEY: base58(wallet.secretKey),
    SOLANA_RPC: 'https://rpc.test', IP_SALT: 'x',
  };
  const a = await sharingAccounts(mint);
  const sent = [];
  const confirmed = new Set();
  let vault = 890_880 + 400_000_000;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url === CONFIG.ipfsUrl) return Response.json({ metadataUri: 'https://ipfs/meta', metadata: { image: 'https://ipfs/img' } });
    if (url === CONFIG.pumpPortalUrl) {
      const ix = new TransactionInstruction({
        programId: new PublicKey(CONFIG.pumpProgram),
        keys: [{ pubkey: mintKp.publicKey, isSigner: true, isWritable: true }, { pubkey: creator.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([1]),
      });
      const msg = new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: BLOCKHASH, instructions: [ix] }).compileToV0Message();
      return new Response(new VersionedTransaction(msg).serialize());
    }
    const { method, params } = JSON.parse(init.body);
    const ok = (result) => Response.json({ jsonrpc: '2.0', id: 1, result });
    switch (method) {
      case 'getLatestBlockhash': return ok({ value: { blockhash: BLOCKHASH } });
      case 'sendTransaction': {
        const bytes = Buffer.from(params[0], 'base64');
        const sig = base58(readTransaction(bytes).signatures[0]);
        sent.push({ sig, bytes });
        confirmed.add(sig);
        return ok(sig);
      }
      case 'getSignatureStatuses': return ok({ value: [confirmed.has(params[0][0]) ? { err: null, confirmationStatus: 'confirmed' } : null] });
      case 'getTransaction': {
        const s = sent.find((x) => x.sig === params[0]);
        const tx = readTransaction(s.bytes);
        if (tx.keys[0] === wallet.publicKey.toBase58()) {
          // La distribution : WICK paie 5000 lamports de frais et reçoit 10 %.
          return ok({ transaction: { message: { accountKeys: tx.keys } }, meta: { err: null, fee: 5000, preBalances: [1e9], postBalances: [1e9 - 5000 + 40_000_000] } });
        }
        return ok({
          transaction: { message: { accountKeys: tx.keys, header: { numRequiredSignatures: tx.header.required }, instructions: tx.instructions.map((ix) => ({ programIdIndex: ix.program })) } },
          meta: { err: null, postTokenBalances: [{ mint }] },
        });
      }
      case 'getTokenAccountsByOwner': return ok({ value: [] });
      case 'getAccountInfo': {
        if (params[0] === a.sharingConfig) {
          const cfg = sharingConfigBytes({ mint, admin: creator.publicKey.toBase58(), shareholders: shareholdersFor(creator.publicKey.toBase58(), wallet.publicKey.toBase58(), 1000) });
          return ok({ value: { data: [cfg.toString('base64'), 'base64'], owner: PUMP_FEES } });
        }
        if (params[0] === a.bondingCurve) return ok({ value: { data: [Buffer.alloc(150).toString('base64'), 'base64'], owner: CONFIG.pumpProgram } });
        return ok({ value: null });
      }
      case 'getBalance': return ok({ value: params[0] === a.pumpCreatorVault ? vault : 1e9 });
      default: throw new Error(`unexpected ${method}`);
    }
  };

  // 1. Préparer, avec partage.
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Wick Cat', symbol: 'WCAT', creator: creator.publicKey.toBase58(), mint, share: '1', devBuy: '0' })) form.append(k, v);
  form.append('image', new Blob([new Uint8Array(100)], { type: 'image/png' }), 'i.png');
  const prep = await (await prepare({ request: new Request('http://x/api/launch/prepare', { method: 'POST', body: form }), env })).json();
  assert.equal(prep.feeSol, 0.01);
  assert.equal(prep.shareBps, 1000);

  // 2. Le navigateur signe les deux (le wallet, puis le mint pour la création).
  const tx = VersionedTransaction.deserialize(Buffer.from(prep.tx, 'base64'));
  tx.sign([creator, mintKp]);
  const feeTx = VersionedTransaction.deserialize(Buffer.from(prep.feeTx, 'base64'));
  feeTx.sign([creator]);

  // 3. Soumettre : la création part, la transaction fee + partage est gardée.
  const body = JSON.stringify({ mint, tx: Buffer.from(tx.serialize()).toString('base64'), feeTx: Buffer.from(feeTx.serialize()).toString('base64') });
  const res = await (await submit({ request: new Request('http://x', { method: 'POST', body }), env })).json();
  assert.equal(res.status, 'pending');
  assert.equal(sent.length, 1);
  let row = await db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
  assert.equal(row.fee_state, 'held');

  // Une transaction de partage modifiée est refusée.
  const bad = JSON.stringify({ mint, tx: Buffer.from(tx.serialize()).toString('base64'), feeTx: Buffer.from(tx.serialize()).toString('base64') });
  assert.equal((await (await submit({ request: new Request('http://x', { method: 'POST', body: bad }), env })).json()).error, 'bad_share_tx');

  // 4. Le lancement est confirmé : l'allumette s'allume, la transaction fee + partage part.
  const st = await (await status({ request: new Request(`http://x/api/launch/status?mint=${mint}`), env })).json();
  assert.equal(st.status, 'lit');
  assert.equal(sent.length, 2);
  row = await db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
  assert.equal(row.fee_state, 'paid');
  assert.equal(row.share_state, 'shared');
  const burn = await db.prepare("SELECT * FROM burns WHERE kind = 'match'").first();
  assert.ok(Math.abs(burn.sol - 0.0095) < 1e-9);       // 0,01 SOL moins ce qui paie ses frais réseau
  assert.deepEqual(st.match.share, { bps: 1000, live: true });

  // 5. Le cron distribue les fees accumulées (0,4 SOL), puis note la part reçue par WICK.
  assert.equal(await runShares(env, Date.now() + 7 * 3600_000), 1);
  const dist = readTransaction(sent[2].bytes);
  assert.equal(dist.keys[0], wallet.publicKey.toBase58());
  assert.ok(dist.keys.includes(creator.publicKey.toBase58()));
  assert.equal(await runShares(env, Date.now() + 7 * 3600_000 + 60_000), 0);   // déjà distribué : on attend 6 h
  assert.deepEqual(await shareTotals(db), { sharedSol: 0.04, sharingCoins: 1 });

  // Trop peu accumulé : pas de distribution.
  vault = 890_880 + 1000;
  assert.equal(await runShares(env, Date.now() + 14 * 3600_000), 0);
});
