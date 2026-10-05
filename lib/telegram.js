// Le bot Telegram : il poste dans le canal (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID), dans le style
// des bots de lancement et de burn des projets Solana :
// - chaque nouveau coin lancé sur WICK, avec sa photo, son adresse, son créateur, ses liens ;
//   le post est mis à jour quand son Ignition Fee a été brûlée en $WICK (avec la transaction) ;
// - chaque buyback + burn (la fin d'un souffle), avec les SOL dépensés, le $WICK brûlé, la supply ;
// - chaque bougie entièrement fondue (un palier de la supply brûlé pour de bon) : la « saison » ;
// - un rapport quotidien (TELEGRAM_DAILY_HOUR, en heure UTC, 18 par défaut, « off » pour l'arrêter).
// Tout passe par le cron, avec un état en base : un post raté est retenté à la minute suivante,
// et jamais posté deux fois.
import { cycleProgress, supplyCandle } from './candle.js';
import { candlePct, cycleTiming } from './config.js';
import { getOpenCycle } from './cycles.js';
import { getSetting, setSetting } from './settings.js';
import { supplyBurned } from './supply.js';

const SITE = 'https://trywick.fun';
const DAY = 24 * 3600_000;
const WSOL = 'So11111111111111111111111111111111111111112';

export function telegramReady(env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

export async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, parse_mode: 'HTML', ...body }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`telegram_${method}: ${data?.description || res.status}`);
  return data.result;
}

// ------------------------------------------------------------ mise en forme
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function compact(n) {
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, u] of units) if (n >= v) return `${(n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, '')}${u}`;
  return String(Math.round(n));
}
const full = (n) => Math.round(n).toLocaleString('en-US');
const sol = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })} SOL`;
const usd = (n) => (n >= 1000 ? `$${compact(n)}` : `$${Number(n).toFixed(n < 10 ? 2 : 0)}`);
const short = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
const pct = (n) => `${Number(n).toFixed(n < 10 ? 2 : 1)}%`;
const pad = (n) => String(n).padStart(3, '0');
const link = (url, text) => `<a href="${esc(url)}">${text}</a>`;
const solscanTx = (sig) => `https://solscan.io/tx/${sig}`;
const solscanAccount = (a) => `https://solscan.io/account/${a}`;

// Une liste en arbre (├ … └), comme les bots de burn.
function tree(items) {
  const rows = items.filter(Boolean);
  return rows.map((r, i) => `${i === rows.length - 1 ? '└' : '├'} ${r}`).join('\n');
}

// La barre de flammes d'un buyback : une flamme par 0,05 SOL, de 1 à 20.
export function flames(solAmount) {
  return '🔥'.repeat(Math.max(1, Math.min(20, Math.round(solAmount / 0.05))));
}

function buttons(rows) {
  return { inline_keyboard: rows.map((row) => row.map(([text, url]) => ({ text, url }))) };
}

// ------------------------------------------------------------ le contexte (bougie, souffle, prix)
let solPrice = null;
export async function solUsd(now) {
  if (solPrice && now - solPrice.at < 10 * 60_000) return solPrice.usd;
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${WSOL}`);
    const pairs = res.ok ? await res.json() : [];
    // Le prix du SOL : sa paire la plus liquide contre un dollar stable.
    const p = (Array.isArray(pairs) ? pairs : [])
      .filter((x) => x?.baseToken?.address === WSOL && /USD/.test(x?.quoteToken?.symbol || ''))
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const value = p ? Number(p.priceUsd) : null;
    if (value > 0) solPrice = { at: now, usd: value };
  } catch { /* sans prix, pas de dollars */ }
  return solPrice?.usd ?? null;
}

// Ce que les posts rappellent : la bougie (la part de la supply brûlée), le prochain buyback.
export async function context(env, now) {
  const ctx = { ticker: env.TOKEN_TICKER || 'WICK', site: env.SITE_URL || SITE, candle: null, supply: null, nextMin: null, solUsd: null };
  try {
    const s = await supplyBurned(env, now);
    if (s.original) {
      ctx.supply = s;
      ctx.candle = supplyCandle(s.pct, candlePct(env));
    }
  } catch { /* RPC indisponible : on s'en passe */ }
  try {
    const open = await getOpenCycle(env.DB);
    if (open) {
      const p = cycleProgress({ startedAt: open.started_at, matches: open.matches }, now, cycleTiming(env));
      ctx.nextMin = Math.max(1, Math.ceil(p.remainingMs / 60_000));
    }
  } catch { /* pas de souffle */ }
  ctx.solUsd = await solUsd(now);
  return ctx;
}

const candleLine = (ctx) => (ctx.candle
  ? `🕯️ Candle #${pad(ctx.candle.number)} · <b>${Math.floor(ctx.candle.melted * 100)}% melted</b>${ctx.nextMin ? ` · next buyback in ${ctx.nextMin}m` : ''}`
  : ctx.nextMin ? `🕯️ Next buyback in ${ctx.nextMin}m` : `🕯️ Every coin melts the $${esc(ctx.ticker || 'WICK')} candle`);
