import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { announceText, detectLaunch, launchIn, readCreate, runAnnounce, withLaunch } from '../lib/announce.js';
import { CONFIG } from '../lib/config.js';
import { ensureSchema } from '../lib/schema.js';
import { getSetting } from '../lib/settings.js';
import { base58, readTransaction } from '../lib/solana.js';
import { fakeD1 } from './helpers/d1.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function borsh(...strings) {
  const parts = strings.map((s) => { const b = Buffer.from(s); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); });
  return Buffer.concat(parts);
}
const CREATE_V2 = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

// Une transaction confirmée de création pump.fun, comme la renvoie getTransaction (json).
function createTx(payer, mint, symbol, { program = CONFIG.pumpProgram } = {}) {
  const data = Buffer.concat([CREATE_V2, borsh('Wick', symbol, 'https://ipfs/x'), payer.toBuffer(), Buffer.from([0, 0, 0, 0])]);
  const ix = new TransactionInstruction({
    programId: new PublicKey(program),
    keys: [{ pubkey: mint, isSigner: true, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: true }],
    data,
  });
  const bytes = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [ix] }).compileToV0Message()).serialize();
  const tx = readTransaction(bytes);
  return {
    transaction: { message: { accountKeys: tx.keys, instructions: tx.instructions.map((i) => ({ programIdIndex: i.program, accounts: i.accounts, data: base58(i.data) })) } },
    meta: { err: null },
  };
}

test('reads the name and ticker of a pump.fun create', () => {
  assert.deepEqual(readCreate(Buffer.concat([CREATE_V2, borsh('Wick', 'WICK', 'u')])), { name: 'Wick', symbol: 'WICK', uri: 'u' });
  assert.equal(readCreate(Buffer.concat([Buffer.alloc(8), borsh('a', 'b', 'c')])), null);
  assert.equal(readCreate(Buffer.from([214, 144, 76, 236, 95, 139, 49, 180, 255, 255, 255, 255])), null);
});

test('finds the coin a wallet created, only its own and only on pump.fun', () => {
  const dev = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  assert.deepEqual(launchIn(createTx(dev, mint, 'WICK'), dev.toBase58()), { mint: mint.toBase58(), name: 'Wick', symbol: 'WICK' });
  assert.equal(launchIn(createTx(dev, mint, 'WICK'), Keypair.generate().publicKey.toBase58()), null);
  assert.equal(launchIn(createTx(dev, mint, 'WICK', { program: Keypair.generate().publicKey.toBase58() }), dev.toBase58()), null);
  assert.equal(launchIn({ ...createTx(dev, mint, 'WICK'), meta: { err: { x: 1 } } }, dev.toBase58()), null);
});

test('the official message is the one of the first X post, with the CA', () => {
  const t = announceText('MintAddr111', { ticker: 'WICK', site: 'https://trywick.fun' });
  assert.equal(t, '$WICK is live. the only CA:\n\n<code>MintAddr111</code>\n\nevery coin launched on WICK lights the same flame.\n'
    + 'launch a coin → generate ignition fees → buy $WICK → burn $WICK\n\nthe more WICK is used, the more of its own supply disappears.\n\n'
    + 'the launchpad that burns itself.\nhttps://trywick.fun/');
});

test('announces the launch once, as soon as the dev wallet creates $WICK, and pins it', async () => {
  const dev = Keypair.generate().publicKey, wick = Keypair.generate().publicKey, test1 = Keypair.generate().publicKey;
  const db = fakeD1();
  await ensureSchema(db);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '@wick', DEPLOYER_WALLET: dev.toBase58(), SOLANA_RPC: 'https://rpc' };
  const history = [];            // les signatures du wallet, la plus récente d'abord
  const txs = new Map();
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).startsWith('https://api.telegram.org/')) {
      sent.push({ method: String(url).split('/').pop(), body });
      return Response.json({ ok: true, result: { message_id: 9 } });
    }
    const ok = (result) => Response.json({ jsonrpc: '2.0', id: 1, result });
    if (body.method === 'getSignaturesForAddress') {
      const until = body.params[1].until;
      const i = until ? history.findIndex((s) => s.signature === until) : history.length;
      return ok(history.slice(0, i < 0 ? history.length : i));
    }
    if (body.method === 'getTransaction') return ok(txs.get(body.params[0]));
    throw new Error(body.method);
  };
  const add = (sig, tx) => { history.unshift({ signature: sig, err: null }); txs.set(sig, tx); };

  assert.equal(await runAnnounce(env, 1), null);                       // rien encore
  add('s1', createTx(dev, test1, 'TEST'));                               // un autre coin du dev : ignoré
  assert.equal(await runAnnounce(env, 2), null);
  add('s2', createTx(dev, wick, 'WICK'));                                // le vrai lancement
  assert.equal(await runAnnounce(env, 3), wick.toBase58());
  assert.equal(sent[0].method, 'sendMessage');
  assert.match(sent[0].body.text, new RegExp(`<code>${wick.toBase58()}</code>`));
  assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].url, `https://pump.fun/coin/${wick.toBase58()}`);
  assert.equal(sent[1].method, 'pinChatMessage');
  assert.equal((await getSetting(db, 'launch.announced')).mint, wick.toBase58());
  assert.equal(await runAnnounce(env, 4), null);                         // une seule fois
  assert.equal(sent.length, 2);
});

test('with TOKEN_MINT already set, that address is announced', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  const texts = [];
  globalThis.fetch = async (url, init) => { texts.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: 1 } }); };
  assert.equal(await runAnnounce({ DB: db, TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '@w', TOKEN_MINT: 'SetMint' }, 1), 'SetMint');
  assert.match(texts[0], /<code>SetMint<\/code>/);
  assert.equal(await runAnnounce({ DB: db }, 2), null);                   // sans bot : rien
});

test('the site goes live by itself once the launch is detected, even without Telegram', async () => {
  const dev = Keypair.generate().publicKey, wick = Keypair.generate().publicKey;
  const db = fakeD1();
  await ensureSchema(db);
  const env = { DB: db, DEPLOYER_WALLET: dev.toBase58(), SOLANA_RPC: 'https://rpc' };
  let launched = false;
  globalThis.fetch = async (url, init) => {
    const { method } = JSON.parse(init.body);
    const ok = (result) => Response.json({ jsonrpc: '2.0', id: 1, result });
    if (method === 'getSignaturesForAddress') return ok(launched ? [{ signature: 'L1', err: null }] : []);
    if (method === 'getTransaction') return ok(createTx(dev, wick, 'wick'));
    throw new Error(method);
  };
  assert.equal((await withLaunch(env)).TOKEN_MINT, undefined);
  assert.equal(await runAnnounce(env, 1), null);             // pas de bot, pas de lancement : rien
  launched = true;
  assert.equal(await runAnnounce(env, 2), null);             // pas de bot : pas d'annonce…
  assert.equal((await detectLaunch(env, 3)).mint, wick.toBase58());   // … mais le lancement est noté
  assert.equal((await withLaunch(env)).TOKEN_MINT, wick.toBase58());
  assert.equal((await withLaunch({ ...env, TOKEN_MINT: 'Manual' })).TOKEN_MINT, 'Manual');   // Cloudflare passe avant
});
