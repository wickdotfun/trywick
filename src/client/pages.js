// Les grandes fenêtres du site : Explore (les coins lancés avec WICK), Your flames (le profil
// d'un wallet), le tableau de bord de $WICK, le classement et le Hall of Flames, et « How it works ».
// Tous les chiffres sont réels : la base de WICK (lancements confirmés on-chain, burns avec
// leur transaction), la chaîne (supply) et DexScreener (market cap, volume).
import * as connect from './connect.js';
import { remember, remembered } from './token.js';
import { bindChats, chatHtml } from './keeper.js';
import { ago, aiLogo, compact, esc, fmt, icon, pumpUrl, short, sol, solscan, span } from './util.js';

const $ = (id) => document.getElementById(id);
const usd = (n) => (n ? `$${compact(n)}` : '—');
const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const pad = (n) => String(n).padStart(3, '0');
const txLink = (sig, text = 'TX ↗') => (sig ? `<a class="tx" href="${solscan(esc(sig))}" target="_blank" rel="noopener">${text}</a>` : '');

export const SORTS = [['trending', 'Trending'], ['candles', 'Burning'], ['new', 'New'], ['volume', 'Top volume'], ['burner', 'Biggest burner']];

export function createPages({ api, openModal, isOpen, world, ticker, avatar, pct, shareTag, holderTag, demo, onStrike, onToken }) {
  const tk = () => `$${ticker()}`;

  // ---------------------------------------------------------- Explore
  async function explore(sort = 'trending') {
    openModal(`
      <h2>Explore</h2>
      <p class="muted small">Every coin launched with WICK. Each one paid its Ignition Fee to the fire.</p>
      <div class="tabs">${SORTS.map(([k, label]) => `<button class="tab${k === sort ? ' on' : ''}" data-sort="${k}">${label}</button>`).join('')}</div>
      <div id="ex-body"><p class="muted">Loading…</p></div>`, 'm-wide m-explore');
    document.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => explore(b.dataset.sort)));
    await loadCoins(sort, 0);
  }

  async function loadCoins(sort, offset) {
    let data;
    try {
      data = await api.launches(sort, offset);
    } catch {
      if ($('ex-body')) $('ex-body').innerHTML = '<p class="muted">Could not load the coins. Try again in a moment.</p>';
      return;
    }
    const body = $('ex-body');
    if (!body) return;
    const rows = data.coins.map((m) => `<li class="ex-row${m.holder ? ' holder' : ''}">
      <a href="#coin/${esc(m.mint)}" data-coin="${esc(m.mint)}" class="ex-coin">${avatar(m, 38)}
      <span class="ex-name"><b>$${esc(m.symbol)} ${holderTag(m)}${shareTag(m)}</b><em>${m.candle ? `${pct(m.candle.pct)} of its supply burned` : esc(m.name)}</em></span></a>
      <span class="ex-stat"><b>${usd(m.mcap)}</b><small>mcap</small></span>
      <span class="ex-stat"><b>${usd(m.volume)}</b><small>vol 24h</small></span>
      <span class="ex-stat hide-sm"><b>${ago(m.at).replace(' ago', '')}</b><small>age</small></span>
      <span class="ex-stat hide-sm"><button class="link-btn" data-wallet="${esc(m.creator)}">${esc(short(m.creator))}</button><small>creator</small></span>
      <span class="ex-stat fire"><b>${m.burned ? compact(m.burned) : '—'}</b><small>${tk()} burned</small></span>
      <a class="wbtn small-btn" href="${pumpUrl(esc(m.mint))}" target="_blank" rel="noopener">Trade</a>
    </li>`).join('');
    const list = offset ? body.querySelector('.ex-list') : null;
    if (list) list.insertAdjacentHTML('beforeend', rows);
    else {
      body.innerHTML = data.coins.length
        ? `<ol class="ex-list">${rows}</ol>`
        : `<p class="muted">${sort === 'trending' ? 'No coin launched in the last 3 days yet.' : 'No coin launched yet.'} Launch the first coin.</p>`;
    }
    body.querySelector('.ex-more')?.remove();
    if (data.more) {
      body.insertAdjacentHTML('beforeend', '<button class="ghost ex-more">Load more</button>');
      body.querySelector('.ex-more').addEventListener('click', () => loadCoins(sort, offset + data.coins.length));
    }
    wireWallets(body);
  }

  function wireWallets(root) {
    root.querySelectorAll('[data-wallet]').forEach((b) => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', () => flames(b.dataset.wallet));
    });
  }

  // ---------------------------------------------------------- Your flames
  async function flames(wallet = connect.current()?.address || remembered()) {
    if (!wallet) {
      openModal(`
        <h2>Your flames</h2>
        <p class="muted">Your coins, the ${tk()} they burned, and your achievements. Connect your wallet, or paste any
          Solana address.</p>
        <button class="cta wide" id="fl-connect">Connect wallet</button>
        <div id="fl-wallets"></div>
        <form class="fl-paste" id="fl-paste"><input name="w" placeholder="…or paste a wallet address" autocomplete="off" spellcheck="false">
          <button class="ghost" type="submit">See</button></form>
        <p class="error" id="fl-err" hidden></p>`, 'm-flames');
      $('fl-paste').addEventListener('submit', (e) => {
        e.preventDefault();
        const w = e.target.w.value.trim();
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) flames(w);
        else { $('fl-err').textContent = 'That is not a Solana address.'; $('fl-err').hidden = false; }
      });
      $('fl-connect').addEventListener('click', async () => {
        if (demo) { flames('YouDemo1111111111111111111111111111111111111'); return; }
        try {
          const s = await connect.ensure();
          if (s) flames(s.address);
        } catch {
          $('fl-err').textContent = 'Wallet connection cancelled.';
          $('fl-err').hidden = false;
        }
      });
      return;
    }
    openModal('<h2>Your flames</h2><p class="muted">Loading…</p>', 'm-wide m-flames');
    let p;
    try {
      p = await api.profile(wallet);
    } catch {
      if (isOpen('m-flames')) openModal('<h2>Your flames</h2><p class="muted">Could not load this profile. Try again in a moment.</p>', 'm-flames');
      return;
    }
    if (!isOpen('m-flames')) return;
    const mine = wallet === (connect.current()?.address || remembered()) || (demo && wallet.startsWith('YouDemo'));
    const got = p.achievements.filter((a) => a.done).length;
    openModal(`
      <div class="fl-head">
        <span class="fl-flame" aria-hidden="true">${icon('flame')}</span>
        <div>
          <h2>${mine ? 'Your flames' : 'Flames of'} <span class="mono fl-addr">${esc(short(wallet))}</span></h2>
          <p class="muted small">${p.title ? `<b class="gold">${esc(p.title)}</b>` : 'No match yet'}${p.rank ? ` · #${p.rank.rank} of ${p.rank.of} Pyromaniacs` : ''}${p.since ? ` · first match ${ago(p.since)}` : ''}</p>
        </div>
      </div>
      <div class="tiles">
        <div><strong>${fmt(p.launches)}</strong><span>coins launched</span></div>
        <div><strong class="gold">${compact(p.burned || 0)}</strong><span>${tk()} burned thanks to ${mine ? 'you' : 'them'}</span></div>
        <div><strong>${usd(p.volume24h)}</strong><span>volume of ${mine ? 'your' : 'their'} coins, 24h</span></div>
        <div><strong>${p.ignitionSol ? sol(p.ignitionSol) : '—'}</strong><span>Ignition Fees paid</span></div>
        <div><a class="tile-link" href="https://pump.fun/profile/${esc(wallet)}" target="_blank" rel="noopener">pump.fun ↗</a><span>creator fees earned</span></div>
      </div>
      <h3 class="m-sub">Achievements · ${got}/${p.achievements.length}</h3>
      <ul class="badges">${p.achievements.map((a) => `<li class="${a.done ? 'done' : ''}" title="${esc(a.hint)}">
        ${icon(a.icon)}<b>${esc(a.label)}</b><small>${a.done ? 'unlocked' : esc(a.hint)}</small></li>`).join('')}</ul>
      <h3 class="m-sub">Coins</h3>
      ${p.coins.length ? `<ol class="ex-list">${p.coins.map((m) => `<li class="ex-row${m.holder ? ' holder' : ''}">
        ${avatar(m, 34)}
        <span class="ex-name"><b>$${esc(m.symbol)} ${holderTag(m)}${shareTag(m)}</b><em>${esc(m.name)} · ${ago(m.at)}</em></span>
        <span class="ex-stat"><b>${usd(m.mcap)}</b><small>mcap</small></span>
        <span class="ex-stat fire"><b>${m.burned ? compact(m.burned) : '—'}</b><small>${tk()} burned</small></span>
        <a class="wbtn small-btn" href="${pumpUrl(esc(m.mint))}" target="_blank" rel="noopener">Trade</a></li>`).join('')}</ol>`
        : `<p class="muted">No coin launched from this wallet yet.</p>${mine ? '<button class="cta wide" id="fl-strike">Launch your first coin</button>' : ''}`}
      ${mine ? '<button class="link-btn tiny fl-switch" id="fl-switch">use another wallet</button>' : ''}`, 'm-wide m-flames');
    $('fl-strike')?.addEventListener('click', onStrike);
    $('fl-switch')?.addEventListener('click', async () => { remember(''); await connect.disconnect(); flames(null); });
  }

  // ---------------------------------------------------------- tableau de bord
  function dashboard() {
    const t = world.totals, c = world.candle;
    const last = world.burns[0];
    const lastLaunch = t.lastLaunch || world.matches[world.matches.length - 1];
    const live = Boolean(world.token?.mint) || demo;
    openModal(`
      <h2>${tk()} dashboard</h2>
      <p class="muted small">Real data only: WICK's own burns and fee distributions (each with its transaction), the ${tk()}
        supply read on Solana, and DexScreener for volumes.${live ? '' : ` Most of it starts once ${tk()} is live.`}
        <a class="linkish" href="#proof">Every wallet and every burn: Proof →</a></p>
      <div class="tiles">
        <div><strong class="gold">${compact(t.burned || 0)}</strong><span>${tk()} burned</span></div>
        <div><strong>${t.supplyPct != null ? pct(t.supplyPct) : '—'}</strong><span>of the supply burned</span></div>
        <div><strong>${t.supply ? compact(t.supply.current) : '—'}</strong><span>current supply</span></div>
        <div><strong>${sol(t.sol || 0)}</strong><span>SOL spent on buybacks</span></div>
        <div><strong>${fmt(t.launches ?? world.total ?? 0)}</strong><span>coins launched</span></div>
        <div><strong>${sol(t.ignitionSol || 0)}</strong><span>Ignition Fees paid · ${sol(t.ignitionBurnSol ?? t.ignitionSol ?? 0)} to the burn</span></div>
        <div><strong>${usd(t.volume24h)}</strong><span>WICK coins volume, 24h</span></div>
        <div><strong>${sol((t.sharedSol || 0) + (t.teamSharedSol || 0))}</strong><span>creator fees shared with WICK${t.sharingCoins ? ` · ${fmt(t.sharingCoins)} coins` : ''}</span></div>
        <div><strong>${sol((t.ignitionTeamSol || 0) + (t.teamSharedSol || 0))}</strong><span>to the WICK team (its half of the fees)</span></div>
        <div><strong class="gold">${fmt(t.candles || 0)}</strong><span>coins burning themselves</span></div>
        <div><strong>${sol(t.candleSol || 0)}</strong><span>fed to their own candles · ${fmt(t.candleBurns || 0)} burns</span></div>
      </div>
      <div class="lasts">
        <div><span class="m-sub">Last burn</span>${last
          ? `<p><b class="gold">${compact(last.burned)} ${tk()}</b> · ${sol(last.sol)} · ${ago(last.at)} ${txLink(last.sig)}</p>`
          : '<p class="muted">None yet.</p>'}</div>
        <div><span class="m-sub">Last launch</span>${lastLaunch
          ? `<p><b>$${esc(lastLaunch.symbol)}</b> · ${ago(lastLaunch.at)} ${txLink(lastLaunch.sig)}</p>`
          : '<p class="muted">None yet.</p>'}</div>
      </div>
      <p class="muted small">Candle #${pad(c?.number ?? 1)} is ${Math.floor((c?.melted ?? 0) * 100)}% melted. One candle = ${c?.stepPct ?? 0.5}% of the ${tk()} supply.
        <button class="link-btn tiny" id="db-hall">Hall of Flames →</button></p>
      <h3 class="m-sub">${tk()} burned over time</h3>
      ${burnChart(world.burns)}
      <h3 class="m-sub">Every burn</h3>
      ${burnTable()}`, 'm-wide');
    wireChart();
    $('db-hall').addEventListener('click', () => leaderboard('hall'));
  }

  function burnTable() {
    const rows = world.burns.slice(0, 80).map((b) => `<tr>
      <td>${b.kind === 'match' ? `Ignition Fee <b>$${esc(b.symbol || '?')}</b>` : `Buyback #${esc(b.ref)}`}</td>
      <td class="num">${sol(b.sol)}</td>
      <td class="num"><b>${compact(b.burned)}</b></td>
      <td class="num">${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">${ago(b.at)} ↗</a>` : ago(b.at)}</td></tr>`).join('');
    return rows
      ? `<div class="scroll"><table class="bt-table"><thead><tr><th>What</th><th class="num">SOL used</th><th class="num">${tk()} burned</th><th class="num">When</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="muted">No burn yet. ${world.buyback.live ? 'The first one is coming.' : `Burns start once ${tk()} is live.`}</p>`;
  }

  // La courbe du $WICK brûlé, cumulé : une aire, une ligne, un réticule qui suit la souris.
  function burnChart(list) {
    const pts = [...list].filter((b) => b.at && b.burned > 0).sort((a, b) => a.at - b.at);
    if (pts.length < 2) return '<p class="muted chart-empty">The chart starts with the first burns.</p>';
    let total = 0;
    const series = pts.map((b) => ({ at: b.at, total: (total += b.burned) }));
    const W = 560, H = 190, L = 8, R = 52, T = 14, B = 22;
    const x0 = series[0].at, x1 = series.at(-1).at, ymax = total;
    const x = (t) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
    const y = (v) => T + (1 - v / ymax) * (H - T - B);
    let d = `M${x(series[0].at)},${y(0)}`;
    for (const p of series) d += ` L${x(p.at).toFixed(1)},${y(p.total).toFixed(1)}`;
    const area = `${d} L${x(x1)},${y(0)} Z`;
    const line = d.replace(/^M[^L]+L/, `M${x(series[0].at)},${y(series[0].total)} L`);
    const ticks = [0, 0.5, 1].map((k) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(ymax * k)}" y2="${y(ymax * k)}"/>
      <text class="axis" x="${W - R + 6}" y="${y(ymax * k) + 4}">${compact(ymax * k)}</text>`).join('');
    const short = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<div class="chart" id="burn-chart" data-points='${JSON.stringify(series.map((p) => [x(p.at), y(p.total), p.at, p.total]))}'>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tk()} burned over time, ${compact(total)} in total">
        ${ticks}
        <path class="area" d="${area}"/>
        <path class="line" d="${line}"/>
        <circle class="end" cx="${x(x1)}" cy="${y(total)}" r="4"/>
        <text class="axis" x="${L}" y="${H - 6}">${short(x0)}</text>
        <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${short(x1)}</text>
        <line class="cross" id="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
        <circle class="dot" id="cross-dot" r="4" cx="-10" cy="-10"/>
      </svg>
      <div class="chart-tip" id="chart-tip" hidden></div>
    </div>`;
  }

  function wireChart() {
    const box = $('burn-chart');
    if (!box) return;
    const pts = JSON.parse(box.dataset.points);
    const svg = box.querySelector('svg');
    const tip = $('chart-tip');
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - vx) < Math.abs(best[0] - vx)) best = p;
      $('cross').setAttribute('x1', best[0]); $('cross').setAttribute('x2', best[0]);
      $('cross').setAttribute('visibility', 'visible');
      $('cross-dot').setAttribute('cx', best[0]); $('cross-dot').setAttribute('cy', best[1]);
      tip.hidden = false;
      tip.innerHTML = `<b>${compact(best[3])} ${tk()}</b><span>${new Date(best[2]).toLocaleString()}</span>`;
      const left = (best[0] / svg.viewBox.baseVal.width) * r.width;
      tip.style.left = `${Math.min(r.width - 150, Math.max(0, left - 70))}px`;
    });
    svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      $('cross').setAttribute('visibility', 'hidden');
      $('cross-dot').setAttribute('cx', -10);
    });
  }

  // ---------------------------------------------------------- classement, Hall of Flames
  async function leaderboard(tab = 'pyro') {
    const tabs = [['pyro', 'Pyromaniacs'], ['hall', 'Hall of Flames']];
    openModal(`<h2>${tab === 'hall' ? 'Hall of Flames' : 'Leaderboard'}</h2>
      <div class="tabs">${tabs.map(([k, label]) => `<button class="tab${k === tab ? ' on' : ''}" data-tab="${k}">${label}</button>`).join('')}</div>
      <div id="board-body"><p class="muted">Loading…</p></div>`, 'm-wide m-board');
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => leaderboard(b.dataset.tab)));
    let body;
    if (tab === 'pyro') {
      try {
        const { pyromaniacs } = await api.leaderboard();
        body = pyromaniacs.length ? `<p class="muted small">Creators ranked by the ${tk()} their launches burned.
          Titles: Spark (1 launch), Firestarter (3), Arsonist (10), Pyromaniac (25).</p>
          <ol class="board">${pyromaniacs.map((r) => `<li${r.holder ? ' class="holder"' : ''}>
            <span class="rank">${r.rank}</span>
            <span class="who"><button class="link-btn plain" data-wallet="${esc(r.creator)}"><b>${esc(short(r.creator))} ${r.holder ? holderTag(r) : ''}</b></button><em>${esc(r.title)}</em></span>
            <span class="stat">${fmt(r.launches)} <small>launch${r.launches === 1 ? '' : 'es'}</small></span>
            <span class="stat">${compact(r.burned)} <small>${tk()}</small></span>
            <span class="stat best">${r.best ? `<a href="${pumpUrl(esc(r.best.mint))}" target="_blank" rel="noopener">$${esc(r.best.symbol)}</a>${r.best.mcap ? ` <small>$${compact(r.best.mcap)}</small>` : ''}` : ''}</span>
          </li>`).join('')}</ol>` : '<p class="muted">No creator yet. Launch the first coin and take the top spot.</p>';
      } catch {
        body = '<p class="muted">Could not load the leaderboard. Try again in a moment.</p>';
      }
    } else {
      const c = world.candle;
      const now = `<li class="flame now">
        <span class="hall-candle burning" style="--m:${(c?.melted ?? 0).toFixed(3)}" aria-hidden="true"></span>
        <span class="who"><b>Candle #${pad(c?.number ?? 1)} · ${Math.floor((c?.melted ?? 0) * 100)}% melted</b><em>burning now</em></span>
        <span class="stat">${c?.stepPct ?? 0.5}% <small>of the supply</small></span>
      </li>`;
      body = `<p class="muted small">One candle = ${c?.stepPct ?? 0.5}% of the ${tk()} supply. When it's fully melted, that ${tk()}
        is gone for good and the candle joins the hall. A new season begins.</p>
        <ol class="hall">${now}${world.hall.map((h) => `<li class="flame">
          <span class="hall-candle" aria-hidden="true"></span>
          <span class="who"><b>Candle #${pad(h.number)} — fully melted</b><em>${day(h.completedAt)} · ${fmt(h.launches)} coins launched${h.top ? ` · hottest <a href="${pumpUrl(esc(h.top.mint))}" target="_blank" rel="noopener">$${esc(h.top.symbol)}</a>` : ''}</em></span>
          <span class="stat">${compact(h.burned)} <small>${tk()}</small></span>
          <span class="stat">${h.sol != null ? sol(h.sol) : '—'} <small>spent</small></span>
          <span class="stat best">${h.burns != null ? `${fmt(h.burns)} burns` : ''} ${txLink(h.sig, 'last TX ↗')}</span>
        </li>`).join('')}</ol>
        ${world.hall.length ? '' : `<p class="muted small">No candle fully melted yet. Candle #${pad(c?.number ?? 1)} will be the first.</p>`}`;
    }
    const el = $('board-body');
    if (el) { el.innerHTML = body; wireWallets(el); }
  }

  // ---------------------------------------------------------- comment ça marche
  function how() {
    const b = world.breath, c = world.candle;
    const l = world.launch || {};
    const k = l.keepers || { styles: [], models: [] };
    const fee = l.feeSol || 0.02;
    const s = l.split || { creatorBps: 6000, burnBps: 1000, teamBps: 1000, crewBps: 2000 };
    const live = Boolean(l.feeSol);
    const burnPct = s.burnBps / 100, teamPct = s.teamBps / 100, crewPct = (s.crewBps || 0) / 100, youPct = s.creatorBps / 100;
    const wick = k.models.find((m) => m.id === 'llama') || k.models[0];
    openModal(`
      <h2>How WICK works</h2>
      <p class="muted lead"><b class="gold">Pump.fun launches your token. WICK gives it a crew.</b>
        Four AI agents: the Scout finds the narrative, the Chandler makes the coin, the Igniter launches it on pump.fun (your
        wallet signs), and its Operator works it after the launch, in public: it talks to holders, writes its journal, posts,
        logs every action, and burns the coin under rules locked at launch. Every coin is a candle, and every candle also
        burns ${tk()}.</p>
      <ol class="loop big">
        <li>${icon('scout')}<b>Scout</b><small>finds the narrative</small></li>
        <li>${icon('sparkle')}<b>Chandler</b><small>makes the coin</small></li>
        <li>${icon('rocket')}<b>Igniter</b><small>launches it, you sign</small></li>
        <li>${icon('keeper')}<b>Operator</b><small>works it, burns it</small></li>
      </ol>
      <p class="how-crew"><a class="linkish" href="#crew">${icon('keeper')} See the crew at work</a></p>

      <section class="how-keepers">
        <div class="hk-head">
          <span class="kc-avatar">${icon('keeper')}</span>
          <div><span class="eyebrow">The Operators</span><h3>An AI Operator for every coin</h3>
            <p class="muted">You pick its character and its mind: premium minds (Claude, GPT, Gemini, Grok), paid by its crew, or
            open models run by Cloudflare Workers AI. Its rules are locked at launch, in its Constitution.</p></div>
        </div>
        <div class="hk-minds">${k.models.map((m) => `<div class="hk-mind">${aiLogo(m, 26)}<b>${esc(m.name)}</b><small>${esc(m.by)}${m.premium ? (m.available ? ' · premium' : ' · soon') : ''}</small></div>`).join('')}</div>
        <div class="hk-styles">${k.styles.map((x) => `<span class="ck-style"><b>${esc(x.label)}</b> ${esc(x.hint)}</span>`).join('')}</div>
        <div class="hk-cards">
          <div class="hk-card">${icon('sparkle')}<b>It creates</b><p>Type one sentence. Your Operator writes the name, the ticker
            and the story, and paints the logo. After the launch, it writes the launch kit: the lore, posts for X and
            Telegram, and the coin's card, ready to share.</p></div>
          <div class="hk-card">${icon('book')}<b>It works in public</b><p>Every coin page shows its Operator's Activity: the launch,
            its first words, its daily journal, every decision and every burn, with its transaction. Holders can talk to it.
            Its creator can hand it the coin's X account: it posts there on its own.</p></div>
          <div class="hk-card">${icon('flame')}<b>It burns, it can't dump</b><p>With Make it burn, it picks the moments to buy the
            coin back and burn it, and says why. It decides <i>when</i>, never how much. It can only wait or feed the fire: it
            can't sell and can't move funds.</p></div>
        </div>
      </section>

      <section class="how-ask">
        <h3>${icon('chat')} Ask The Wick</h3>
        <p class="muted small">The Operator of the great ${tk()} candle. Ask it anything about WICK.</p>
        ${chatHtml({
          mint: 'wick',
          keeper: { name: 'The Wick', label: 'Stoic', model: wick?.name, by: wick?.by, logo: wick?.logo },
          suggestions: ['What is WICK?', 'How do the Operators work?', `Where do the fees go?`],
        })}
      </section>

      ${live ? '' : `<p class="note"><b>Before ${tk()} is live,</b> launching on WICK has no Ignition Fee and no fee sharing:
        you only pay pump.fun's own costs. The Operators, Spark and the conversations already work. Make it burn and the
        ${tk()} burns switch on at the ${tk()} launch.</p>`}
      <h3 class="how-title">Step by step</h3>
      <ol class="how">
        <li><b>Pick a narrative, spark it.</b> Take one of the Scout's picks (each with its sources) or write your own idea in
          one sentence: the Chandler fills in the coin, name, ticker, description, logo. Or fill it in yourself. Then pick
          its Operator's mind, character and objective. Free, and nothing is sent anywhere until you launch.</li>
        <li><b>Launch the coin.</b> Your coin is created on pump.fun, signed by your own wallet${live ? ' (two approvals: the launch, then the Ignition Fee)' : ''}.
          You are its creator: its pump.fun page and its creator fees are yours. On WICK it becomes a match orbiting the
          candle, with its own page and its Operator.</li>
        <li><b>The Ignition Fee: ${fee} SOL.</b> WICK's own fee, not a pump.fun fee. <b>50% burns ${tk()}, 50% funds the
          team</b>: both transfers sit in one transaction you see in your wallet before you sign. The burn half buys ${tk()}
          and burns it within a minute of your launch.</li>
        <li><b>The fee split.</b> Every coin shares its creator fees: <b>${youPct}% yours</b>${crewPct ? `, ${crewPct}% its crew
          (its AI and its posts, received by the WICK team wallet that runs it)` : ''}, ${burnPct}% burns ${tk()}, ${teamPct}% the team.
          It is set with pump.fun's own fee sharing and locked on-chain: nobody can change it, not even WICK.</li>
        <li><b>Make it burn (optional).</b> Take ${(l.selfOptions?.length ? l.selfOptions : [1000, 2000, 3000, 5000]).map((v) => `${v / 100}%`).join(', ')}
          from your share to buy your coin back and burn it, forever: <b>your coin becomes a candle</b>, and its Operator
          picks the moments.</li>
        <li><b>The Operator's Constitution.</b> Its personality, its mind, its burn allocation and its rules are set at launch,
          shown on its coin's page and locked: at most one decision an hour, a burn at least every 24 hours when there is
          something to burn, at once past 0.25 SOL. Talking to it can't move anything: the conversation, the decision (burn or
          wait), the fixed rules and the transaction signer are separate, and the signer only knows how to buy back the coin and
          burn it. Every action lands in its Activity, every burn with its Solscan link.</li>
        <li><b>The breath.</b> On top of the burn of each launch, a buyback every ${span(b?.durationMs ?? 1_800_000)} at most:
          everything waiting in the WICK burn wallet buys ${tk()} back and burns it. Every launch brings the next one
          ${span(b?.matchMs ?? 60_000)} closer: the countdown is on the home page.</li>
        <li><b>The candle is the supply.</b> One candle = ${c?.stepPct ?? 0.5}% of the ${tk()} supply. It melts with every
          burn and never comes back. Fully melted, it enters the Hall of Flames, and the next one is lit.</li>
        <li><b>Living matches, your flames.</b> Coins that pump grow and move closer to the flame, dead ones fade. Coins
          launched by a ${tk()} holder burn in gold. Track your coins in Your flames, climb the Pyromaniacs leaderboard,
          browse the Candles and Explore, and follow every number on the Dashboard.</li>
      </ol>
      <div class="money">
        <h3>Where the money goes</h3>
        <dl>
          <dt>Ignition Fee</dt><dd>50% burns ${tk()} · 50% team</dd>
          <dt>Your coin's creator fees</dt><dd>${youPct}% yours${crewPct ? ` · ${crewPct}% its crew` : ''} · ${burnPct}% burns ${tk()} · ${teamPct}% team</dd>
          <dt>Make it burn</dt><dd>taken from your share: it burns your coin</dd>
          <dt>${tk()}'s own creator fees</dt><dd>the team, like any pump.fun coin's creator</dd>
          <dt>The crew</dt><dd>${crewPct ? `${crewPct}% of each coin's creator fees pays for its AI and its posts` : 'open models on Cloudflare, within a daily quota'}</dd>
        </dl>
      </div>
      <div class="note"><b>Everything is on-chain.</b> Every burn has its Solscan link, and the supply is read from
        Solana. Your keys stay yours: the site never sees them, and every transaction shows up in your wallet before you sign.</div>
      <p class="muted small">Burning removes ${tk()} from circulation. It is a mechanism of the protocol, not a promise about
        the price. The Operators are AI: they can be wrong, and nothing they say is financial advice. ${tk()} is a meme coin.
        Coins launched here are made by their creators, not by WICK.</p>
      <div class="wallets row"><button class="wbtn primary" id="how-strike">Launch a coin</button><button class="wbtn" id="how-token">See ${tk()}</button></div>`, 'm-how m-wide');
    $('how-strike').addEventListener('click', onStrike);
    $('how-token').addEventListener('click', onToken);
    bindChats(document.querySelector('.m-how') || document, api.ask);
  }

  // Sur téléphone : toutes les pages dans un menu.
  function menu(go) {
    const items = [['crew', icon('keeper'), 'The crew'], ['candles', icon('candle'), 'Candles'], ['explore', icon('compass'), 'Explore'], ['wick', icon('candle'), tk()], ['dashboard', icon('dashboard'), 'Dashboard'], ['proof', icon('lock'), 'Proof'],
      ['leaderboard', icon('trophy'), 'Leaderboard'], ['hall', icon('pillar'), 'Hall of Flames'], ['flames', icon('user'), 'Your flames'],
      ['how', icon('help'), 'How it works']];
    openModal(`<h2>WICK</h2><div class="wallets">${items.map(([k, ico, label]) => `<button class="wbtn menu-item" data-menu="${k}">${ico}${label}</button>`).join('')}</div>`, 'm-menu');
    document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => go(b.dataset.menu)));
  }

  return { explore, flames, dashboard, leaderboard, how, menu };
}