const withUsd = (s, ctx) => (ctx.solUsd ? `${sol(s)} (${usd(s * ctx.solUsd)})` : sol(s));

// ------------------------------------------------------------ 1. un nouveau coin
const SHARING = ['held', 'sending', 'sent', 'shared'];

// Le texte du post d'un coin (le même au départ et après le burn de son Ignition Fee).
export function matchCaption(m, ctx = {}) {
  const ticker = esc(ctx.ticker || 'WICK');
  const feeSol = (m.fee_lamports || 0) / 1e9;
  const burnSol = feeSol - (m.team_lamports || 0) / 1e9;
  // L'Ignition Fee, et sa part qui brûle $WICK (l'autre moitié va à l'équipe).
  const paid = `🔥 Ignition Fee: ${sol(feeSol)}${burnSol < feeSol ? ` (${sol(burnSol)} to the burn)` : ''}`;
  let fee = null;
  if (m.burned > 0) {
    fee = `${paid} → <b>${compact(m.burned)} $${ticker} burned</b> ✅${m.burn_sig ? ` ${link(solscanTx(m.burn_sig), 'TX')}` : ''}`;
  } else if (m.fee_lamports > 0 && m.fee_state !== 'failed') {
    fee = `${paid} → <i>buying $${ticker} to burn…</i>`;
  }
  const socials = [
    m.twitter && link(m.twitter, '𝕏 Twitter'),
    m.telegram && link(m.telegram, '💬 Telegram'),
    m.website && link(m.website, '🌐 Website'),
  ].filter(Boolean);
  return [
    `🔥 <b>NEW MATCH STRUCK</b>${m.seq ? ` · #${m.seq}` : ''}`,
    '',
    `<b>${esc(m.name)}</b> · <b>$${esc(m.symbol)}</b>`,
    `<code>${esc(m.mint)}</code>`,
    '',
    tree([
      `👤 Creator: ${m.creator ? link(solscanAccount(m.creator), short(m.creator)) : '—'}${m.holder ? ` · 👑 $${ticker} holder` : ''}`,
      m.dev_buy > 0 ? `💰 Dev buy: ${sol(m.dev_buy)}` : null,
      fee,
      m.share_bps > 0 && SHARING.includes(m.share_state)
        ? `🤝 Fee share: <b>${(m.share_bps - (m.self_bps || 0)) / 100}%</b> of its creator fees go to WICK, forever${m.share_team_bps > 0
          ? ` (${(m.share_bps - m.share_team_bps - (m.self_bps || 0)) / 100}% burn $${ticker}, ${m.share_crew_bps > 0 ? `${m.share_crew_bps / 100}% its crew, ` : ''}${(m.share_team_bps - (m.share_crew_bps || 0)) / 100}% team)` : ''}` : null,
      m.self_bps > 0 && SHARING.includes(m.share_state)
        ? `🕯️ Burns itself: <b>${m.self_bps / 100}%</b> of its creator fees buy $${esc(m.symbol)} back and burn it, forever` : null,
    ]),
    '',
    candleLine(ctx),
    ...(socials.length ? ['', socials.join(' · ')] : []),
  ].join('\n');
}

