// Le lancement d'un coin sur pump.fun, côté serveur :
// 1. l'image, puis les métadonnées (un JSON qui pointe vers l'image) partent sur l'IPFS par
//    Pinata (pump.fun n'accepte plus d'upload direct pour les créations par API) ;
// 2. PumpPortal construit la transaction de création (non signée) pour le wallet du créateur.
// Le site ne touche jamais aux clés : le mint est signé dans le navigateur, puis par le wallet.
import { CONFIG } from './config.js';

const ipfsUrl = (env, cid) => `${(env.IPFS_GATEWAY || CONFIG.ipfsGateway).replace(/\/$/, '')}/ipfs/${cid}`;

// Un fichier sur l'IPFS (public), par l'API v3 de Pinata. Renvoie son CID.
async function pin(env, blob, name) {
  const form = new FormData();
  form.append('file', blob, name);
  form.append('network', 'public');
  form.append('name', name);
  const res = await fetch(CONFIG.pinataUploadUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PINATA_JWT}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  const cid = data?.data?.cid;
  if (!res.ok || !cid) {
    const detail = `HTTP ${res.status} ${JSON.stringify(data?.error ?? data ?? '').slice(0, 160)}`;
    throw Object.assign(new Error('ipfs_failed'), { detail });
  }
  return cid;
}

// Les métadonnées du coin, au format attendu par pump.fun. Renvoie { uri, image }.
export async function uploadMetadata(env, launch, image) {
  if (!env.PINATA_JWT) throw Object.assign(new Error('ipfs_not_configured'), { detail: 'PINATA_JWT missing' });
  const tag = `${launch.symbol}-${launch.mint.slice(0, 8)}`;
  const ext = (image.type || '').split('/')[1] || 'png';
  const imageUrl = ipfsUrl(env, await pin(env, image, `${tag}.${ext}`));
  const meta = {
    name: launch.name,
    symbol: launch.symbol,
    description: launch.description || '',
    image: imageUrl,
    showName: true,
    ...(launch.twitter ? { twitter: launch.twitter } : {}),
    ...(launch.telegram ? { telegram: launch.telegram } : {}),
    ...(launch.website ? { website: launch.website } : {}),
  };
  const json = new Blob([JSON.stringify(meta)], { type: 'application/json' });
  const uri = ipfsUrl(env, await pin(env, json, `${tag}.json`));
  return { uri, image: imageUrl };
}

// La clé Pinata fonctionne-t-elle ? (pour la page d'admin) 'ok' | 'missing' | 'invalid' | 'unreachable'
let authCache = null;
export async function pinataStatus(env, now = Date.now()) {
  if (!env.PINATA_JWT) return 'missing';
  if (authCache?.jwt === env.PINATA_JWT && now - authCache.at < 10 * 60_000) return authCache.status;
  let status;
  try {
    const res = await fetch(CONFIG.pinataAuthUrl, { headers: { authorization: `Bearer ${env.PINATA_JWT}` } });
    status = res.ok ? 'ok' : res.status === 401 || res.status === 403 ? 'invalid' : 'unreachable';
  } catch {
    status = 'unreachable';
  }
  authCache = { jwt: env.PINATA_JWT, at: now, status };
  return status;
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
