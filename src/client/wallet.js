// Le lancement d'un coin, et l'achat / la vente de $WICK, chargés seulement au moment où on en a
// besoin (la bibliothèque Solana est lourde, inutile de la charger pour regarder la bougie).
//
// Les clés ne quittent jamais le navigateur :
// - le mint (l'adresse du nouveau coin) est une clé générée ici, qui signe ici ;
// - le créateur signe dans son wallet (connect.js, par le Wallet Standard).
// L'ordre des signatures suit la recommandation de Phantom pour les transactions à plusieurs
// signataires : le wallet signe d'abord, le mint ensuite. Une transaction par demande de
// signature (jamais plusieurs d'un coup). Et jamais une transaction qui échouerait à la
// simulation (Phantom l'afficherait en rouge) : l'Ignition Fee et le partage des creator fees se
// signent une fois le coin créé, quand le serveur a vérifié qu'ils passent.
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { signBytes } from './connect.js';

const b64 = {
  from(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); },
  to(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
};

async function call(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({ error: 'server_error' }));
  if (data.error) throw Object.assign(new Error(data.error), { code: data.error, data });
  return data;
}
const post = (url, body) => call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// Le même mint est gardé pour les nouveaux essais (transaction expirée, wallet fermé…),
// jusqu'à ce que le coin soit lancé : les métadonnées déjà envoyées resservent.
let mintKey = null;
export function resetMint() { mintKey = null; }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// L'Ignition Fee (et le partage) d'un coin qui existe : le serveur la fait et la simule (en
// réessayant tant que le coin n'est pas encore visible), le wallet la signe, le serveur l'envoie.
// Renvoie l'état de la fee ('sent', 'paid'…).
export async function payFee({ mint, onStep = () => {} }) {
  const until = Date.now() + 45_000;
  let fee;
  for (;;) {
    try {
      fee = await post('/api/launch/fee', { mint });
      break;
    } catch (err) {
      if (!['fee_not_ready', 'not_created'].includes(err.code) || Date.now() > until) throw err;
      await wait(2500);
    }
  }
  if (!fee.feeTx) return fee.status;
  onStep('sign2');
  const signed = await signBytes(b64.from(fee.feeTx));
  onStep('fee');
  const res = await post('/api/launch/fee/submit', { mint, feeTx: b64.to(signed) });
  return res.status;
}

// fields : les textes du formulaire ; image : le fichier (Blob).
// onStep('upload' | 'sign' | 'send' | 'confirm' | 'sign2' | 'fee')
export async function strike({ creator, fields, image, onStep }) {
  mintKey ??= Keypair.generate();
  const mint = mintKey.publicKey.toBase58();

  onStep('upload');
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v ?? '');
  form.append('creator', creator);
  form.append('mint', mint);
  form.append('image', image, image.name || 'image.png');
  const prepared = await call('/api/launch/prepare', { method: 'POST', body: form });

  // 1. La création du coin : le wallet signe d'abord, puis la clé du mint.
  onStep('sign');
  const signedByWallet = await signBytes(b64.from(prepared.tx));
  const tx = VersionedTransaction.deserialize(signedByWallet);
  tx.sign([mintKey]);

  onStep('send');
  const sent = await post('/api/launch/submit', { mint, tx: b64.to(tx.serialize()) });

  onStep('confirm');
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const s = await call(`/api/launch/status?mint=${mint}`).catch(() => ({ status: 'pending' }));
    if (s.status === 'lit') {
      mintKey = null;
      // 2. Le coin existe : l'Ignition Fee et le partage des creator fees, le wallet seul.
      let feeMissing = false;
      if (sent.fee) {
        try { await payFee({ mint, onStep }); } catch (err) { feeMissing = err.code || 'failed'; }
      }
      return { match: s.match, signature: sent.signature, mint, feeMissing };
    }
    if (s.status === 'failed') throw Object.assign(new Error('tx_failed'), { code: 'tx_failed' });
    await wait(2500);
  }
  // Pas encore confirmée : le serveur continuera de la surveiller.
  mintKey = null;
  return { match: null, signature: sent.signature, mint };
}

// Acheter ou vendre $WICK depuis le site. PumpPortal construit la transaction (côté serveur),
// le wallet la signe, le serveur la relaie. onStep('build' | 'sign' | 'send' | 'confirm')
export async function trade({ owner, side, amount, slippage, onStep }) {
  onStep('build');
  const prepared = await post('/api/trade/prepare', { owner, side, amount, slippage });
  onStep('sign');
  const signed = await signBytes(b64.from(prepared.tx));
  onStep('send');
  const { signature } = await post('/api/trade/send', { owner, tx: b64.to(signed) });
  onStep('confirm');
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const s = await call(`/api/trade/status?sig=${signature}`).catch(() => ({ status: 'pending' }));
    if (s.status === 'ok') return { status: 'ok', signature };
    if (s.status === 'failed') throw Object.assign(new Error('tx_failed'), { code: 'tx_failed' });
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { status: 'pending', signature };
}
