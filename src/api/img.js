// GET /api/img?cid=… : le logo d'un coin (sur l'IPFS), servi par le site. La passerelle publique
// (ipfs.io) est souvent lente ou refuse : on essaie plusieurs passerelles, et l'image, qui ne change
// jamais (un CID = un contenu), est gardée en cache un an.
import { json } from '../../lib/http.js';
import { gateways, isCid } from '../../lib/ipfs.js';

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];   // pas de SVG (du code)
const MAX = 5_000_000;
export { isCid };

export async function img({ request, env }) {
  const cid = new URL(request.url).searchParams.get('cid');
  if (!isCid(cid)) return json({ error: 'bad_cid' }, 400);
  const cache = globalThis.caches?.default;
  const key = new Request(`https://wick-img.cache/${cid}`);
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  for (const g of gateways(env)) {
    try {
      const res = await fetch(`${g}/ipfs/${cid}`, { signal: AbortSignal.timeout(8000) });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !TYPES.includes(type)) continue;
      const body = await res.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX) continue;
      const out = new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
      if (cache) await cache.put(key, out.clone());
      return out;
    } catch {
      // la passerelle suivante
    }
  }
  return json({ error: 'not_found' }, 404);
}