function matchButtons(m, ctx) {
  return buttons([
    [['💊 Buy', `https://pump.fun/coin/${m.mint}`], ['📊 Chart', `https://dexscreener.com/solana/${m.mint}`]],
    [['🕯️ Watch it burn', ctx.site || SITE]],
  ]);
}

async function postMatch(env, m, ctx) {
  const caption = matchCaption(m, ctx);
  const reply_markup = matchButtons(m, ctx);
  if (m.image && /^https:/.test(m.image)) {
    try {
      const r = await tg(env, 'sendPhoto', { photo: m.image, caption, reply_markup });
      return { id: r.message_id, kind: 'photo' };
    } catch (err) {
      console.log('telegram photo', m.mint, err.message);   // image injoignable : le texte seul
    }
  }
  const r = await tg(env, 'sendMessage', { text: caption, reply_markup, link_preview_options: { is_disabled: true } });
  return { id: r.message_id, kind: 'text' };
}

// ------------------------------------------------------------ 2. un buyback + burn
export function buybackText(b, ctx, totalBurned) {
  const ticker = esc(ctx.ticker || 'WICK');
  const s = ctx.supply;
  const txs = [b.buy_sig && link(solscanTx(b.buy_sig), 'Buy TX'), b.burn_sig && link(solscanTx(b.burn_sig), 'Burn TX')].filter(Boolean);
  return [
    flames(b.sol || 0),
    `<b>$${ticker} BUYBACK &amp; BURN</b> · #${esc(b.ref)}`,
    '',
    tree([
      `💸 Spent: <b>${withUsd(b.sol || 0, ctx)}</b>`,
      `🔥 Burned: <b>${full(b.burned_ui)} $${ticker}</b>`,
      s ? `🪙 Supply left: ${compact(s.original - s.burned)} $${ticker}` : null,
      txs.length ? `🧾 ${txs.join(' · ')}` : null,
    ]),
    '',
    `📊 <b>Total burned:</b> ${compact(totalBurned)} $${ticker}${s ? ` · <b>${pct(s.pct)}</b> of supply` : ''}`,
    candleLine(ctx),
    '',
    `<i>Fed by the Ignition Fees and the creator fees shared by WICK coins.</i>`,
  ].join('\n');
}

// ------------------------------------------------------------ 3. une bougie fondue (une saison)
export function hallText(h, ctx) {
  const ticker = esc(ctx.ticker || 'WICK');
  return [
    `🕯️🔥 <b>CANDLE #${pad(h.number)} — FULLY MELTED</b>`,
    '',
    `<b>${pct(h.pct / h.number)} of the $${ticker} supply</b> just went up in smoke, forever.`,
    `Total burned since day one: <b>${pct(h.pct)}</b> of the supply.`,
    '',
    `📊 <b>Season #${h.number}</b>`,
    tree([
      `🔥 Burned: <b>${compact(h.burned)} $${ticker}</b>`,
      h.sol != null ? `💸 SOL spent: ${sol(h.sol)}` : null,
      `🚀 Coins launched: ${full(h.launches)}`,
      h.burns != null ? `🧾 Burns: ${full(h.burns)}${h.last_sig ? ` · ${link(solscanTx(h.last_sig), 'last TX')}` : ''}` : null,
      h.top_symbol ? `🏆 Hottest coin: <b>$${esc(h.top_symbol)}</b>${h.top_mcap ? ` (${usd(h.top_mcap)} mcap)` : ''}` : null,
    ]),
    '',
    `Candle #${pad(h.number + 1)} is lit. Every coin melts it. 🕯️`,
  ].join('\n');
}

