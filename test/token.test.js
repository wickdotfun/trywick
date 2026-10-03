import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { CONFIG } from '../lib/config.js';
import { PUMPSWAP_PROGRAM, checkTradeTx, pickPair, readCurve, tokenView, validateTrade } from '../lib/token.js';

const BLOCKHASH = '11111111111111111111111111111111';
const MINT = 'So11111111111111111111111111111111111111112';
const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

function tradeTx(owner, { program = CONFIG.pumpProgram, extraSigner = null } = {}) {
  const keys = [{ pubkey: owner.publicKey, isSigner: true, isWritable: true }];
  if (extraSigner) keys.push({ pubkey: extraSigner.publicKey, isSigner: true, isWritable: false });
  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    new TransactionInstruction({ programId: new PublicKey(program), keys, data: Buffer.from([102, 6]) }),
    SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 5000 }),
  ];
  const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message();
  return new VersionedTransaction(msg);
}

test('the market comes from the most liquid pair of the coin', () => {
  const pairs = [
    { baseToken: { address: MINT }, dexId: 'pumpfun', pairAddress: 'curve', liquidity: { usd: 0 }, volume: { h24: 10 }, priceUsd: '0.00001', marketCap: 9000 },
    { baseToken: { address: MINT }, dexId: 'pumpswap', pairAddress: 'pool', liquidity: { usd: 40000 }, volume: { h24: 5 },
      priceUsd: '0.0001', priceNative: '0.0000005', marketCap: 100000, priceChange: { h24: 12.5 }, txns: { h24: { buys: 40, sells: 12 } } },
    { baseToken: { address: 'other' }, liquidity: { usd: 1e9 } },
  ];
  const m = pickPair(pairs, MINT);
  assert.equal(m.dex, 'pumpswap');
  assert.equal(m.pair, 'pool');
  assert.equal(m.priceUsd, 0.0001);
  assert.equal(m.mcap, 100000);
  assert.equal(m.change.h24, 12.5);
  assert.equal(m.buys24h, 40);
  assert.equal(pickPair([], MINT), null);
  assert.equal(pickPair(null, MINT), null);
});

test('reads the pump.fun bonding curve', () => {
  const bytes = new Uint8Array(81);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(24, 793_100_000_000_000n / 4n, true);   // 3/4 sold
  view.setBigUint64(32, 60_000_000_000n, true);             // 60 SOL in the curve
  const c = readCurve(bytes);
  assert.equal(c.progress, 0.75);
  assert.equal(c.complete, false);
  assert.equal(c.sol, 60);
  bytes[48] = 1;
  assert.equal(readCurve(bytes).progress, 1);
  assert.equal(readCurve(new Uint8Array(10)), null);
});

test('trades: amounts, side and slippage are checked', () => {
  assert.deepEqual(validateTrade({ owner: OWNER, side: 'buy', amount: '0.5', slippage: 10 }).value,
    { owner: OWNER, side: 'buy', amount: 0.5, slippage: 10 });
  assert.equal(validateTrade({ owner: OWNER, side: 'sell', amount: '50' }).value.amount, 50);
  assert.equal(validateTrade({ owner: 'nope', side: 'buy', amount: 1 }).error, 'bad_owner');
  assert.equal(validateTrade({ owner: OWNER, side: 'swap', amount: 1 }).error, 'bad_side');
  assert.equal(validateTrade({ owner: OWNER, side: 'buy', amount: 0 }).error, 'bad_amount');
  assert.equal(validateTrade({ owner: OWNER, side: 'buy', amount: 1000 }).error, 'bad_amount');
  assert.equal(validateTrade({ owner: OWNER, side: 'sell', amount: 101 }).error, 'bad_amount');
  assert.equal(validateTrade({ owner: OWNER, side: 'buy', amount: 1, slippage: 99 }).error, 'bad_slippage');
  assert.equal(validateTrade(null).error, 'bad_owner');
});

test('only a pump.fun or PumpSwap trade paid and signed by the visitor is relayed', () => {
  const owner = Keypair.generate();
  const me = { owner: owner.publicKey.toBase58() };
  const tx = tradeTx(owner);
  assert.equal(checkTradeTx(tx.serialize(), me), null);
  assert.equal(checkTradeTx(tx.serialize(), { ...me, signed: true }), 'unsigned');
  tx.sign([owner]);
  assert.equal(checkTradeTx(tx.serialize(), { ...me, signed: true }), null);

  const swap = tradeTx(owner, { program: PUMPSWAP_PROGRAM });
  swap.sign([owner]);
  assert.equal(checkTradeTx(swap.serialize(), { ...me, signed: true }), null);

  assert.equal(checkTradeTx(tx.serialize(), { owner: OWNER }), 'wrong_payer');
  assert.equal(checkTradeTx(tradeTx(owner, { program: Keypair.generate().publicKey.toBase58() }).serialize(), me), 'not_pump');
  assert.equal(checkTradeTx(tradeTx(owner, { extraSigner: Keypair.generate() }).serialize(), me), 'bad_tx');
  assert.equal(checkTradeTx(new Uint8Array([1, 2, 3]), me), 'bad_tx');
});

test('the $WICK page shows nothing before the coin exists', async () => {
  assert.deepEqual(await tokenView({}, Date.now()), { mint: null });
});

test('the $WICK page: market, curve and holders', async (t) => {
  const curve = new Uint8Array(81);
  new DataView(curve.buffer).setBigUint64(24, 793_100_000_000_000n / 2n, true);
  const curveB64 = Buffer.from(curve).toString('base64');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith('https://api.dexscreener.com/')) {
      return Response.json([{ baseToken: { address: MINT }, dexId: 'pumpfun', pairAddress: 'Curve111', priceUsd: '0.00002', marketCap: 20000 }]);
    }
    const { method, params } = JSON.parse(init.body);
    calls.push(method);
    const result = {
      getAccountInfo: { value: { owner: CONFIG.pumpProgram, data: [curveB64, 'base64'] } },
      getTokenSupply: { value: { uiAmountString: '1000000000' } },
      getTokenLargestAccounts: { value: [{ address: 'Acc1', uiAmountString: '400000000' }, { address: 'Acc2', uiAmountString: '20000000' }] },
      getMultipleAccounts: { value: [{ data: { parsed: { info: { owner: 'Curve111' } } } }, { data: { parsed: { info: { owner: 'Someone' } } } }] },
    }[method];
    assert.ok(result, method);
    if (method === 'getAccountInfo') assert.equal(params[0], 'Curve111');
    return Response.json({ jsonrpc: '2.0', id: 1, result });
  });
  const v = await tokenView({ TOKEN_MINT: MINT, SOLANA_RPC: 'https://rpc.test' }, 1e12);
  assert.equal(v.market.mcap, 20000);
  assert.equal(v.curve.progress, 0.5);
  assert.equal(v.supply, 1e9);
  assert.equal(v.holders.length, 2);
  assert.deepEqual(v.holders[0], { owner: 'Curve111', amount: 4e8, pct: 40, label: 'bonding curve' });
  assert.equal(v.holders[1].label, null);
  // Gardé en mémoire : pas de nouvel appel dans les 20 s.
  const n = calls.length;
  await tokenView({ TOKEN_MINT: MINT }, 1e12 + 5000);
  assert.equal(calls.length, n);
});
