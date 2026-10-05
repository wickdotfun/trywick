// La page d'admin (public/admin.html) parle à ces routes, protégées par ADMIN_KEY :
//   GET  /api/admin/status  → tout l'état du buyback
//   POST /api/admin/pause   { paused: true | false } → l'interrupteur d'urgence
//   POST /api/admin/run     → fait avancer le buyback tout de suite
//   GET  /api/admin/social, POST /api/admin/post → les posts et leurs cartes (plus bas)
import { selfTest } from '../../lib/selftest.js';
import { buybackWallet, feeSummary, potSol, runBuyback } from '../../lib/buyback.js';
import { supplyCandle } from '../../lib/candle.js';
import { CONFIG, candlePct, cycleTiming } from '../../lib/config.js';
import { burnTotals, launchTotals, publicCycle, tickCycle } from '../../lib/cycles.js';
import { json } from '../../lib/http.js';
import { pinataStatus } from '../../lib/pump.js';
import { candleTotals } from '../../lib/candles.js';
import { ensureSchema } from '../../lib/schema.js';
import { announceText, deployer } from '../../lib/announce.js';
import { MILESTONES, milestoneFile } from '../../lib/cards.js';
import { LIBRARY, libraryFile, libraryPost, libraryText } from '../../lib/posts.js';
import { cardBytes, coinXText, postText, publish, socialStatus } from '../../lib/social.js';
import { xReady } from '../../lib/x.js';
import { PUMP, PUMP_AMM, shareTotals } from '../../lib/sharing.js';
import { buybackPaused, getSetting, setSetting } from '../../lib/settings.js';
import { WSOL, ataAddress, findPda, fromBase58, getBalance, rpc, tokenHolding } from '../../lib/solana.js';
import { supplyBurned } from '../../lib/supply.js';
import { agentLine, dailyStats, solUsd, telegramReady, tg } from '../../lib/telegram.js';
import { tokenView } from '../../lib/token.js';

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

const RENT_EXEMPT_EMPTY = 890_880;

// Le dev wallet (celui qui lance $WICK) : ses SOL, ses $WICK, et les creator fees de $WICK qui
// l'attendent sur pump.fun (dans le coffre du créateur, et, une fois gradué, sur PumpSwap).
async function devInfo(env, buyback) {
  const address = deployer(env);
  if (!address) return null;
  const info = { address, isBuyback: address === buyback };
  const [sol, holding, vault, ammVault] = await Promise.all([
    getBalance(env, address).then((l) => l / 1e9).catch(() => null),
    env.TOKEN_MINT ? tokenHolding(env, address, env.TOKEN_MINT).catch(() => null) : null,
    findPda(['creator-vault', fromBase58(address)], PUMP).then((v) => getBalance(env, v)).catch(() => null),
    findPda(['creator_vault', fromBase58(address)], PUMP_AMM).then((auth) => ataAddress(auth, WSOL))
      .then((ata) => rpc(env, 'getTokenAccountBalance', [ata, { commitment: 'confirmed' }])).catch(() => null),
  ]);
  info.sol = sol;
  info.wick = holding && holding.decimals != null ? Number(holding.raw) / 10 ** holding.decimals : env.TOKEN_MINT ? 0 : null;
  const curve = vault == null ? null : Math.max(0, vault - RENT_EXEMPT_EMPTY) / 1e9;
  const amm = ammVault?.value ? Number(ammVault.value.amount) / 1e9 : 0;
  info.feesPending = curve == null ? null : curve + amm;
  return info;
}

// Une partie des données peut manquer (RPC lent, DexScreener) : la page s'affiche quand même.
const soft = (p) => Promise.resolve(p).catch(() => null);

