// La page d'admin (public/admin.html) parle à ces routes, protégées par ADMIN_KEY :
//   GET  /api/admin/status  → tout l'état du buyback
//   POST /api/admin/pause   { paused: true | false } → l'interrupteur d'urgence
//   POST /api/admin/run     → fait avancer le buyback tout de suite
import { buybackWallet, runBuyback } from '../../lib/buyback.js';
import { CONFIG, cycleTiming } from '../../lib/config.js';
import { publicCycle, tickCycle } from '../../lib/cycles.js';
import { json } from '../../lib/http.js';
import { ensureSchema } from '../../lib/schema.js';
import { buybackPaused, getSetting, setSetting } from '../../lib/settings.js';
import { getBalance, tokenHolding } from '../../lib/solana.js';

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// La clé est comparée par empreinte, en temps constant. Sans ADMIN_KEY (ou trop courte),
// l'admin est fermée.
export async function checkAdmin(request, env) {
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 16) return json({ error: 'admin_disabled' }, 404);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [a, b] = await Promise.all([digest(given), digest(env.ADMIN_KEY)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? null : json({ error: 'unauthorized' }, 401);
}

function guarded(handler) {
  return async (ctx) => {
    await ensureSchema(ctx.env.DB);
    return (await checkAdmin(ctx.request, ctx.env)) || handler(ctx);
  };
}

async function walletInfo(env) {
  let wallet = null;
  try {
    wallet = await buybackWallet(env);
  } catch (err) {
    return { key: 'invalid', error: err.message };
  }
  if (!wallet) return { key: 'missing' };
  const info = { key: 'ok', address: wallet.publicKey };
  try {
    info.sol = (await getBalance(env, wallet.publicKey)) / 1e9;
    info.pot = Math.max(0, info.sol - CONFIG.buyback.reserveSol);
  } catch (err) {
    info.rpcError = err.message;
  }
  if (env.TOKEN_MINT && !info.rpcError) {
    try {
      const h = await tokenHolding(env, wallet.publicKey, env.TOKEN_MINT);
      info.token = h.decimals == null ? 0 : Number(h.raw) / 10 ** h.decimals;
    } catch (err) {
      info.rpcError = err.message;
    }
  }
  return info;
}

export const adminStatus = guarded(async ({ env }) => {
  const db = env.DB;
  const now = Date.now();
  const timing = cycleTiming(env);
  const open = await tickCycle(env, now);
  const [wallet, paused, lastRun, lastError, { results: cycles }, pending] = await Promise.all([
    walletInfo(env),
    buybackPaused(db),
    getSetting(db, 'cron.lastRun'),
    getSetting(db, 'cron.lastError'),
    db.prepare(`SELECT id, started_at, ended_at, matches, status, note, step_at, buy_sol, buy_sig, burn_sig,
      burn_tries, burned_ui FROM cycles ORDER BY id DESC LIMIT 20`).all(),
    db.prepare('SELECT COUNT(*) AS n FROM matches WHERE seq IS NULL AND signature IS NOT NULL').first(),
  ]);
  return json({
    now,
    paused,
    checks: {
      tokenMint: env.TOKEN_MINT || null,
      buybackKey: wallet.key,
      customRpc: Boolean(env.SOLANA_RPC),
      ipSalt: Boolean(env.IP_SALT),
      collectFees: env.BUYBACK_COLLECT_FEES !== 'off',
      cycleMinutes: timing.durationMs / 60_000,
      matchMinutes: timing.matchMs / 60_000,
    },
    wallet,
    candle: publicCycle(open, env, now),
    cycles,
    pendingLaunches: pending.n,
    lastRun,
    lastError,
  });
});

export const adminPause = guarded(async ({ request, env }) => {
  const body = await request.json().catch(() => null);
  if (typeof body?.paused !== 'boolean') return json({ error: 'bad_request' }, 400);
  await setSetting(env.DB, 'buyback.paused', body.paused);
  return json({ paused: body.paused });
});

export const adminRun = guarded(async ({ env }) => {
  const now = Date.now();
  await tickCycle(env, now);
  const step = await recordRun(env, () => runBuyback(env, now));
  return json({ step });
});

// Lance le buyback et garde une trace du résultat (ou de l'erreur) pour la page d'admin.
export async function recordRun(env, run) {
  try {
    const step = await run();
    if (step) await setSetting(env.DB, 'cron.lastRun', { at: Date.now(), step });
    return step;
  } catch (err) {
    await setSetting(env.DB, 'cron.lastError', { at: Date.now(), message: String(err?.message ?? err).slice(0, 300) });
    return `error: ${err?.message ?? err}`;
  }
}
