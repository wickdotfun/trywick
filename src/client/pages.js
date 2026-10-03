// Les grandes fenêtres du site : Explore (les coins lancés avec WICK), Your flames (le profil
// d'un wallet), le tableau de bord de $WICK, le classement et le Hall of Flames, et « How it works ».
// Tous les chiffres sont réels : la base de WICK (lancements confirmés on-chain, burns avec
// leur transaction), la chaîne (supply) et DexScreener (market cap, volume).
import { connectInline, remember, remembered } from './token.js';
import { ago, compact, esc, fmt, pumpUrl, short, sol, solscan, span } from './util.js';

const $ = (id) => document.getElementById(id);
const usd = (n) => (n ? `$${compact(n)}` : '—');
const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const pad = (n) => String(n).padStart(3, '0');
const txLink = (sig, text = 'TX ↗') => (sig ? `<a class="tx" href="${solscan(esc(sig))}" target="_blank" rel="noopener">${text}</a>` : '');

export const SORTS = [['trending', 'Trending'], ['new', 'New'], ['volume', 'Top volume'], ['burner', 'Biggest burner']];

export function createPages({ api, openModal, isOpen, world, ticker, avatar, pct, demo, onStrike, onToken }) {
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
      ${avatar(m, 38)}
      <span class="ex-name"><b>$${esc(m.symbol)}${m.holder ? ' 👑' : ''}</b><em>${esc(m.name)}</em></span>
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
        : `<p class="muted">${sort === 'trending' ? 'No coin launched in the last 3 days yet.' : 'No coin launched yet.'} Strike the first match.</p>`;
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
  async function flames(wallet = remembered()) {
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
          const mod = await import('./wallet.js');
          const res = await connectInline(mod, $('fl-wallets'), `${location.origin}/#flames`);
          if (res) { remember(res.owner); flames(res.owner); }
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
    const mine = wallet === remembered() || (demo && wallet.startsWith('YouDemo'));
    const got = p.achievements.filter((a) => a.done).length;
    openModal(`
      <div class="fl-head">
        <span class="fl-flame" aria-hidden="true">🔥</span>
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
        <i>${a.icon}</i><b>${esc(a.label)}</b><small>${a.done ? 'unlocked' : esc(a.hint)}</small></li>`).join('')}</ul>
      <h3 class="m-sub">Coins</h3>
      ${p.coins.length ? `<ol class="ex-list">${p.coins.map((m) => `<li class="ex-row${m.holder ? ' holder' : ''}">
        ${avatar(m, 34)}
        <span class="ex-name"><b>$${esc(m.symbol)}${m.holder ? ' 👑' : ''}</b><em>${esc(m.name)} · ${ago(m.at)}</em></span>
        <span class="ex-stat"><b>${usd(m.mcap)}</b><small>mcap</small></span>
        <span class="ex-stat fire"><b>${m.burned ? compact(m.burned) : '—'}</b><small>${tk()} burned</small></span>
        <a class="wbtn small-btn" href="${pumpUrl(esc(m.mint))}" target="_blank" rel="noopener">Trade</a></li>`).join('')}</ol>`
        : `<p class="muted">No coin launched from this wallet yet.</p>${mine ? '<button class="cta wide" id="fl-strike">Strike your first match</button>' : ''}`}
      ${mine ? '<button class="link-btn tiny fl-switch" id="fl-switch">use another wallet</button>' : ''}`, 'm-wide m-flames');
    $('fl-strike')?.addEventListener('click', onStrike);
    $('fl-switch')?.addEventListener('click', () => { remember(''); flames(null); });
  }

  // ---------------------------------------------------------- tableau de bord
  function dashboard() {
    const t = world.totals, c = world.candle;
    const last = world.burns[0];
    const lastLaunch = t.lastLaunch || world.matches[world.matches.length - 1];
    const live = Boolean(world.token?.mint) || demo;
    openModal(`
      <h2>🔥 ${tk()} dashboard</h2>
      <p class="muted small">Real data only: WICK's own burns (each with its transaction), the ${tk()} supply read on Solana,
        and DexScreener for volumes.${live ? '' : ` Most of it starts once ${tk()} is live.`}</p>
      <div class="tiles">
        <div><strong class="gold">${compact(t.burned || 0)}</strong><span>${tk()} burned</span></div>
        <div><strong>${t.supplyPct != null ? pct(t.supplyPct) : '—'}</strong><span>of the supply burned</span></div>
        <div><strong>${t.supply ? compact(t.supply.current) : '—'}</strong><span>current supply</span></div>
        <div><strong>${sol(t.sol || 0)}</strong><span>SOL spent on buybacks</span></div>
        <div><strong>${fmt(t.launches ?? world.total ?? 0)}</strong><span>coins launched</span></div>
        <div><strong>${sol(t.ignitionSol || 0)}</strong><span>Ignition Fees paid</span></div>
        <div><strong>${usd(t.volume24h)}</strong><span>WICK coins volume, 24h</span></div>
        <div><strong class="dim">soon</strong><span>creator fees shared</span></div>
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
      <td>${b.kind === 'match' ? `🔥 Ignition <b>$${esc(b.symbol || '?')}</b>` : `💨 Buyback #${esc(b.ref)}`}</td>
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
            <span class="who"><button class="link-btn plain" data-wallet="${esc(r.creator)}"><b>${esc(short(r.creator))}${r.holder ? ' 👑' : ''}</b></button><em>${esc(r.title)}</em></span>
            <span class="stat">${fmt(r.launches)} <small>launch${r.launches === 1 ? '' : 'es'}</small></span>
            <span class="stat">${compact(r.burned)} <small>${tk()}</small></span>
            <span class="stat best">${r.best ? `<a href="${pumpUrl(esc(r.best.mint))}" target="_blank" rel="noopener">$${esc(r.best.symbol)}</a>${r.best.mcap ? ` <small>$${compact(r.best.mcap)}</small>` : ''}` : ''}</span>
          </li>`).join('')}</ol>` : '<p class="muted">No creator yet. Strike the first match and take the top spot.</p>';
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
          <span class="who"><b>Candle #${pad(h.number)} — fully melted 🔥</b><em>${day(h.completedAt)} · ${fmt(h.launches)} coins launched${h.top ? ` · hottest <a href="${pumpUrl(esc(h.top.mint))}" target="_blank" rel="noopener">$${esc(h.top.symbol)}</a>` : ''}</em></span>
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
    const fee = world.launch?.feeSol || 0.02;
    openModal(`
      <h2>How WICK works</h2>
      <p class="muted"><b class="gold">WICK is the launchpad that burns itself.</b> Every coin launched here is a match.
        Every match feeds the flame. The flame burns ${tk()}.</p>
      <ol class="loop big">
        <li><i>🚀</i><b>Launch a coin</b><small>on pump.fun, from your wallet</small></li>
        <li><i>🔥</i><b>Generate fees</b><small>${fee} SOL Ignition Fee + creator fees</small></li>
        <li><i>💱</i><b>Buy ${tk()}</b><small>within a minute</small></li>
        <li><i>🕯️</i><b>Burn ${tk()}</b><small>gone from circulation</small></li>
      </ol>
      <ol class="how">
        <li><b>Strike a match = launch a coin.</b> Name, ticker, image, socials: your coin is created on pump.fun, signed
          by your own wallet. You are its creator and you keep its pump.fun creator fees.</li>
        <li><b>The Ignition Fee.</b> A ${fee} SOL fee that belongs to WICK (it is not a pump.fun fee), signed together with
          your launch. WICK uses it to buy ${tk()} and burns what it bought, within a minute.</li>
        <li><b>The breath.</b> Every ${span(b?.durationMs ?? 1_800_000)} at most, the creator fees of ${tk()} itself buy
          ${tk()} back and burn it. Every launch brings the next one ${span(b?.matchMs ?? 60_000)} closer.</li>
        <li><b>The candle is the supply.</b> One candle = ${c?.stepPct ?? 0.5}% of the ${tk()} supply. It melts with every
          burn and never comes back. Fully melted, it enters the Hall of Flames, and the next season starts.</li>
        <li><b>Your flames.</b> Coins launched by a ${tk()} holder burn in gold. Creators climb the Pyromaniacs
          leaderboard and unlock achievements.</li>
      </ol>
      <div class="note"><b>Everything is on-chain.</b> Every burn has its Solscan link, and the supply is read from
        Solana. Your keys stay yours: the site never sees them, and every transaction shows up in your wallet before you sign.</div>
      <p class="muted small">Burning removes ${tk()} from circulation. It is a mechanism of the protocol, not a promise about
        the price. ${tk()} is a meme coin. Coins launched here are made by their creators, not by WICK. Nothing here is
        financial advice.</p>
      <div class="wallets row"><button class="wbtn primary" id="how-strike">Strike a match</button><button class="wbtn" id="how-token">See ${tk()}</button></div>`, 'm-how m-wide');
    $('how-strike').addEventListener('click', onStrike);
    $('how-token').addEventListener('click', onToken);
  }

  // Sur téléphone : toutes les pages dans un menu.
  function menu(go) {
    const items = [['explore', '🧭 Explore'], ['wick', `🕯️ ${tk()}`], ['dashboard', '🔥 Dashboard'], ['leaderboard', '🏆 Leaderboard'],
      ['hall', '🏛️ Hall of Flames'], ['flames', '✨ Your flames'], ['how', '❓ How it works']];
    openModal(`<h2>WICK</h2><div class="wallets">${items.map(([k, label]) => `<button class="wbtn" data-menu="${k}">${label}</button>`).join('')}</div>`, 'm-menu');
    document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => go(b.dataset.menu)));
  }

  return { explore, flames, dashboard, leaderboard, how, menu };
}
