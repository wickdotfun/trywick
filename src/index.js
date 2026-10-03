// Point d'entrée du Worker Cloudflare. Les fichiers de public/ (le site) sont
// servis directement ; tout le reste arrive ici, et seules les routes /api existent.
import { adminPause, adminRun, adminStatus, recordRun } from './api/admin.js';
import { launches, profile } from './api/explore.js';
import { prepare, status, submit } from './api/launch.js';
import { board } from './api/leaderboard.js';
import { state } from './api/state.js';
import { token, tradePrepare, tradeSend, tradeStatus } from './api/token.js';
import { json } from '../lib/http.js';
import { runBuyback } from '../lib/buyback.js';
import { tickCycle } from '../lib/cycles.js';
import { checkMilestones } from '../lib/hall.js';
import { refreshMarkets } from '../lib/markets.js';
import { runShares } from '../lib/sharing.js';
import { runTelegram } from '../lib/telegram.js';
import { sweep } from '../lib/matches.js';
import { ensureSchema } from '../lib/schema.js';

const ROUTES = {
  'GET /api/state': state,
  'GET /api/leaderboard': board,
  'GET /api/launches': launches,
  'GET /api/profile': profile,
  'GET /api/token': token,
  'POST /api/trade/prepare': tradePrepare,
  'POST /api/trade/send': tradeSend,
  'GET /api/trade/status': tradeStatus,
  'POST /api/launch/prepare': prepare,
  'POST /api/launch/submit': submit,
  'GET /api/launch/status': status,
  'GET /api/admin/status': adminStatus,
  'POST /api/admin/pause': adminPause,
  'POST /api/admin/run': adminRun,
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

  // Chaque minute (voir wrangler.toml) : les allumettes envoyées dont le navigateur a été
  // fermé avant la confirmation s'allument quand même (et leur frais de lancement part au burn),
  // la bougie s'éteint à l'heure même sans visiteurs, les burns avancent, le marché des
  // allumettes se met à jour, les creator fees partagées sont distribuées et le bot Telegram poste.
  async scheduled(event, env) {
    await ensureSchema(env.DB);
    const now = Date.now();
    await sweep(env, now);
    const open = await tickCycle(env, now);
    const step = await recordRun(env, () => runBuyback(env, Date.now()));
    if (step) console.log('buyback', step);
    const steps = [
      checkMilestones(env, Date.now()),
      refreshMarkets(env, Date.now(), open?.id),
      runShares(env, Date.now()),
      runTelegram(env, Date.now()),
    ];
    for (const r of await Promise.allSettled(steps)) {
      if (r.status === 'rejected') console.error('cron', r.reason?.message ?? r.reason);
    }
  },
};