// ------------------------------------------------------------ 4. le rapport quotidien
export function dailyText(d, ctx) {
  const ticker = esc(ctx.ticker || 'WICK');
  const date = new Date(d.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const medals = ['🥇', '🥈', '🥉'];
  return [
    `📊 <b>WICK DAILY REPORT</b> · ${date}`,
    '',
    tree([
      `🚀 Coins launched: <b>${full(d.launches)}</b>`,
      `🔥 $${ticker} burned: <b>${compact(d.burned)}</b>${ctx.supply?.original ? ` (${pct((d.burned / ctx.supply.original) * 100)} of supply)` : ''}`,
      `💸 SOL used for burns: ${sol(d.sol)}`,
      d.shared > 0 ? `🤝 Shared creator fees received: ${sol(d.shared)}` : null,
      `🧾 Burns: ${full(d.burns)}`,
    ]),
    ...(d.top.length ? ['', '🏆 <b>Hottest WICK coins</b>', ...d.top.map((c, i) => `${medals[i]} $${esc(c.symbol)} · ${usd(c.mcap)} mcap`)] : []),
    ...(d.pyro ? ['', `🔥 <b>Pyromaniac of the day:</b> ${link(solscanAccount(d.pyro.creator), short(d.pyro.creator))} · ${d.pyro.launches} launch${d.pyro.launches === 1 ? '' : 'es'}`] : []),
    '',
    ctx.supply
      ? `🕯️ Candle #${pad(ctx.candle.number)} · ${Math.floor(ctx.candle.melted * 100)}% melted · <b>${pct(ctx.supply.pct)}</b> of $${ticker} burned forever`
      : candleLine(ctx),
  ].join('\n');
}

export async function dailyStats(db, now) {
  const since = now - DAY;
  const [l, b, s, { results: top }, pyro] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM matches WHERE seq IS NOT NULL AND lit_at > ?').bind(since).first(),
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(burned_ui), 0) AS burned, COALESCE(SUM(sol), 0) AS sol FROM burns WHERE kind != 'coin' AND status = 'burned' AND burned_at > ?").bind(since).first(),
    db.prepare("SELECT COALESCE(SUM(wick_lamports - COALESCE(self_lamports, 0)), 0) AS l FROM shares WHERE status = 'ok' AND at > ?").bind(since).first(),
    db.prepare('SELECT symbol, mcap FROM matches WHERE seq IS NOT NULL AND lit_at > ? AND mcap > 0 ORDER BY mcap DESC LIMIT 3').bind(since).all(),
    db.prepare('SELECT creator, COUNT(*) AS launches FROM matches WHERE seq IS NOT NULL AND lit_at > ? GROUP BY creator ORDER BY launches DESC LIMIT 1').bind(since).first(),
  ]);
  return { at: now, launches: l.n, burns: b.n, burned: b.burned, sol: b.sol, shared: s.l / 1e9, top, pyro: pyro ?? null };
}

