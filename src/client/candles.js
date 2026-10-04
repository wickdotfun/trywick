// « Make it burn » côté site : la forêt des bougies (les coins qui se brûlent eux-mêmes) et la
// page de chaque coin, avec sa bougie, sa part brûlée et chacun de ses burns.
import { ago, aiLogo, compact, esc, fmt, icon, pumpUrl, sol, solscan } from './util.js';

const $ = (id) => document.getElementById(id);
const usd = (n) => (n == null ? '—' : `$${compact(n)}`);
const pctText = (p) => (p == null ? '—' : `${p < 0.01 && p > 0 ? '<0.01' : p.toLocaleString('en-US', { maximumFractionDigits: p >= 10 ? 1 : 2 })}%`);

// Une bougie en CSS : sa hauteur suit la part de supply qui reste, la flamme danse.
export function candleHtml({ pct = 0, w = 34, full = 150, gold = false, out = false, big = false, label = '', sub = '', ghost = false, tag = 'div', attrs = '' }) {
  const h = Math.max(10, Math.round(full * (1 - Math.min(100, pct) / 100)));
  const fw = Math.round(w * (big ? 0.42 : 0.6));
  const fh = Math.round(fw * 1.9);
  const burnt = full - h;
  return `<${tag} class="cdl${gold ? ' gold' : ''}${big ? ' big' : ''}" style="--w:${w}px;--h:${h}px;--fw:${fw}px;--fh:${fh}px;--burnt:${burnt}px;--d:${(1.3 + ((w * 7) % 9) / 10).toFixed(1)}s" ${attrs}>
    <i class="cdl-halo"></i><i class="cdl-flame${out ? ' out' : ''}"><i></i></i><i class="cdl-wick"></i>
    <i class="cdl-wax">${ghost && burnt > 6 ? '<i class="cdl-ghost"></i>' : ''}</i>
    ${label ? `<span class="cdl-label"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>` : ''}
  </${tag}>`;
}

// La taille d'une bougie selon la market cap du coin (0,72 à 1,3).
const sizeOf = (m) => (m.mcap ? Math.max(0.72, Math.min(1.3, 0.55 + Math.log10(Math.max(1, m.mcap)) / 8)) : 0.8);

