import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM, base58 } from '../../lib/solana.js';

const BLOCKHASH = Keypair.generate().publicKey.toBase58();

// Un faux Solana + PumpPortal : chaque achat rapporte 1 000 000 de jetons au wallet.
export function fakeChain(wallet, { lamports, held = 5_000_000n, failBuy = false }) {
  const calls = [];
  const portal = [];          // les actions PumpPortal, dans l'ordre où leurs transactions partent
  const sent = [];
  const buys = [];
  let tokens = held;
  globalThis.fetch = async (url, init) => {
    const body = init?.body;
    if (String(url).includes('pumpportal')) {
      const req = JSON.parse(body);
      calls.push(`portal:${req.action}`);
      portal.push(req);
      const msg = new TransactionMessage({
        payerKey: new PublicKey(wallet.publicKey), recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(wallet.publicKey), toPubkey: new PublicKey(wallet.publicKey), lamports: portal.length })],
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
        const isBurn = tx.message.staticAccountKeys.some((k) => k.toBase58() === TOKEN_PROGRAM);
        if (!isBurn) {
          const req = portal.shift();
          if (req?.action === 'buy') {
            buys.push({ sig, ...req });
            if (!failBuy) tokens += 1_000_000n;
          }
        }
        return ok(sig);
      }
      case 'getSignatureStatuses': {
        const fail = failBuy && buys.some((b) => b.sig === params[0][0]);
        return ok({ value: [{ confirmationStatus: 'confirmed', err: fail ? { InstructionError: [0, 'x'] } : null }] });
      }
      case 'getLatestBlockhash': return ok({ value: { blockhash: BLOCKHASH } });
      default: throw new Error(`unexpected rpc ${method}`);
    }
  };
  return { calls, sent, buys, tokens: () => tokens };
}

