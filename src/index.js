// Point d'entrée du Worker Cloudflare. Les fichiers de public/ (le site) sont
// servis directement ; tout le reste arrive ici, et seules les routes /api existent.
import { onRequestPost as act } from './api/act.js';
import { onRequestPost as adminPaid } from './api/admin.js';
import { onRequestGet as candle } from './api/candle.js';
import { onRequestPost as light } from './api/light.js';
import { onRequestPost as payout } from './api/payout.js';
import { onRequestPost as recover } from './api/recover.js';
import { onRequestGet as state } from './api/state.js';
import { onRequestGet as thought } from './api/thought.js';
import { json } from '../lib/http.js';
import { getMarket } from '../lib/market.js';
import { ensureSchema } from '../lib/schema.js';
import { tickWorld } from '../lib/world.js';

const ROUTES = {
  'GET /api/state': state,
  'POST /api/light': light,
  'POST /api/act': act,
  'GET /api/candle': candle,
  'GET /api/thought': thought,
  'POST /api/recover': recover,
  'POST /api/payout': payout,
  'POST /api/admin/paid': adminPaid,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[`${request.method} ${pathname}`];
    if (handler) {
      try {
        return await handler({ request, env });
      } catch (err) {
        console.error(pathname, err?.stack ?? err);
        return json({ error: 'server_error' }, 500);
      }
    }
    if (pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    const res = await env.ASSETS.fetch(request);
    // X et Telegram veulent une adresse complète pour l'image d'aperçu du lien.
    if ((res.headers.get('content-type') || '').includes('text/html')) {
      const origin = new URL(request.url).origin;
      return new HTMLRewriter()
        .on('meta[property="og:image"], meta[name="twitter:image"]', {
          element(el) { el.setAttribute('content', origin + el.getAttribute('content')); },
        })
        .transform(res);
    }
    return res;
  },

  // Toutes les 10 minutes (voir wrangler.toml) : les bougies vieillissent même sans visiteurs,
  // et le tirage de la semaine a lieu à l'heure, même si personne ne visite le site.
  async scheduled(event, env) {
    const now = Date.now();
    await ensureSchema(env.DB);
    const market = await getMarket(env, now);
    await tickWorld(env, now, market.mood, true);
  },
};
