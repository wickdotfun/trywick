// Les images des coins sur l'IPFS. La passerelle publique (ipfs.io) est souvent lente ou refuse :
// on en essaie plusieurs, et on donne à Telegram l'adresse du site (/api/img), en cache.
export const isCid = (cid) => typeof cid === 'string' && /^[A-Za-z0-9]{46,100}$/.test(cid);
export const cidOf = (url) => /\/ipfs\/([A-Za-z0-9]{46,100})(?:[/?#]|$)/.exec(String(url || ''))?.[1] || null;
export const gateways = (env = {}) => [...new Set([env.IPFS_GATEWAY, 'https://gateway.pinata.cloud', 'https://ipfs.io', 'https://dweb.link']
  .filter(Boolean).map((g) => g.replace(/\/$/, '')))];
// L'adresse publique d'une image : celle du site pour une image IPFS, sinon telle quelle.
export function siteImage(env, url) {
  const cid = cidOf(url);
  return cid ? `${(env.SITE_URL || 'https://trywick.fun').replace(/\/$/, '')}/api/img?cid=${cid}` : url;
}
// Les adresses à essayer pour lire une image (les passerelles, puis l'adresse d'origine).
export function imageUrls(env, url) {
  const cid = cidOf(url);
  return cid ? [...gateways(env).map((g) => `${g}/ipfs/${cid}`), url].filter((u, i, a) => a.indexOf(u) === i) : [url];
}
