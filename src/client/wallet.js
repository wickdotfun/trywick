// Le lancement d'un coin, et l'achat / la vente de $WICK, chargés seulement au moment où on en a
// besoin (la bibliothèque Solana est lourde, inutile de la charger pour regarder la bougie).
//
// Les clés ne quittent jamais le navigateur :
// - le mint (l'adresse du nouveau coin) est une clé générée ici, qui signe ici ;
// - le créateur signe dans son wallet (connect.js, par le Wallet Standard).
// L'ordre des signatures suit la recommandation de Phantom pour les transactions à plusieurs
// signataires : le wallet signe d'abord, le mint ensuite. Une transaction par demande de
// signature (jamais plusieurs d'un coup).
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

// fields : les textes du formulaire ; image : le fichier (Blob).
// onStep('upload' | 'sign' | 'sign2' | 'send' | 'confirm')
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

  // 2. L'Ignition Fee (et le partage des creator fees, s'il est choisi) : le wallet seul.
  let feeTx = null;
  if (prepared.feeTx) {
    onStep('sign2');
    feeTx = await signBytes(b64.from(prepared.feeTx));
  }

  onStep('send');
  const sent = await post('/api/launch/submit', { mint, tx: b64.to(tx.serialize()), feeTx: feeTx ? b64.to(feeTx) : null });

  onStep('confirm');
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const s = await call(`/api/launch/status?mint=${mint}`).catch(() => ({ status: 'pending' }));
    if (s.status === 'lit') { mintKey = null; return { match: s.match, signature: sent.signature }; }
    if (s.status === 'failed') throw Object.assign(new Error('tx_failed'), { code: 'tx_failed' });
    await new Promise((r) => setTimeout(r, 2500));
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
