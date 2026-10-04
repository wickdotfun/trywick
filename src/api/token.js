// La page $WICK : son marché, et l'achat / la vente depuis le site.
//   GET  /api/token                          → prix, market cap, courbe, holders
//   POST /api/trade/prepare  { owner, side, amount, slippage } → la transaction à signer
//   POST /api/trade/send     { owner, tx }   → envoyée sur Solana
//   GET  /api/trade/status?sig=…             → pending | ok | failed
import { shortOfFunds, tradeNeedSol } from '../../lib/funds.js';
import { json } from '../../lib/http.js';
import { base64FromBytes, bytesFromBase64, sendTransaction, signatureOf, signatureStatus } from '../../lib/solana.js';
import { buildTradeTx, checkTradeTx, tokenView, validateTrade } from '../../lib/token.js';
import { isPubkey } from '../../lib/launch.js';

export async function token({ env }) {
  return json(await tokenView(env, Date.now()));
}

export async function tradePrepare({ request, env }) {
  if (!env.TOKEN_MINT) return json({ error: 'not_live' }, 409);
  const { value: t, error } = validateTrade(await request.json().catch(() => null));
  if (error) return json({ error }, 400);
  // Assez de SOL pour l'achat (ou les frais de la vente) avant de proposer la signature.
  const short = await shortOfFunds(env, t.owner, tradeNeedSol(t));
  if (short) return json({ error: 'no_funds', ...short }, 409);
  let tx;
  try {
    tx = await buildTradeTx(env, t);
  } catch (err) {
    console.error('trade build', err.detail || err.message);
    // PumpPortal refuse une vente quand le wallet n'a pas de $WICK.
    return json({ error: t.side === 'sell' && /balance|account|0 tokens/i.test(err.detail || '') ? 'no_tokens' : 'build_failed' }, 502);
  }
  const problem = checkTradeTx(tx, { owner: t.owner });
  if (problem) {
    console.error('trade check', problem);
    return json({ error: 'build_failed' }, 502);
  }
  return json({ tx: base64FromBytes(tx) });
}

export async function tradeSend({ request, env }) {
  if (!env.TOKEN_MINT) return json({ error: 'not_live' }, 409);
  const body = await request.json().catch(() => null);
  if (!isPubkey(body?.owner) || typeof body.tx !== 'string' || body.tx.length > 3000) return json({ error: 'bad_request' }, 400);
  let bytes;
  try { bytes = bytesFromBase64(body.tx); } catch { return json({ error: 'bad_tx' }, 400); }
  const problem = checkTradeTx(bytes, { owner: body.owner, signed: true });
  if (problem) return json({ error: problem }, 400);
  try {
    await sendTransaction(env, bytes);
  } catch (err) {
    const msg = `${err.message} ${JSON.stringify(err.rpc?.data?.logs || '')}`;
    console.error('trade send', msg.slice(0, 400));
    if (/blockhash/i.test(msg)) return json({ error: 'expired' }, 409);
    // pump.fun : TooMuchSolRequired (6002) / TooLittleSolReceived (6003) ; PumpSwap : ExceededSlippage.
    if (/0x1772|0x1773|slippage/i.test(msg)) return json({ error: 'slippage' }, 409);
    if (/insufficient|lamports|0x1\b/i.test(msg)) return json({ error: 'no_funds' }, 409);
    return json({ error: 'send_failed' }, 502);
  }
  return json({ signature: signatureOf(bytes) });
}

export async function tradeStatus({ request, env }) {
  const sig = new URL(request.url).searchParams.get('sig') || '';
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) return json({ error: 'bad_request' }, 400);
  const st = await signatureStatus(env, sig).catch(() => null);
  return json({ status: !st ? 'pending' : st.ok ? 'ok' : 'failed' });
}