export function createCandles({ api, openModal, world, ticker, avatar, holderTag, demo, onStrike, go }) {
  const tk = () => `$${ticker()}`;

  // ---------------------------------------------------------- la forêt
  async function forest() {
    openModal(`<div id="cd-body" class="cd"><p class="muted">Lighting the candles…</p></div>`, 'm-wide m-candles');
    let data;
    try {
      data = await api.candles();
    } catch {
      if ($('cd-body')) $('cd-body').innerHTML = '<p class="muted">Could not load the candles. Try again in a moment.</p>';
      return;
    }
    const body = $('cd-body');
    if (!body) return;
    const coins = data.forest || [];
    const t = data.totals || {};
    // $WICK au centre, les coins de part et d'autre (les plus brûlés au plus près).
    const ranked = coins.slice(0, 12);
    const left = [], right = [];
    ranked.forEach((m, i) => (i % 2 ? left : right).push(m));
    const coinCandle = (m) => candleHtml({
      pct: m.candle?.pct ?? 0, w: Math.round(30 * sizeOf(m)), full: Math.round(140 * sizeOf(m)),
      gold: m.holder, label: `$${esc(m.symbol)}`, sub: pctText(m.candle?.pct ?? 0), tag: 'button',
      attrs: `data-coin="${esc(m.mint)}" aria-label="$${esc(m.symbol)}'s candle"`,
    });
    const wick = candleHtml({
      pct: world.totals?.supplyPct ?? 0, w: 78, full: 220, gold: true, big: true,
      label: tk(), sub: `${pctText(world.totals?.supplyPct ?? 0)} burned`, tag: 'button', attrs: 'data-wick aria-label="The $WICK candle"',
    });
    body.innerHTML = `
      <div class="cd-head">
        <div>
          <span class="eyebrow">Make it burn</span>
          <h2>Every coin is a <span class="grad">candle</span>.</h2>
          <p class="muted">Coins launched on WICK can burn themselves: a share of their creator fees buys them back and
            burns them, forever, locked on pump.fun. Each candle has an AI Keeper that picks the moments and tells you why.
            Every candle also burns ${tk()}.</p>
        </div>
        <button class="cta" id="cd-light">Light your candle</button>
      </div>
      <div class="cd-stage">
        <i class="cd-floor"></i>
        ${Array.from({ length: 12 }, (_, i) => `<i class="ember" style="left:${8 + ((i * 53) % 84)}%;animation-duration:${5 + (i % 5)}s;animation-delay:${((i * 0.7) % 6).toFixed(1)}s"></i>`).join('')}
        <div class="cd-row">${left.reverse().map(coinCandle).join('')}${wick}${right.map(coinCandle).join('')}</div>
        <span class="cd-live"><i></i>${fmt(t.candles || 0)} ${t.candles === 1 ? 'candle' : 'candles'} burning</span>
        <span class="cd-hint">Height = supply left · gold = launched by a ${tk()} holder</span>
      </div>
      <div class="tiles cd-tiles">
        <div><strong class="gold">${fmt(t.candles || 0)}</strong><span>coins burning themselves</span></div>
        <div><strong>${fmt(t.candleBurns || 0)}</strong><span>buybacks and burns</span></div>
        <div><strong>${sol(t.candleSol || 0)}</strong><span>fed to their own candles</span></div>
      </div>
      ${keepersShowcase()}
      <div class="cd-cols">
        <section class="cd-card">
          <h3>Brightest candles <small>most burned</small></h3>
          ${coins.length ? `<ol class="cd-list">${coins.slice(0, 20).map((m, i) => `<li><button class="cd-item" data-coin="${esc(m.mint)}">
            <span class="mono dim">${String(i + 1).padStart(2, '0')}</span>
            ${candleHtml({ pct: m.candle?.pct ?? 0, w: 11, full: 30, gold: m.holder })}
            ${avatar(m, 30)}
            <span class="cd-name"><b>$${esc(m.symbol)} ${holderTag(m)}</b><small>burns ${m.candle.bps / 100}% of its fees${m.candle.keeper ? ` · ${esc(m.candle.keeper.label)} Keeper` : ''}</small></span>
            <span class="cd-num gold">${pctText(m.candle.pct)}<small>burned</small></span>
            <span class="cd-num hide-sm">${usd(m.mcap)}<small>mcap</small></span>
          </button></li>`).join('')}</ol>`
            : `<p class="muted">No candle lit yet. Launch a coin with <b>Make it burn</b> and yours is the first.</p>`}
        </section>
        <section class="cd-card">
          <h3>Latest burns <small>on-chain</small></h3>
          ${(data.burns || []).length ? `<ul class="cd-burns">${data.burns.slice(0, 12).map((b) => `<li>
            <a href="${b.sig ? solscan(esc(b.sig)) : '#'}" target="_blank" rel="noopener">
              <span class="ev-ico">${icon('flame')}</span>
              <span class="cd-name"><b>${compact(b.burned)} $${esc(b.symbol)} burned</b><small>${sol(b.sol)} of its own fees</small></span>
              <time data-at="${b.at}">${ago(b.at)}</time>
            </a></li>`).join('')}</ul>`
            : '<p class="muted">The first burns show up here, each with its transaction.</p>'}
        </section>
      </div>`;
    $('cd-light').addEventListener('click', onStrike);
    // Sur un écran étroit, la forêt défile : on part de la bougie de $WICK, au centre.
    const row = body.querySelector('.cd-row'), center = body.querySelector('[data-wick]');
    if (row && center && row.scrollWidth > row.clientWidth) row.scrollLeft = center.offsetLeft - (row.clientWidth - center.offsetWidth) / 2;
    body.querySelector('[data-wick]')?.addEventListener('click', () => go('wick'));
  }

  // Les Keepers : les six esprits (avec leur logo) et les quatre personnalités.
  function keepersShowcase() {
    const k = world.launch?.keepers;
    if (!k) return '';
    return `<section class="cd-keepers">
      <div class="ck-head">
        <span class="kc-avatar">${icon('keeper')}</span>
        <div><h3>Every candle has an AI <span class="grad">Keeper</span></h3>
          <p class="muted">The creator picks its personality and its mind. The Keeper picks the moments to buy the coin back
          and burn it, and tells the holders why. It never touches the amounts.</p></div>
      </div>
      <div class="ck-minds">${k.models.map((m) => `<div class="ck-mind">${aiLogo(m, 22)}<span><b>${esc(m.name)}</b><small>${esc(m.by)}</small></span></div>`).join('')}</div>
      <div class="ck-styles">${k.styles.map((x) => `<span class="ck-style"><b>${esc(x.label)}</b> ${esc(x.hint)}</span>`).join('')}</div>
    </section>`;
  }

  // ---------------------------------------------------------- la page d'un coin
  async function coin(mint) {
    openModal(`<div id="cn-body" class="cn"><p class="muted">Loading…</p></div>`, 'm-wide m-coin');
    let data;
    try {
      data = await api.coin(mint);
    } catch {
      if ($('cn-body')) $('cn-body').innerHTML = '<p class="muted">This coin is not on WICK, or could not be loaded.</p>';
      return;
    }
    const body = $('cn-body');
    if (!body || !data?.match) return;
    const m = data.match;
    const c = m.candle;
    const wickBps = m.share?.bps ?? 0;
    const teamBps = m.share?.teamBps ?? 0;
    const selfBps = c?.bps ?? 0;
    const creatorBps = 10_000 - wickBps - selfBps;
    const tweet = c
      ? `$${m.symbol} burns itself on WICK: ${pctText(c.pct)} of its supply burned so far, ${selfBps / 100}% of its creator fees, forever.\n${location.origin}/#coin/${m.mint}`
      : `$${m.symbol} on WICK, the launchpad that burns itself.\n${location.origin}/#coin/${m.mint}`;
    body.innerHTML = `
      <div class="cn-grid">
        <div class="cn-stage">
          <div class="cn-corner"><small>Supply left</small><b>${c ? pctText(100 - c.pct) : '100%'}</b></div>
          <div class="cn-corner right"><small>Burns</small><b class="gold">${fmt(c?.burns || 0)}</b></div>
          ${candleHtml({ pct: c?.pct ?? 0, w: 104, full: 300, gold: m.holder, out: !c, ghost: true, big: true })}
          <p class="muted small">${!c ? 'This coin does not burn itself. Its candle is unlit.'
            : c.burned > 0 ? `The dashed outline is the ${pctText(c.pct)} of $${esc(m.symbol)} already burned. Gone forever.`
              : `Lit. Its first burn melts the candle, and every burn after that, forever.`}</p>
        </div>
        <div class="cn-info">
          <div class="cn-title">
            ${avatar(m, 60)}
            <div>
              <h2>$${esc(m.symbol)} <small>${esc(m.name)}</small></h2>
              <div class="cn-tags">
                ${c ? `<span class="cn-tag gold">Burns itself · ${selfBps / 100}%</span>` : ''}
                <span class="cn-tag">Launched on WICK · match #${fmt(m.seq)}</span>
                ${m.share ? '<span class="cn-tag">Split locked on pump.fun</span>' : ''}
                ${m.holder ? `<span class="cn-tag">${tk()} holder</span>` : ''}
              </div>
            </div>
          </div>
          <div class="tiles cn-tiles">
            <div><strong class="gold">${c ? compact(c.burned) : '0'}</strong><span>$${esc(m.symbol)} burned${c ? ` · ${pctText(c.pct)} of the supply` : ''}</span></div>
            <div><strong>${sol(c?.sol || 0)}</strong><span>of its fees spent burning it</span></div>
            <div><strong>${m.burned ? compact(m.burned) : '—'}</strong><span>${tk()} burned at launch</span></div>
            <div><strong>${usd(m.mcap)}</strong><span>market cap${m.volume ? ` · vol 24h ${usd(m.volume)}` : ''}</span></div>
          </div>
          <div class="cn-actions">
            <a class="cta small-cta" href="${pumpUrl(esc(m.mint))}" target="_blank" rel="noopener">Buy on pump.fun</a>
            <a class="wbtn" href="https://x.com/intent/post?text=${encodeURIComponent(tweet)}" target="_blank" rel="noopener">Share its candle</a>
            <a class="wbtn" href="https://solscan.io/token/${esc(m.mint)}" target="_blank" rel="noopener">Solscan ↗</a>
          </div>
          ${c?.keeper ? `<section class="keeper-card">
            <div class="kc-head">
              <span class="kc-avatar">${icon('keeper')}</span>
              <div><b>Keeper of $${esc(m.symbol)}</b><small>${esc(c.keeper.label)} · runs on <span class="kc-model">${aiLogo(c.keeper, 14)} ${esc(c.keeper.model)}</span> (${esc(c.keeper.by)})</small></div>
              <span class="kc-status"><i></i>tending</span>
            </div>
            ${c.keeper.intro ? `<blockquote>“${esc(c.keeper.intro)}”</blockquote>` : ''}
            <p class="kc-thought">${c.keeper.thought
              ? `Latest thought, ${ago(c.keeper.thoughtAt)}: <b>“${esc(c.keeper.thought)}”</b>`
              : `It wakes up once ${esc(m.symbol)}'s fees fill its candle (0.01 SOL), then picks the moment to burn. Never more than 24 hours.`}</p>
          </section>` : ''}
          ${m.share ? `<div class="cn-split">
            <small class="eyebrow">Where its creator fees go</small>
            <div class="split-bar">
              <span style="width:${creatorBps / 100}%">Creator ${creatorBps / 100}%</span>
              ${selfBps ? `<span class="self" style="width:${selfBps / 100}%">${selfBps >= 1500 ? (selfBps >= 2000 && m.symbol.length <= 5 ? `Burns $${esc(m.symbol)} ` : 'Burns ') : ''}${selfBps / 100}%</span>` : ''}
              ${wickBps - teamBps > 0 ? `<span class="wick" style="width:${(wickBps - teamBps) / 100}%"></span>` : ''}
              ${teamBps ? `<span class="team" style="width:${teamBps / 100}%"></span>` : ''}
            </div>
            <small class="muted">${selfBps ? `${selfBps / 100}% buys $${esc(m.symbol)} back and burns it · ` : ''}${(wickBps - teamBps) / 100}% burns ${tk()} · ${teamBps / 100}% WICK team. Set at launch, locked on pump.fun.</small>
          </div>` : ''}
          <section class="cd-card">
            <h3>Every burn <small>on-chain</small></h3>
            ${data.burns.length ? `<div class="cn-table"><table>
              <thead><tr><th>When</th><th>Burned</th><th>SOL used</th><th>Of supply</th><th></th></tr></thead>
              <tbody>${data.burns.map((b) => `<tr>
                <td class="dim"><time data-at="${b.at}">${ago(b.at)}</time></td>
                <td class="gold">${compact(b.burned)} $${esc(m.symbol)}</td>
                <td>${sol(b.sol)}</td>
                <td class="dim">${pctText((b.burned / 1e9) * 100)}</td>
                <td>${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">TX ↗</a>` : ''}</td>
              </tr>${b.voice ? `<tr class="voice"><td colspan="5">${icon('keeper')} “${esc(b.voice)}”</td></tr>` : ''}`).join('')}</tbody></table></div>`
              : `<p class="muted">${c ? 'No burn yet. Its first buyback happens once its creator fees pile up (at least 0.01 SOL for its candle).' : 'This coin was launched without Make it burn.'}</p>`}
          </section>
        </div>
      </div>
      <div class="cn-foot"><button class="link-btn" id="cn-forest">All the candles</button>
        <button class="cta" id="cn-light">Light your own candle</button></div>`;
    $('cn-forest').addEventListener('click', () => go('candles'));
    $('cn-light').addEventListener('click', onStrike);
  }

  return { forest, coin, candleHtml };
}
