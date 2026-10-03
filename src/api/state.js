// GET /api/state?since=… : la bougie, ses allumettes (les nouvelles seulement si since est donné).
import { CONFIG } from '../../lib/config.js';
import { launchFee } from '../../lib/buyback.js';
import { json, tokenInfo } from '../../lib/http.js';
import { worldState } from '../../lib/matches.js';
import { ensureSchema } from '../../lib/schema.js';

export async function state({ request, env }) {
  await ensureSchema(env.DB);
  const params = new URL(request.url).searchParams;
  const since = Number(params.get('since')) || 0;
  const world = await worldState(env, Date.now(), since, params.has('markets'));
  const [fee, shared] = await Promise.all([launchFee(env), launchFee(env, { shared: true })]);
  return json({
    ...world,
    token: tokenInfo(env),
    // L'Ignition Fee, et celle réduite avec le partage des creator fees (shareBps : la part de WICK).
    launch: {
      maxDevBuy: CONFIG.maxDevBuySol,
      feeSol: fee ? fee.lamports / 1e9 : 0,
      sharedFeeSol: shared ? shared.lamports / 1e9 : null,
      shareBps: shared?.bps ?? 0,
    },
  });
}
