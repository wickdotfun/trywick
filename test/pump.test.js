import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { prepare, status, submit } from '../src/api/launch.js';
import { CONFIG } from '../lib/config.js';
import { pinataStatus, uploadMetadata } from '../lib/pump.js';
import { ensureSchema } from '../lib/schema.js';
import { base58, readTransaction } from '../lib/solana.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

const LAUNCH = {
  name: 'Wick Cat', symbol: 'WCAT', description: 'a cat', twitter: 'https://x.com/wcat', telegram: '', website: '',
  mint: Keypair.generate().publicKey.toBase58(),
};
const png = () => new File([new Uint8Array(100)], 'cat.png', { type: 'image/png' });

// Pinata : chaque fichier reçu est gardé, et reçoit un CID.
function fakePinata(pins, { fail = false } = {}) {
  return async (url, init) => {
    assert.equal(String(url), CONFIG.pinataUploadUrl);
    if (fail) return Response.json({ error: { reason: 'INVALID_CREDENTIALS' } }, { status: 401 });
    const form = init.body;
    const file = form.get('file');
    pins.push({ auth: init.headers.authorization, network: form.get('network'), name: form.get('name'), type: file.type, text: await file.text() });
    return Response.json({ data: { id: 'x', cid: `bafy${pins.length}`, name: form.get('name') } });
  };
}

test('coin metadata goes to IPFS through Pinata: the image, then the JSON that points to it', async () => {
  const pins = [];
  globalThis.fetch = fakePinata(pins);
  const meta = await uploadMetadata({ PINATA_JWT: 'jwt-123' }, LAUNCH, png());
  assert.deepEqual(meta, { image: 'https://ipfs.io/ipfs/bafy1', uri: 'https://ipfs.io/ipfs/bafy2' });
  assert.equal(pins.length, 2);
  assert.ok(pins.every((p) => p.auth === 'Bearer jwt-123' && p.network === 'public'));
  assert.equal(pins[0].type, 'image/png');
  assert.match(pins[0].name, /^WCAT-\w{8}\.png$/);
  assert.equal(pins[1].type, 'application/json');
  assert.deepEqual(JSON.parse(pins[1].text), {
    name: 'Wick Cat', symbol: 'WCAT', description: 'a cat', image: 'https://ipfs.io/ipfs/bafy1', showName: true, twitter: 'https://x.com/wcat',
  });
  // Une autre passerelle IPFS, si on le souhaite.
  const other = await uploadMetadata({ PINATA_JWT: 'j', IPFS_GATEWAY: 'https://gw.example/' }, LAUNCH, png());
  assert.match(other.uri, /^https:\/\/gw\.example\/ipfs\/bafy\d+$/);
});

test('without a Pinata key, or when Pinata refuses, the upload fails cleanly', async () => {
  await assert.rejects(uploadMetadata({}, LAUNCH, png()), /ipfs_not_configured/);
  globalThis.fetch = fakePinata([], { fail: true });
  await assert.rejects(uploadMetadata({ PINATA_JWT: 'bad' }, LAUNCH, png()), (err) => err.message === 'ipfs_failed' && /401/.test(err.detail));
});

test('the admin page knows whether the Pinata key works', async () => {
  assert.equal(await pinataStatus({}), 'missing');
  globalThis.fetch = async (url) => (String(url) === CONFIG.pinataAuthUrl ? new Response('{}', { status: 401 }) : null);
  assert.equal(await pinataStatus({ PINATA_JWT: 'bad' }, 1), 'invalid');
  globalThis.fetch = async () => Response.json({ message: 'Congratulations!' });
  assert.equal(await pinataStatus({ PINATA_JWT: 'bad' }, 2), 'invalid');            // gardé 10 minutes
  assert.equal(await pinataStatus({ PINATA_JWT: 'good' }, 3), 'ok');
});

