// Le lancement d'un coin sur pump.fun, côté serveur :
// 1. l'image et les textes partent sur l'IPFS de pump.fun (on récupère l'adresse des métadonnées) ;
// 2. PumpPortal construit la transaction de création (non signée) pour le wallet du créateur.
// Le site ne touche jamais aux clés : le mint est signé dans le navigateur, puis par le wallet.
import { CONFIG } from './config.js';

export async function uploadMetadata(launch, image) {
  const form = new FormData();
  form.append('file', image, image.name || 'image');
  form.append('name', launch.name);
  form.append('symbol', launch.symbol);
  form.append('description', launch.description);
  form.append('twitter', launch.twitter);
  form.append('telegram', launch.telegram);
  form.append('website', launch.website);
  form.append('showName', 'true');
  const res = await fetch(CONFIG.ipfsUrl, { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.metadataUri) {
    throw Object.assign(new Error('ipfs_failed'), { detail: `HTTP ${res.status}` });
  }
  return { uri: data.metadataUri, image: data.metadata?.image || null };
}

export async function buildCreateTx(launch, uri) {
  const res = await fetch(CONFIG.pumpPortalUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: launch.creator,
      action: 'create',
      tokenMetadata: { name: launch.name, symbol: launch.symbol, uri },
      mint: launch.mint,
      denominatedInSol: 'true',
      amount: launch.devBuy,
      slippage: CONFIG.slippage,
      priorityFee: CONFIG.priorityFeeSol,
      pool: 'pump',
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw Object.assign(new Error('build_failed'), { detail: `HTTP ${res.status} ${detail}`.trim() });
  }
  return new Uint8Array(await res.arrayBuffer());
}
