// Le wallet et le lancement du coin, chargés seulement au moment où on frappe une allumette
// (la bibliothèque Solana est lourde, inutile de la charger pour regarder la bougie).
//
// Les clés ne quittent jamais le navigateur :
// - le mint (l'adresse du nouveau coin) est une clé générée ici, qui signe ici ;
// - le créateur signe dans son wallet (Phantom, Solflare, Backpack…).
// Le serveur prépare la transaction (pump.fun) et relaie la transaction signée.
import { Keypair, VersionedTransaction } from '@solana/web3.js';

export function findWallets() {
  const found = [];
  const add = (id, name, provider) => {
    if (provider && !found.some((w) => w.provider === provider)) found.push({ id, name, provider });
  };
  add('phantom', 'Phantom', window.phantom?.solana?.isPhantom ? window.phantom.solana : null);
  add('solflare', 'Solflare', window.solflare?.isSolflare ? window.solflare : null);
  add('backpack', 'Backpack', window.backpack?.isBackpack ? window.backpack : null);
  if (window.solana && !found.some((w) => w.provider === window.solana)) {
    add('wallet', window.solana.isPhantom ? 'Phantom' : 'Solana wallet', window.solana);
  }
  return found;
}

export async function connect(wallet) {
  const res = await wallet.provider.connect();
  const key = res?.publicKey ?? wallet.provider.publicKey;
  if (!key) throw new Error('no_public_key');
  return key.toString();
}

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
  if (data.error) throw Object.assign(new Error(data.error), { code: data.error });
  return data;
}

// Le même mint est gardé pour les nouveaux essais (transaction expirée, wallet fermé…),
// jusqu'à ce que le coin soit lancé : les métadonnées déjà envoyées resservent.
let mintKey = null;
export function resetMint() { mintKey = null; }

// fields : les textes du formulaire ; image : le fichier (Blob).
// onStep('upload' | 'sign' | 'send' | 'confirm')
export async function strike({ wallet, creator, fields, image, onStep }) {
  mintKey ??= Keypair.generate();
  const mint = mintKey.publicKey.toBase58();

  onStep('upload');
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v ?? '');
  form.append('creator', creator);
  form.append('mint', mint);
  form.append('image', image, image.name || 'image.png');
  const prepared = await call('/api/launch/prepare', { method: 'POST', body: form });

  onStep('sign');
  const tx = VersionedTransaction.deserialize(b64.from(prepared.tx));
  const feeTx = prepared.feeTx ? VersionedTransaction.deserialize(b64.from(prepared.feeTx)) : null;
  // Le wallet signe d'abord (c'est ce que demande Phantom), puis la clé du mint. Avec un frais de
  // lancement, les deux transactions sont signées d'un coup (une seule validation).
  let signed, signedFee = null;
  try {
    if (feeTx && wallet.provider.signAllTransactions) {
      [signed, signedFee] = await wallet.provider.signAllTransactions([tx, feeTx]);
    } else {
      signed = (await wallet.provider.signTransaction(tx)) || tx;
      if (feeTx) signedFee = (await wallet.provider.signTransaction(feeTx)) || feeTx;
    }
  } catch (err) {
    throw Object.assign(new Error('rejected'), { code: 'rejected', cause: err });
  }
  signed.sign([mintKey]);

  onStep('send');
  const sent = await call('/api/launch/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mint, tx: b64.to(signed.serialize()), feeTx: signedFee ? b64.to(signedFee.serialize()) : null }),
  });

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
