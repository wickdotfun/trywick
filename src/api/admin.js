// La page d'admin (public/admin.html) parle à ces routes, protégées par ADMIN_KEY :
//   GET  /api/admin/status  → tout l'état du buyback
//   POST /api/admin/pause   { paused: true | false } → l'interrupteur d'urgence
//   POST /api/admin/run     → fait avancer le buyback tout de suite
import { buybackWallet, launchFee, runBuyback } from '../../lib/buyback.js';
import { CONFIG, cycleTiming } from '../../lib/config.js';
import { publicCycle, tickCycle } from '../../lib/cycles.js';
import { json } from '../../lib/http.js';
import { ensureSchema } from '../../lib/schema.js';
import { deployer } from '../../lib/announce.js';
import { shareTotals } from '../../lib/sharing.js';
import { buybackPaused, getSetting, setSetting } from '../../lib/settings.js';
import { getBalance, tokenHolding } from '../../lib/solana.js';
import { telegramReady } from '../../lib/telegram.js';

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
  const [wallet, paused, lastRun, lastError, { results: cycles }, pending, { results: burns }, fee, sharedFee, shares, announced] = await Promise.all([
    walletInfo(env),
    buybackPaused(db),
    getSetting(db, 'cron.lastRun'),
    getSetting(db, 'cron.lastError'),
    db.prepare(`SELECT c.id, c.started_at, c.ended_at, c.matches,
      CASE WHEN c.ended_at IS NULL THEN 'burning' ELSE COALESCE(b.status, c.status) END AS status,
      COALESCE(b.note, c.note) AS note, COALESCE(b.sol, c.buy_sol) AS buy_sol, b.buy_sig, b.burn_sig,
      COALESCE(b.burned_ui, c.burned_ui) AS burned_ui
      FROM cycles c LEFT JOIN burns b ON b.kind = 'candle' AND b.ref = CAST(c.id AS TEXT)
      ORDER BY c.id DESC LIMIT 20`).all(),
    db.prepare('SELECT COUNT(*) AS n FROM matches WHERE seq IS NULL AND signature IS NOT NULL').first(),
    db.prepare(`SELECT b.id, b.kind, b.ref, b.created_at, b.status, b.note, b.sol, b.buy_sig, b.burn_sig, b.burned_ui, m.symbol
      FROM burns b LEFT JOIN matches m ON b.kind = 'match' AND m.mint = b.ref ORDER BY b.id DESC LIMIT 20`).all(),
    launchFee(env),
    launchFee(env, { shared: true }),
    shareTotals(db),
    getSetting(db, 'launch.announced'),
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
      launchFeeSol: fee ? fee.lamports / 1e9 : 0,
      sharedFeeSol: sharedFee ? sharedFee.lamports / 1e9 : null,
      shareBps: sharedFee?.bps ?? 0,
      telegram: telegramReady(env),
      deployer: deployer(env),
      announced,
    },
    wallet,
    shares,
    candle: publicCycle(open, env, now),
    cycles,
    burns,
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