// Une fausse chaîne : la création réussit ou échoue, et on regarde quand part l'Ignition Fee.
async function launchFlow({ launchFails }) {
  const wallet = Keypair.generate(), creator = Keypair.generate(), mintKp = Keypair.generate();
  const mint = mintKp.publicKey.toBase58();
  const db = fakeD1();
  await ensureSchema(db);
  const env = {
    DB: db, TOKEN_MINT: Keypair.generate().publicKey.toBase58(), BUYBACK_SECRET_KEY: base58(wallet.secretKey),
    BURN_WALLET: wallet.publicKey.toBase58(), SOLANA_RPC: 'https://rpc.test', IP_SALT: 'x', PINATA_JWT: 'jwt',
  };
  const sent = [];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url === CONFIG.pinataUploadUrl) return Response.json({ data: { cid: 'bafy' } });
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
        sent.push(sig);
        return ok(sig);
      }
      case 'getSignatureStatuses': return ok({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
      case 'getTransaction': {
        const tx = readTransaction(Buffer.from(launchBytes));
        return ok({
          transaction: { message: { accountKeys: tx.keys, header: { numRequiredSignatures: tx.header.required }, instructions: tx.instructions.map((ix) => ({ programIdIndex: ix.program })) } },
          meta: { err: launchFails ? { InstructionError: [0, 'Custom'] } : null, postTokenBalances: [{ mint }] },
        });
      }
      case 'getTokenAccountsByOwner': return ok({ value: [] });
      default: throw new Error(`unexpected ${method}`);
    }
  };
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Wick Cat', symbol: 'WCAT', creator: creator.publicKey.toBase58(), mint, share: '0', devBuy: '0' })) form.append(k, v);
  form.append('image', png());
  const prep = await (await prepare({ request: new Request('http://x/api/launch/prepare', { method: 'POST', body: form }), env })).json();
  assert.equal(prep.feeSol, 0.02);
  const tx = VersionedTransaction.deserialize(Buffer.from(prep.tx, 'base64'));
  tx.sign([creator, mintKp]);
  const launchBytes = tx.serialize();
  const feeTx = VersionedTransaction.deserialize(Buffer.from(prep.feeTx, 'base64'));
  feeTx.sign([creator]);
  const body = JSON.stringify({ mint, tx: Buffer.from(launchBytes).toString('base64'), feeTx: Buffer.from(feeTx.serialize()).toString('base64') });
  const res = await (await submit({ request: new Request('http://x', { method: 'POST', body }), env })).json();
  assert.equal(res.status, 'pending');
  assert.equal(sent.length, 1, 'only the launch is sent at first');
  assert.equal((await db.prepare('SELECT fee_state FROM matches WHERE mint = ?').bind(mint).first()).fee_state, 'held');
  const st = await (await status({ request: new Request(`http://x/api/launch/status?mint=${mint}`), env })).json();
  return { st, sent, env, row: await db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first() };
}

test('the Ignition Fee waits for the launch: sent once the coin is confirmed', async () => {
  const { st, sent, row } = await launchFlow({ launchFails: false });
  assert.equal(st.status, 'lit');
  assert.equal(sent.length, 2);
  assert.equal(sent[1], row.fee_sig);
  assert.ok(['sent', 'paid'].includes(row.fee_state));
  assert.equal(row.share_state, null);
});

test('a failed launch costs no Ignition Fee', async () => {
  const { st, sent, row, env } = await launchFlow({ launchFails: true });
  assert.equal(st.status, 'failed');
  assert.equal(sent.length, 1);
  assert.equal(row.fee_state, 'held');
  // Un nouvel essai avec le même coin : l'ancienne fee gardée est oubliée.
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Wick Cat', symbol: 'WCAT', creator: row.creator, mint: row.mint, share: '0', devBuy: '0' })) form.append(k, v);
  assert.equal((await prepare({ request: new Request('http://x/api/launch/prepare', { method: 'POST', body: form }), env })).status, 200);
  const again = await env.DB.prepare('SELECT * FROM matches WHERE mint = ?').bind(row.mint).first();
  assert.deepEqual([again.fee_state, again.share_tx, again.fee_sig], [null, null, null]);
});
