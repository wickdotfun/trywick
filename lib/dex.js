// DEX Screener (gratuit, sans clé). Sa limite est comptée par adresse IP, et les Workers sortent
// par des IP de Cloudflare partagées avec d'autres sites : un « 429 » peut arriver même quand WICK
// ne l'appelle presque pas. Une seule porte pour tous ses appels : une nouvelle tentative après un
// court instant, puis une pause d'une minute (ce qui échoue est simplement relu au cron suivant).
const PAUSE_MS = 60_000;
const RETRY_MS = 1_500;
let pausedUntil = 0;

export const dexPaused = (now = Date.now()) => now < pausedUntil;
export const dexReset = () => { pausedUntil = 0; };

// → le JSON de la réponse, ou une erreur « dexscreener_<status> ».
export async function dexJson(url, { retryMs = RETRY_MS } = {}) {
  if (dexPaused()) throw new Error('dexscreener_429');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status !== 429) throw new Error(`dexscreener_${res.status}`);
    if (attempt) {
      const wait = Number(res.headers.get('retry-after')) * 1000;
      pausedUntil = Date.now() + (wait > 0 ? Math.min(wait, 10 * PAUSE_MS) : PAUSE_MS);
      throw new Error('dexscreener_429');
    }
    await new Promise((r) => setTimeout(r, retryMs));
  }
}
