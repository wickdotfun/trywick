// GET /api/state?since=… : la bougie, ses allumettes (les nouvelles seulement si since est donné).
import { CONFIG } from '../../lib/config.js';
import { feeSummary } from '../../lib/buyback.js';
import { keeperChoices } from '../../lib/keepers.js';
import { orReady } from '../../lib/openrouter.js';
import { json, tokenInfo } from '../../lib/http.js';
import { worldState } from '../../lib/matches.js';
import { ensureSchema } from '../../lib/schema.js';
import { getSetting } from '../../lib/settings.js';

export async function state({ request, env }) {
  await ensureSchema(env.DB);
  const params = new URL(request.url).searchParams;
  const since = Number(params.get('since')) || 0;
  const world = await worldState(env, Date.now(), since, params.has('markets'));
  const fees = await feeSummary(env);
  return json({
    ...world,
    // Le CA : celui des réglages, sinon celui que le site a vu au lancement (sur le dev wallet).
    token: { ...tokenInfo(env), mint: env.TOKEN_MINT || (await getSetting(env.DB, 'launch.detected'))?.mint || null },
    // L'Ignition Fee (50 % burn, 50 % équipe), et celle réduite avec le partage des creator fees
    // (split : créateur / burn / équipe).
    launch: {
      maxDevBuy: CONFIG.maxDevBuySol, ...fees, keepers: keeperChoices(env),
      // N'importe quel modèle sur OpenRouter (GET /api/models), et le fuel au lancement.
      openrouter: orReady(env) ? { fuelOptions: CONFIG.openrouter.fuelOptions } : null,
    },
  });
}