export const adminStatus = guarded(async ({ env }) => {
  const db = env.DB;
  const now = Date.now();
  const timing = cycleTiming(env);
  const open = await tickCycle(env, now);
  const [wallet, paused, lastRun, lastError, { results: cycles }, pending, { results: burns }, fees, shares, announced, detected] = await Promise.all([
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
      FROM burns b LEFT JOIN matches m ON m.mint = CASE b.kind WHEN 'match' THEN b.ref
        WHEN 'coin' THEN substr(b.ref, 1, instr(b.ref, ':') - 1) END ORDER BY b.id DESC LIMIT 20`).all(),
    feeSummary(env),
    shareTotals(db),
    getSetting(db, 'launch.announced'),
    getSetting(db, 'launch.detected'),
  ]);
  const [heartbeat, burned, launched, supply, day, market, usd, pot, dev, { results: launches }, pinata] = await Promise.all([
    getSetting(db, 'cron.heartbeat'),
    burnTotals(db),
    launchTotals(db, now),
    soft(supplyBurned(env, now)),
    dailyStats(db, now),
    env.TOKEN_MINT ? soft(tokenView(env, now)) : null,
    soft(solUsd(now)),
    soft(potSol(env, now)),
    soft(devInfo(env, wallet.address)),
    db.prepare(`SELECT m.seq, m.mint, m.symbol, m.name, m.creator, m.created_at, m.lit_at, m.signature, m.fee_lamports, m.fee_state,
        m.fee_sig, m.share_bps, m.share_state, m.tg_state, m.x_state, m.holder, m.mcap, m.keeper_style, m.keeper_model,
        b.status AS burn_status, b.burned_ui AS burned, b.burn_sig
      FROM matches m LEFT JOIN burns b ON b.kind = 'match' AND b.ref = m.mint
      WHERE m.seq IS NOT NULL OR m.signature IS NOT NULL ORDER BY m.created_at DESC LIMIT 15`).all(),
    pinataStatus(env),
  ]);
  return json({
    now,
    paused,
    checks: {
      tokenMint: env.TOKEN_MINT || null,
      buybackKey: wallet.key,
      pinata,
      ai: Boolean(env.AI?.run),
      // L'IA du jour, par usage : décisions et voix des Keepers, Spark, logos, questions, journal.
      aiUse: await getSetting(db, 'ai.day').then((s) => {
        const today = s?.day === Math.floor(now / 86_400_000) ? s : {};
        return Object.fromEntries(Object.entries(CONFIG.keepers.daily).map(([k, max]) => [k, { used: today[k === 'keeper' ? 'count' : k] || 0, max }]));
      }),
      // Les esprits premium réglés (leur clé), et les comptes X des coins (l'app X de WICK).
      premium: CONFIG.keepers.models.filter((m) => m.premium).map((m) => ({ name: m.name, key: m.key, ready: Boolean(env[m.key]) })),
      xApp: Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
      // Le X de WICK : poster tout seul (ses 4 clés), sinon les boutons « Post on X ».
      xPosts: xReady(env),
      lock: await getSetting(db, 'team.lock', null),
      xLinks: (await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(posts), 0) AS posts FROM x_links').first().catch(() => null)) || { n: 0, posts: 0 },
      customRpc: Boolean(env.SOLANA_RPC),
      ipSalt: Boolean(env.IP_SALT),
      collectFees: env.BUYBACK_COLLECT_FEES === 'on',
      cycleMinutes: timing.durationMs / 60_000,
      matchMinutes: timing.matchMs / 60_000,
      launchFeeSol: fees.feeSol,
      sharedFeeSol: fees.sharedFeeSol,
      shareBps: fees.shareBps,
      fees,
      burnWalletExpected: env.BURN_WALLET ?? CONFIG.buyback.wallet ?? null,
      telegram: telegramReady(env),
      deployer: deployer(env),
      announced,
      detected,
      ticker: env.TOKEN_TICKER || 'WICK',
      site: env.SITE_URL || 'https://trywick.fun',
      dailyHour: env.TELEGRAM_DAILY_HOUR ?? '18',
      reserveSol: CONFIG.buyback.reserveSol,
    },
    wallet,
    shares,
    candle: publicCycle(open, env, now),
    cycles,
    burns,
    pendingLaunches: pending.n,
    lastRun,
    lastError,
    // Le tableau de bord du jour J.
    heartbeat,
    totals: { ...burned, ...launched, ...shares, ...(await candleTotals(db)) },
    supply: supply?.original ? { ...supply, candle: supplyCandle(supply.pct, candlePct(env)) } : null,
    day,
    market: market?.market ? { ...market.market, curve: market.curve, holders: market.holders } : null,
    solUsd: usd ?? (market?.market?.priceUsd && market.market.priceSol ? market.market.priceUsd / market.market.priceSol : null),
    potSol: pot,
    dev,
    // Chaque coin, avec son agent et son post X déjà écrit (le bouton « Post on X » de l'admin).
    launches: launches.map((r) => ({ ...r, agent: agentLine(r), xText: coinXText(r, env), x: xReady(env) })),
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
// Tester chaque étape d'un lancement, en production (lib/selftest.js).
export const adminSelfTest = guarded(async ({ env }) => json(await selfTest(env)));

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

// ------------------------------------------------------------ les posts et leurs cartes
//   GET  /api/admin/social → ce qui a été posté, les canaux prêts, les textes à copier pour X
//   POST /api/admin/post   { kind, mcap?, lock?, image?, channels? } → poste une carte maintenant
export const adminSocial = guarded(async ({ env }) => {
  const mint = env.TOKEN_MINT || (await getSetting(env.DB, 'launch.detected'))?.mint || null;
  const site = env.SITE_URL || 'https://trywick.fun';
  const ticker = env.TOKEN_TICKER || 'WICK';
  const status = await socialStatus(env);
  return json({
    ...status, mint, ticker, supply: CONFIG.pumpSupply,
    // La bibliothèque de posts : la carte, le texte prêt (avec le CA une fois $WICK lancé).
    library: LIBRARY.map((p) => ({ id: p.id, slot: p.slot, phase: p.phase, label: p.label, when: p.when, file: libraryFile(p.id), text: libraryText(p, { ticker, site, mint }) })),
    texts: {
      // Avant le lancement, [CA] tient la place de l'adresse (l'admin la remplace dès qu'elle existe).
      live: announceText(mint || '[CA]', { ticker, site }).replace(/<\/?code>/g, ''),
      dexpaid: postText('dexpaid', { mint }, env).x,
      mcap: Object.fromEntries(status.milestones.map((m) => [m.value, postText('mcap', { mint, mcap: m.value }, env).x])),
    },
  });
});

const B64 = /^[A-Za-z0-9+/]+=*$/;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const adminPost = guarded(async ({ request, env }) => {
  const body = await request.json().catch(() => null);
  const kind = body?.kind;
  const mint = env.TOKEN_MINT || (await getSetting(env.DB, 'launch.detected'))?.mint || null;
  const ticker = env.TOKEN_TICKER || 'WICK';
  const site = env.SITE_URL || 'https://trywick.fun';
  // Seulement les canaux demandés (Telegram, X, ou les deux).
  const channels = Array.isArray(body?.channels) ? body.channels : ['telegram', 'x'];
  const e = { ...env };
  if (!channels.includes('telegram')) delete e.TELEGRAM_BOT_TOKEN;
  if (!channels.includes('x')) delete e.X_API_KEY;
  let post;
  if (kind === 'live') {
    if (!mint) return json({ error: 'not_live' }, 409);
    const text = announceText(mint, { ticker, site });
    post = { image: await cardBytes(env, 'live.png'), caption: text, x: text.replace(/<\/?code>/g, ''), mint };
  } else if (kind === 'dexpaid') {
    post = { image: await cardBytes(env, 'dex-paid.png'), mint, ...postText('dexpaid', { mint }, env) };
  } else if (kind === 'mcap') {
    const n = Number(body.mcap);
    if (!MILESTONES.includes(n)) return json({ error: 'bad_milestone' }, 400);
    post = { image: await cardBytes(env, milestoneFile(n)), mint, ...postText('mcap', { mint, mcap: n }, env) };
  } else if (kind === 'library') {
    // Un post de la bibliothèque, avec son texte (modifiable dans l'admin) : le même sur X et Telegram.
    const p = libraryPost(body.id);
    if (!p) return json({ error: 'bad_post' }, 400);
    const text = libraryText(p, { ticker, site, mint });
    post = { image: await cardBytes(env, libraryFile(p.id)), caption: esc(text), x: text, mint };
  } else if (kind === 'relay') {
    // Un post X publié à la main : relayé dans le canal Telegram (son lien, avec l'aperçu de X).
    const url = String(body.url || '').trim().replace('twitter.com/', 'x.com/').split('?')[0];
    if (!/^https:\/\/(www\.)?x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(url)) return json({ error: 'bad_url' }, 400);
    if (!telegramReady(env)) return json({ error: 'no_telegram' }, 409);
    const note = String(body.note || '').trim().slice(0, 600);
    try {
      const msg = await tg(env, 'sendMessage', {
        text: `${note ? `${esc(note)}\n\n` : ''}𝕏 <a href="${esc(url)}">New post on X</a>`,
        link_preview_options: { url, prefer_large_media: true },
        reply_markup: { inline_keyboard: [[{ text: 'Like & repost on X', url }]] },
      });
      await setSetting(env.DB, `social.relay.manual.${Date.now()}`, { status: 'posted', at: Date.now(), telegram: msg.message_id, url });
      return json({ telegram: msg.message_id });
    } catch (err) {
      return json({ telegramError: err.message });
    }
  } else if (kind === 'lock') {
    const l = body.lock || {};
    const amount = Number(l.amount);
    if (!(amount > 0)) return json({ error: 'bad_amount' }, 400);
    if (l.link && !/^https:\/\/\S+$/.test(l.link)) return json({ error: 'bad_link' }, 400);
    if (typeof body.image !== 'string' || body.image.length > 4_000_000 || !B64.test(body.image)) return json({ error: 'bad_image' }, 400);
    const image = Uint8Array.from(atob(body.image), (c) => c.charCodeAt(0));
    const data = { amount, pct: (amount / CONFIG.pumpSupply) * 100, until: String(l.until || '').slice(0, 40), where: String(l.where || 'Streamflow').slice(0, 40), link: l.link || null };
    post = { image, mint, ...postText('lock', data, env) };
    // La page Proof montre le lock aussitôt (avec son lien de preuve).
    if (data.link) {
      const until = Date.parse(data.until);
      await setSetting(env.DB, 'team.lock', { url: data.link, amount, until: Number.isFinite(until) ? until : null, where: data.where });
    }
  } else {
    return json({ error: 'bad_kind' }, 400);
  }
  // Le texte écrit dans l'admin, s'il y en a un : le même sur X et sur Telegram (le CA en <code>).
  if (typeof body.text === 'string' && body.text.trim()) {
    const text = body.text.trim().slice(0, 1000);
    if (text.includes('[CA]')) return json({ error: 'not_live' }, 409);
    post.x = text;
    post.caption = esc(text);
  }
  if (mint && !post.caption.includes('<code>')) post.caption = post.caption.replace(mint, `<code>${mint}</code>`);
  const tag = `${kind}${kind === 'mcap' ? `.${body.mcap}` : kind === 'library' ? `.${body.id}` : ''}`;
  const out = await publish(e, `${tag}.manual.${Date.now()}`, post, { once: false });
  await setSetting(env.DB, `social.${tag}.manual.${Date.now()}`, { status: out.telegram || out.x ? 'posted' : 'failed', at: Date.now(), ...out });
  return json({ ...out, xText: post.x });
});
