// Point d'entrée du Worker Cloudflare. Les fichiers de public/ (le site) sont
// servis directement ; tout le reste arrive ici, et seules les routes /api existent.
import { adminPause, adminPost, adminResetPosts, adminRun, adminSelfTest, adminSocial, adminStatus, recordRun } from './api/admin.js';
import { candles, coin } from './api/candles.js';
import { crew } from './api/crew.js';
import { proof, proofCsv } from './api/proof.js';
import { xCallback, xStart, xUnlink } from './api/x.js';
import { launches, profile } from './api/explore.js';
import { feeSubmit, feeTx, prepare, status, submit } from './api/launch.js';
import { board } from './api/leaderboard.js';
import { ask, spark, sparkLogo } from './api/spark.js';
import { state } from './api/state.js';
import { telegramHook } from './api/telegram.js';
import { token, tradePrepare, tradeSend, tradeStatus } from './api/token.js';
import { json } from '../lib/http.js';
import { runBuyback } from '../lib/buyback.js';
import { tickCycle } from '../lib/cycles.js';
import { checkMilestones } from '../lib/hall.js';
import { refreshMarkets } from '../lib/markets.js';
import { runAnnounce, withLaunch } from '../lib/announce.js';
import { runJournal, runKeepers, runVoices } from '../lib/keepers.js';
import { queueSelfBurn, runShares } from '../lib/sharing.js';
import { runKits } from '../lib/kit.js';
import { runPublish } from '../lib/publish.js';
import { runScout } from '../lib/scout.js';
import { runXPosts } from '../lib/xoperator.js';
import { runCoinX, runSocial } from '../lib/social.js';
import { runTelegram } from '../lib/telegram.js';
import { sweep } from '../lib/matches.js';
import { ensureSchema } from '../lib/schema.js';
import { setSetting } from '../lib/settings.js';
import { runOpenRouter } from '../lib/openrouter.js';
import { models } from './api/models.js';

const ROUTES = {
  'GET /api/state': state,
  'GET /api/models': models,
  'GET /api/leaderboard': board,
  'GET /api/launches': launches,
  'GET /api/profile': profile,
  'GET /api/candles': candles,
  'GET /api/coin': coin,
  'GET /api/crew': crew,
  'GET /api/proof': proof,
  'GET /api/proof/burns.csv': proofCsv,
  'POST /api/x/start': xStart,
  'GET /api/x/callback': xCallback,
  'POST /api/x/unlink': xUnlink,
  'GET /api/token': token,
  'POST /api/trade/prepare': tradePrepare,
  'POST /api/trade/send': tradeSend,
  'GET /api/trade/status': tradeStatus,
  'POST /api/launch/prepare': prepare,
  'POST /api/launch/submit': submit,
  'POST /api/launch/fee': feeTx,
  'POST /api/launch/fee/submit': feeSubmit,
  'GET /api/launch/status': status,
  'POST /api/spark': spark,
  'POST /api/spark/image': sparkLogo,
  'POST /api/ask': ask,
  'POST /api/telegram': telegramHook,
  'GET /api/admin/status': adminStatus,
  'POST /api/admin/pause': adminPause,
  'POST /api/admin/run': adminRun,
  'POST /api/admin/selftest': adminSelfTest,
  'GET /api/admin/social': adminSocial,
  'POST /api/admin/post': adminPost,
  'POST /api/admin/reset-posts': adminResetPosts,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[`${request.method} ${pathname}`];
    if (handler) {
      try {
        return await handler({ request, env: await withLaunch(env) });
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
    await setSetting(env.DB, 'cron.heartbeat', now);   // la page d'admin voit que le cron tourne
    // En premier : le lancement officiel de $WICK (détecté sur le dev wallet), le plus vite
    // possible. Le site passe en live tout seul, l'annonce part dans le canal (une seule fois).
    try {
      const mint = await runAnnounce(env, now);
      if (mint) console.log('launch announced', mint);
    } catch (err) {
      console.error('announce', err?.message ?? err);
    }
    env = await withLaunch(env);
    await sweep(env, now);
    const open = await tickCycle(env, now);
    const step = await recordRun(env, () => runBuyback(env, Date.now()));
    if (step) console.log('buyback', step);
    const steps = [
      checkMilestones(env, Date.now()),
      refreshMarkets(env, Date.now(), open?.id),
      runShares(env, Date.now()),
      runKeepers(env, Date.now(), queueSelfBurn),
      // Les voix des Keepers, puis la page de journal du jour (une à la fois).
      runVoices(env, Date.now()).then(() => runJournal(env, Date.now())).then(() => runKits(env, Date.now())),
      runTelegram(env, Date.now()),
      // Les grands moments de $WICK (DEX payé, paliers de market cap), avec leur carte.
      runSocial(env, Date.now()),
      // Chaque nouveau coin, posté aussi sur le X de WICK (si ses clés sont réglées).
      runCoinX(env, Date.now()),
      // L'Operator de chaque coin poste dans ses groupes Telegram (et les temps forts sur le canal).
      runPublish(env, Date.now()),
      // Le Scout lit ce qui monte sur Solana (toutes les 30 minutes).
      runScout(env, Date.now()),
      // L'Operator de chaque coin poste sur son compte X (si son créateur l'a relié).
      runXPosts(env, Date.now()),
      // Le catalogue d'OpenRouter (toutes les 6 heures) et le prix du SOL (les budgets des agents).
      runOpenRouter(env, Date.now()),
    ];
    for (const r of await Promise.allSettled(steps)) {
      if (r.status === 'rejected') console.error('cron', r.reason?.message ?? r.reason);
    }
  },
};