// ------------------------------------------------------------ une passe du cron
// Renvoie le nombre de messages envoyés ou modifiés.
export async function runTelegram(env, now) {
  if (!telegramReady(env)) return 0;
  const db = env.DB;
  const ctx = await context(env, now);
  const noPreview = { link_preview_options: { is_disabled: true } };
  let done = 0;

  // 1. Les nouveaux coins (des 3 dernières heures, pour ne jamais inonder le canal).
  const { results: fresh } = await db.prepare(
    `SELECT m.*, (SELECT burned_ui FROM burns WHERE kind = 'match' AND ref = m.mint AND status = 'burned') AS burned
     FROM matches m WHERE m.seq IS NOT NULL AND m.tg_state IS NULL AND m.lit_at > ? ORDER BY m.seq LIMIT 5`,
  ).bind(now - 3 * 3600_000).all();
  for (const m of fresh) {
    const claimed = await db.prepare("UPDATE matches SET tg_state = 'posting' WHERE mint = ? AND tg_state IS NULL").bind(m.mint).run();
    if (claimed.meta?.changes !== 1) continue;
    try {
      const post = await postMatch(env, m, ctx);
      await db.prepare('UPDATE matches SET tg_state = ?, tg_msg_id = ? WHERE mint = ?').bind(post.kind, post.id, m.mint).run();
      done++;
    } catch (err) {
      console.error('telegram post', m.mint, err.message);
      await db.prepare('UPDATE matches SET tg_state = NULL WHERE mint = ?').bind(m.mint).run();
      return done;   // Telegram ne répond pas : on retentera à la prochaine minute
    }
  }

  // 2. Les Ignition Fees brûlées : on met à jour le post du coin (avec la transaction du burn).
  const { results: matchBurns } = await db.prepare(
    `SELECT b.id AS burn_id, b.status AS burn_status, b.burned_ui AS burned, b.burn_sig, m.*
     FROM burns b JOIN matches m ON m.mint = b.ref
     WHERE b.kind = 'match' AND b.tg_done = 0 AND b.status IN ('burned', 'skipped', 'failed') LIMIT 5`,
  ).all();
  for (const r of matchBurns) {
    if (r.burn_status === 'burned' && r.burned > 0 && (r.tg_state === 'photo' || r.tg_state === 'text')) {
      const body = { message_id: r.tg_msg_id, reply_markup: matchButtons(r, ctx) };
      const caption = matchCaption(r, ctx);
      try {
        if (r.tg_state === 'photo') await tg(env, 'editMessageCaption', { ...body, caption });
        else await tg(env, 'editMessageText', { ...body, text: caption, ...noPreview });
        done++;
      } catch (err) {
        console.log('telegram edit', r.mint, err.message);
      }
    } else if (r.tg_state === null && r.lit_at > now - 3 * 3600_000) {
      continue;   // le post du coin n'est pas encore parti : on attend
    }
    await db.prepare('UPDATE burns SET tg_done = 1 WHERE id = ?').bind(r.burn_id).run();
  }

  // 3. Les bougies fondues : le post le plus important.
  const { results: hall } = await db.prepare('SELECT * FROM hall WHERE tg_done = 0 ORDER BY number LIMIT 2').all();
  for (const h of hall) {
    if (h.completed_at > now - DAY) {
      try {
        await tg(env, 'sendMessage', {
          text: hallText(h, ctx),
          reply_markup: buttons([[['🏛 Hall of Flames', `${ctx.site}/#hall`], ['🚀 Launch a coin', `${ctx.site}/#strike`]]]),
          ...noPreview,
        });
        done++;
      } catch (err) {
        console.error('telegram hall', h.number, err.message);
        return done;
      }
    }
    await db.prepare('UPDATE hall SET tg_done = 1 WHERE number = ?').bind(h.number).run();
  }

  // 4. Les buybacks (la fin de chaque souffle).
  const { results: candles } = await db.prepare(
    "SELECT * FROM burns WHERE kind = 'candle' AND tg_done = 0 AND status IN ('burned', 'skipped', 'failed') LIMIT 3",
  ).all();
  for (const b of candles) {
    if (b.status === 'burned' && b.burned_ui > 0 && b.burned_at > now - 6 * 3600_000) {
      const total = await db.prepare("SELECT COALESCE(SUM(burned_ui), 0) AS t FROM burns WHERE kind != 'coin' AND status = 'burned'").first();
      try {
        await tg(env, 'sendMessage', {
          text: buybackText(b, ctx, total.t),
          reply_markup: buttons([[['📊 Burn tracker', `${ctx.site}/#dashboard`], [`💊 Buy $${ctx.ticker}`, `${ctx.site}/#wick`]]]),
          ...noPreview,
        });
        done++;
      } catch (err) {
        console.error('telegram buyback', b.ref, err.message);
        return done;
      }
    }
    await db.prepare('UPDATE burns SET tg_done = 1 WHERE id = ?').bind(b.id).run();
  }

  // 5. Le rapport quotidien, une fois par jour à l'heure choisie (UTC).
  const hour = env.TELEGRAM_DAILY_HOUR === 'off' ? null : Number(env.TELEGRAM_DAILY_HOUR ?? 18);
  const today = new Date(now).toISOString().slice(0, 10);
  if (hour != null && Number.isFinite(hour) && new Date(now).getUTCHours() >= hour && (await getSetting(db, 'tg.daily')) !== today) {
    await setSetting(db, 'tg.daily', today);
    const d = await dailyStats(db, now);
    if (d.launches > 0 || d.burns > 0) {
      try {
        await tg(env, 'sendMessage', {
          text: dailyText(d, ctx),
          reply_markup: buttons([[['📊 Dashboard', `${ctx.site}/#dashboard`], ['🚀 Launch a coin', `${ctx.site}/#strike`]]]),
          ...noPreview,
        });
        done++;
      } catch (err) {
        console.error('telegram daily', err.message);
      }
    }
  }
  return done;
}
