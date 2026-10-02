// Point d'entrée du Worker Cloudflare. Les fichiers de public/ (le site) sont
// servis directement ; tout le reste arrive ici, et seules les routes /api existent.
import { prepare, status, submit } from './api/launch.js';
import { state } from './api/state.js';
import { json } from '../lib/http.js';
import { sweep } from '../lib/matches.js';
import { ensureSchema } from '../lib/schema.js';

const ROUTES = {
  'GET /api/state': state,
  'POST /api/launch/prepare': prepare,
  'POST /api/launch/submit': submit,
  'GET /api/launch/status': status,
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

  // Toutes les 2 minutes (voir wrangler.toml) : les allumettes envoyées dont le navigateur
  // a été fermé avant la confirmation s'allument quand même.
  async scheduled(event, env) {
    await ensureSchema(env.DB);
    await sweep(env, Date.now());
  },
};
