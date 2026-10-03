// Le bot Telegram : il poste dans le canal (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
// - chaque nouvelle allumette, avec la photo du coin et ses boutons ;
// - puis met ce post à jour quand le frais de lancement a été brûlé en $WICK ;
// - chaque buyback (la fin d'un souffle) ;
// - et chaque bougie consumée (un palier de la supply de $WICK brûlé pour de bon).
// Tout passe par le cron, avec un état en base : un post raté est retenté à la minute suivante,
// et jamais posté deux fois.
const SITE = 'https://trywick.fun';

export function telegramReady(env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, parse_mode: 'HTML', ...body }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`telegram_${method}: ${data?.description || res.status}`);
  return data.result;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function compact(n) {
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, u] of units) if (n >= v) return `${(n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, '')}${u}`;
  return String(Math.round(n));
}
const sol = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })} SOL`;

function buttons(rows) {
  return { inline_keyboard: rows.map((row) => row.map(([text, url]) => ({ text, url }))) };
}

// Le texte du post d'une allumette (le même au départ et après son burn).
export function matchCaption(m, { ticker = 'WICK', cycleMinutes } = {}) {
  const lines = [
    '🕯️ <b>New match on WICK</b>',
    '',
    `<b>$${esc(m.symbol)}</b> · ${esc(m.name)}`,
  ];
  if (m.holder) lines.push(`👑 Launched by a <b>$${esc(ticker)} holder</b>: golden flame`);
  if (m.burned > 0) lines.push(`🔥 This launch burned <b>${compact(m.burned)} $${esc(ticker)}</b>`);
  else if (m.fee_lamports > 0 && m.fee_state !== 'failed') lines.push(`🔥 ${sol(m.fee_lamports / 1e9)} on its way to burn $${esc(ticker)}…`);
  lines.push(`⏳ Next buyback ${cycleMinutes ? `${cycleMinutes} min` : 'a bit'} sooner`);
  if (m.dev_buy > 0) lines.push(`💰 Dev buy: ${sol(m.dev_buy)}`);
  lines.push('', `<code>${esc(m.mint)}</code>`);
  return lines.join('\n');
}

function matchButtons(m, site) {
  return buttons([[['Buy on pump.fun', `https://pump.fun/coin/${m.mint}`]], [['🕯️ Watch the candle', site]]]);
}

async function postMatch(env, m, opts) {
  const site = env.SITE_URL || SITE;
  const caption = matchCaption(m, opts);
  const reply_markup = matchButtons(m, site);
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

// Une passe du cron. Renvoie le nombre de messages envoyés ou modifiés.
export async function runTelegram(env, now, { ticker = 'WICK', matchMinutes = 1 } = {}) {
  if (!telegramReady(env)) return 0;
  const db = env.DB;
  const site = env.SITE_URL || SITE;
  const minutes = matchMinutes === 1 ? '1' : String(matchMinutes);
  let done = 0;

  // 1. Les nouvelles allumettes (des 3 dernières heures, pour ne jamais inonder le canal).
  const { results: fresh } = await db.prepare(
    `SELECT m.*, (SELECT burned_ui FROM burns WHERE kind = 'match' AND ref = m.mint AND status = 'burned') AS burned
     FROM matches m WHERE m.seq IS NOT NULL AND m.tg_state IS NULL AND m.lit_at > ? ORDER BY m.seq LIMIT 5`,
  ).bind(now - 3 * 3600_000).all();
  for (const m of fresh) {
    const claimed = await db.prepare("UPDATE matches SET tg_state = 'posting' WHERE mint = ? AND tg_state IS NULL").bind(m.mint).run();
    if (claimed.meta?.changes !== 1) continue;
    try {
      const post = await postMatch(env, m, { ticker, cycleMinutes: minutes });
      await db.prepare('UPDATE matches SET tg_state = ?, tg_msg_id = ? WHERE mint = ?').bind(post.kind, post.id, m.mint).run();
      done++;
    } catch (err) {
      console.error('telegram post', m.mint, err.message);
      await db.prepare('UPDATE matches SET tg_state = NULL WHERE mint = ?').bind(m.mint).run();
      return done;   // Telegram ne répond pas : on retentera à la prochaine minute
    }
  }

  // 2. Les burns de lancement terminés : on met à jour le post de l'allumette.
  const { results: matchBurns } = await db.prepare(
    `SELECT b.id AS burn_id, b.status AS burn_status, b.burned_ui AS burned, m.*
     FROM burns b JOIN matches m ON m.mint = b.ref
     WHERE b.kind = 'match' AND b.tg_done = 0 AND b.status IN ('burned', 'skipped', 'failed') LIMIT 5`,
  ).all();
  for (const r of matchBurns) {
    if (r.burn_status === 'burned' && r.burned > 0 && (r.tg_state === 'photo' || r.tg_state === 'text')) {
      const body = { message_id: r.tg_msg_id, reply_markup: matchButtons(r, site) };
      const caption = matchCaption(r, { ticker, cycleMinutes: minutes });
      try {
        if (r.tg_state === 'photo') await tg(env, 'editMessageCaption', { ...body, caption });
        else await tg(env, 'editMessageText', { ...body, text: caption, link_preview_options: { is_disabled: true } });
        done++;
      } catch (err) {
        console.log('telegram edit', r.mint, err.message);
      }
    } else if (r.tg_state === null && r.lit_at > now - 3 * 3600_000) {
      continue;   // le post de l'allumette n'est pas encore parti : on attend
    }
    await db.prepare('UPDATE burns SET tg_done = 1 WHERE id = ?').bind(r.burn_id).run();
  }

  // 3. Les bougies consumées : le post le plus important.
  const { results: hall } = await db.prepare('SELECT * FROM hall WHERE tg_done = 0 ORDER BY number LIMIT 2').all();
  for (const h of hall) {
    if (h.completed_at > now - 24 * 3600_000) {
      const text = [
        `🕯️🔥 <b>Candle #${h.number} is fully consumed</b>`,
        '',
        `<b>${Number(h.pct.toFixed(2))}% of the $${esc(ticker)} supply</b> is now burned forever.`,
        `${h.launches} coins launched while it burned${h.top_symbol ? `, hottest: <b>$${esc(h.top_symbol)}</b>` : ''}.`,
        '',
        `Candle #${h.number + 1} is lit. Every launch melts it.`,
      ].join('\n');
      try {
        await tg(env, 'sendMessage', { text, reply_markup: buttons([[['🕯️ See the candle hall', site]]]), link_preview_options: { is_disabled: true } });
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
      const total = await db.prepare("SELECT COALESCE(SUM(burned_ui), 0) AS t FROM burns WHERE status = 'burned'").first();
      const text = [
        `🔥 <b>Buyback #${esc(b.ref)}</b>`,
        '',
        `${sol(b.sol)} of creator fees → <b>${compact(b.burned_ui)} $${esc(ticker)}</b> bought back and burned.`,
        '',
        `Total burned so far: <b>${compact(total.t)} $${esc(ticker)}</b>`,
      ].join('\n');
      const rows = [];
      if (b.burn_sig) rows.push([['🔥 See the burn', `https://solscan.io/tx/${b.burn_sig}`]]);
      rows.push([['🕯️ Watch the candle', site]]);
      try {
        await tg(env, 'sendMessage', { text, reply_markup: buttons(rows), link_preview_options: { is_disabled: true } });
        done++;
      } catch (err) {
        console.error('telegram candle', b.ref, err.message);
        return done;
      }
    }
    await db.prepare('UPDATE burns SET tg_done = 1 WHERE id = ?').bind(b.id).run();
  }
  return done;
}
