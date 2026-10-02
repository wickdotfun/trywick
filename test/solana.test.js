import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { CONFIG } from '../lib/config.js';
import { base58, checkSignedLaunch, judgeConfirmed, readTransaction, signatureOf } from '../lib/solana.js';

const PUMP = new PublicKey(CONFIG.pumpProgram);
const BLOCKHASH = '11111111111111111111111111111111';

function launchTx(creator, mint, { program = PUMP, payer = creator } = {}) {
  const ix = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: mint.publicKey, isSigner: true, isWritable: true },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
    ],
    data: Buffer.from([1, 2, 3]),
  });
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: BLOCKHASH, instructions: [ix] })
    .compileToV0Message();
  return new VersionedTransaction(msg);
}

test('base58 matches web3.js', () => {
  for (let i = 0; i < 20; i++) {
    const k = Keypair.generate().publicKey;
    assert.equal(base58(k.toBytes()), k.toBase58());
  }
  assert.equal(base58(new Uint8Array(32)), '11111111111111111111111111111111');
});

test('reads the accounts and signatures of a v0 transaction', () => {
  const creator = Keypair.generate(), mint = Keypair.generate();
  const tx = launchTx(creator, mint);
  const read = readTransaction(tx.serialize());
  assert.equal(read.version, 0);
  assert.equal(read.header.required, 2);
  assert.equal(read.keys[0], creator.publicKey.toBase58());
  assert.ok(read.keys.includes(mint.publicKey.toBase58()));
  assert.ok(read.keys.includes(CONFIG.pumpProgram));
});

test('only a fully signed launch of the right coin by the right creator is relayed', () => {
  const creator = Keypair.generate(), mint = Keypair.generate();
  const row = { creator: creator.publicKey.toBase58(), mint: mint.publicKey.toBase58() };

  const tx = launchTx(creator, mint);
  assert.equal(checkSignedLaunch(tx.serialize(), row), 'unsigned');
  tx.sign([creator]);
  assert.equal(checkSignedLaunch(tx.serialize(), row), 'unsigned');
  tx.sign([mint]);
  assert.equal(checkSignedLaunch(tx.serialize(), row), null);
  assert.equal(signatureOf(tx.serialize()), base58(tx.signatures[0]));

  const other = Keypair.generate();
  assert.equal(checkSignedLaunch(tx.serialize(), { ...row, creator: other.publicKey.toBase58() }), 'wrong_payer');
  assert.equal(checkSignedLaunch(tx.serialize(), { ...row, mint: other.publicKey.toBase58() }), 'wrong_mint');

  const notPump = launchTx(creator, mint, { program: SystemProgram.programId });
  notPump.sign([creator, mint]);
  assert.equal(checkSignedLaunch(notPump.serialize(), row), 'not_pump');

  assert.equal(checkSignedLaunch(new Uint8Array([5, 1, 2]), row), 'bad_tx');
});

test('judges a confirmed transaction', () => {
  const creator = 'C'.repeat(44), mint = 'M'.repeat(44);
  const ok = {
    meta: { err: null, postTokenBalances: [{ mint }] },
    transaction: {
      message: {
        header: { numRequiredSignatures: 2 },
        accountKeys: [creator, mint, 'x', CONFIG.pumpProgram],
        instructions: [{ programIdIndex: 3 }],
      },
    },
  };
  assert.equal(judgeConfirmed(ok, { creator, mint }), 'ok');
  assert.equal(judgeConfirmed(null, { creator, mint }), 'unknown');
  assert.equal(judgeConfirmed({ ...ok, meta: { err: { InstructionError: [0, {}] } } }, { creator, mint }), 'failed');
  assert.equal(judgeConfirmed(ok, { creator: mint, mint }), 'mismatch');
  assert.equal(judgeConfirmed({ ...ok, meta: { err: null, postTokenBalances: [] } }, { creator, mint }), 'mismatch');
  const noPump = structuredClone(ok);
  noPump.transaction.message.instructions = [{ programIdIndex: 2 }];
  assert.equal(judgeConfirmed(noPump, { creator, mint }), 'mismatch');
});

test('base58 decoding matches web3.js', async () => {
  const { fromBase58 } = await import('../lib/solana.js');
  for (let i = 0; i < 20; i++) {
    const k = Keypair.generate().publicKey;
    assert.deepEqual([...fromBase58(k.toBase58())], [...k.toBytes()]);
  }
  assert.deepEqual([...fromBase58('11111111111111111111111111111111')], new Array(32).fill(0));
  assert.throws(() => fromBase58('0OIl'));
});
