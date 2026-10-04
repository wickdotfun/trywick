import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { prepare } from '../src/api/launch.js';
import { tradePrepare } from '../src/api/token.js';
import { CONFIG } from '../lib/config.js';
import { launchNeedSol, shortOfFunds, tradeNeedSol } from '../lib/funds.js';
import { ensureSchema } from '../lib/schema.js';
import { base58 } from '../lib/solana.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const png = () => new File([new Uint8Array(100)], 'cat.png', { type: 'image/png' });

// Un faux Solana : le wallet a `lamports` ; on note tout ce qui est appelé (Pinata, PumpPortal, RPC).
function fakeWorld(owner, lamports) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url === CONFIG.pinataUploadUrl) { calls.push('pinata'); return Response.json({ data: { cid: 'bafy' } }); }
    if (url === CONFIG.pumpPortalUrl) {
      calls.push('portal');
      const msg = new TransactionMessage({
        payerKey: new PublicKey(owner), recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(owner), toPubkey: new PublicKey(owner), lamports: 1 })],
      }).compileToV0Message();
      return new Response(new VersionedTransaction(msg).serialize());
    }
    const { method } = JSON.parse(init.body);
    calls.push(method);
    const ok = (result) => Response.json({ jsonrpc: '2.0', id: 1, result });
    if (method === 'getBalance') return lamports == null ? Response.json({ error: { message: 'down' } }, { status: 500 }) : ok({ value: lamports });
    if (method === 'getLatestBlockhash') return ok({ value: { blockhash: BLOCKHASH } });
    if (method === 'getTokenAccountsByOwner') return ok({ value: [] });
    throw new Error(`unexpected ${method}`);
  };
  return calls;
}

async function launchEnv() {
  const db = fakeD1();
  await ensureSchema(db);
  const wallet = Keypair.generate();
  return {
    DB: db, TOKEN_MINT: Keypair.generate().publicKey.toBase58(), BUYBACK_SECRET_KEY: base58(wallet.secretKey),
    BURN_WALLET: wallet.publicKey.toBase58(), SOLANA_RPC: 'https://rpc.test', IP_SALT: 'x', PINATA_JWT: 'jwt',
  };
}

function launchRequest(creator, devBuy = '0') {
  const form = new FormData();
  const fields = { name: 'Wick Cat', symbol: 'WCAT', creator, mint: Keypair.generate().publicKey.toBase58(), share: '0', devBuy };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('image', png());
  return new Request('http://x/api/launch/prepare', { method: 'POST', body: form });
}

test('what a launch and a trade need: the buy with its fees, the Ignition Fee, the creation', () => {
  const r = CONFIG.funds;
  assert.equal(launchNeedSol(0, 0.02e9), 0.02 + r.launchReserveSol);
  assert.equal(launchNeedSol(1, 0), 1 * (1 + r.buyFees) + r.launchReserveSol);
  assert.equal(tradeNeedSol({ side: 'buy', amount: 0.5 }), 0.5 * (1 + r.buyFees) + r.buyReserveSol);
  assert.equal(tradeNeedSol({ side: 'sell', amount: 100 }), r.sellReserveSol);
});

test('a wallet without enough SOL is stopped before anything is uploaded or signed', async () => {
  const env = await launchEnv();
  const creator = Keypair.generate().publicKey.toBase58();
  const calls = fakeWorld(creator, 0.03e9);
  const res = await prepare({ request: launchRequest(creator), env });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'no_funds');
  assert.equal(body.needSol, Math.ceil((0.02 + CONFIG.funds.launchReserveSol) * 1e4) / 1e4);
  assert.equal(body.haveSol, 0.03);
  assert.ok(!calls.includes('pinata') && !calls.includes('portal'), 'no upload, no transaction');
  assert.equal(body.tx, undefined);
});

test('a wallet with enough SOL gets its transactions', async () => {
  const env = await launchEnv();
  const creator = Keypair.generate().publicKey.toBase58();
  const calls = fakeWorld(creator, 1e9);
  const res = await prepare({ request: launchRequest(creator, '0.5'), env });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).tx);
  assert.deepEqual(calls.slice(calls.indexOf('getBalance'), calls.indexOf('getBalance') + 2), ['getBalance', 'pinata']);
});

test('the dev buy counts: 0.5 SOL in the wallet cannot launch with a 0.5 SOL buy', async () => {
  const env = await launchEnv();
  const creator = Keypair.generate().publicKey.toBase58();
  fakeWorld(creator, 0.5e9);
  const res = await prepare({ request: launchRequest(creator, '0.5'), env });
  assert.equal((await res.json()).error, 'no_funds');
});

test('an unreadable balance (RPC down) never blocks: the wallet keeps its own warning', async () => {
  const creator = Keypair.generate().publicKey.toBase58();
  fakeWorld(creator, null);
  assert.equal(await shortOfFunds({ SOLANA_RPC: 'https://rpc.test' }, creator, 1), null);
});

test('buying or selling $WICK checks the balance before PumpPortal builds the transaction', async () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const env = { TOKEN_MINT: Keypair.generate().publicKey.toBase58(), SOLANA_RPC: 'https://rpc.test' };
  const trade = (body) => tradePrepare({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ owner, slippage: 10, ...body }) }), env });

  let calls = fakeWorld(owner, 0.1e9);
  let res = await trade({ side: 'buy', amount: 0.5 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'no_funds');
  assert.ok(!calls.includes('portal'));

  calls = fakeWorld(owner, 0);
  assert.equal((await (await trade({ side: 'sell', amount: 100 })).json()).error, 'no_funds');

  calls = fakeWorld(owner, 1e9);
  res = await trade({ side: 'buy', amount: 0.5 });
  assert.notEqual((await res.json()).error, 'no_funds');
  assert.ok(calls.includes('portal'), 'enough SOL: the transaction gets built');
});
