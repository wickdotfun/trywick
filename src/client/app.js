// Le site : la bougie géante, ses allumettes, le fil, et le bouton pour en frapper une.
import { createDemo } from './demo.js';
import { createScene, headColor } from './scene.js';

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo');
const POLL_MS = DEMO ? 1500 : 4000;
const HEAT_FULL = 25;          // 25 coins en 10 minutes : la flamme est à fond

const api = DEMO ? createDemo() : {
  async state(since = 0, markets = false) {
    const res = await fetch(`/api/state?since=${since}${markets ? '&markets=1' : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async leaderboard() {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};

// ------------------------------------------------------------ petits outils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
const fmt = (n) => n.toLocaleString('en-US');
const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const sol = (n) => `${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: n >= 10 ? 1 : 2 })} SOL`;
// Une durée lisible : « 1 minute », « 30 minutes », « 6 seconds ».
function span(ms) {
  if (ms >= 60_000) { const m = Math.round(ms / 6_000) / 10; return `${m} ${m === 1 ? 'minute' : 'minutes'}`; }
  const s = Math.round(ms / 1000);
  return `${s} ${s === 1 ? 'second' : 'seconds'}`;
}
const solscan = (sig) => `https://solscan.io/tx/${sig}`;
const pumpUrl = (mint) => `https://pump.fun/coin/${mint}`;

function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function avatar(m, size = 34) {
  const color = headColor(m.mint, m.holder);
  const safe = m.image && /^(https:|blob:)/.test(m.image) ? m.image : null;
  const initials = esc((m.symbol || '?').slice(0, 2));
  return `<span class="av" style="--c:${color};width:${size}px;height:${size}px">${
    safe ? `<img src="${esc(safe)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''
  }<b>${initials}</b></span>`;
}

function toast(html, ms = 4200) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}

// ------------------------------------------------------------ la scène
let scene = null;
function startScene() {
  try {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('no webgl');
    scene = createScene($('stage'), { onFrame: drawLabels });
  } catch (err) {
    console.warn('3D unavailable', err);
    document.body.classList.add('no-webgl');
  }
}

// ------------------------------------------------------------ état
const world = {
  candle: null,              // la bougie de $WICK : { number, melted, burnedPct, stepPct, startedAt }
  breath: null,              // le souffle : le compte à rebours du prochain buyback
  matches: [],               // les allumettes en orbite, de la plus ancienne à la plus récente
  history: [],               // les buybacks (un par souffle)
  burns: [],                 // le journal des burns, du plus récent au plus ancien
  hall: [],                  // la salle des bougies consumées
  hot: [],                   // les coins WICK les plus chauds
  totals: { burned: 0, supplyPct: null },
  buyback: { live: false, potSol: null },
  clock: 0,                  // l'écart entre l'horloge du serveur et la nôtre
  heat: 0,
  token: null,
  launch: null,
  lastSeq: 0,
  ready: false,
  fresh: new Map(),          // mint → moment d'arrivée (étiquettes à l'écran)
  mine: new Set(),           // les allumettes frappées depuis ce navigateur
};
const ticker = () => esc(world.token?.ticker || 'WICK');
const pct = (n) => `${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 1)}%`;
const burnKey = (b) => `${b.kind}:${b.ref}`;

// Le souffle, recalculé chaque seconde avec l'horloge du serveur.
function breathNow() {
  const b = world.breath;
  const now = Date.now() + world.clock;
  const burned = Math.max(0, now - b.startedAt) + b.matches * b.matchMs;
  return { remaining: Math.max(0, b.durationMs - burned) };
}

function clockText(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function renderMeter() {
  const c = world.candle, b = world.breath;
  if (!c || !b) return;
  const p = breathNow();
  const live = world.buyback.live && !world.buyback.paused;
  const off = span(b.matchMs);
  const fee = world.launch?.feeSol || 0;
  $('candle-no').textContent = `#${c.number}`;
  $('candle-melt').textContent = `${Math.floor(c.melted * 100)}% melted`;
  $('bar').style.width = `${(c.melted * 100).toFixed(2)}%`;
  $('supply-pct').textContent = pct(c.burnedPct);
  $('supply-label').textContent = `of $${world.token?.ticker || 'WICK'} burned forever`;
  $('count-label').textContent = p.remaining > 0
    ? (live ? 'Next buyback in' : world.buyback.paused ? 'Buybacks paused · next breath in' : 'Next breath in')
    : (live ? `Buying back $${world.token?.ticker || 'WICK'}…` : 'Breathing…');
  $('countdown').textContent = clockText(p.remaining);
  $('countdown').classList.toggle('hot', p.remaining < 60_000);
  $('meter-sub').innerHTML = live
    ? `Every coin launched here burns <b>${fee ? `${fee} SOL of $${ticker()}` : `$${ticker()}`}</b> right away and brings the buyback <b>${off}</b> closer.`
    : world.buyback.paused
      ? 'Buybacks are paused for now. The candle waits.'
      : `The candle melts once $${ticker()} is live: every buyback and every launch will burn it.`;
  $('cta-sub').innerHTML = fee
    ? `Launch your coin on pump.fun · <b>${fee} SOL of $${ticker()} burned</b> with it`
    : 'Launch your coin on pump.fun · it joins the orbit';
  document.querySelectorAll('[data-t="match"]').forEach((el) => { el.textContent = off; });
  document.querySelectorAll('[data-t="step"]').forEach((el) => { el.textContent = `${c.stepPct}%`; });
  document.querySelectorAll('[data-t="fee-line"]').forEach((el) => {
    el.textContent = fee ? `Its ${fee} SOL launch fee buys back $${world.token?.ticker || 'WICK'} and burns it within a minute`
      : 'Once $WICK is live, its launch fee buys back $WICK and burns it within a minute';
  });
  if (!scene?.burning) scene?.setCandle({ melted: c.melted, heat: world.heat / HEAT_FULL });
  if (document.body.classList.contains('no-webgl')) {
    $('css-candle').style.setProperty('--h', `${Math.max(4, (1 - c.melted) * 100)}%`);
  }
}

function renderStats() {
  const t = world.totals, b = world.buyback;
  $('st-burned-label').textContent = `$${world.token?.ticker || 'WICK'} burned`;
  $('st-burned').textContent = t.burned ? compact(t.burned) : '0';
  $('st-pot').textContent = b.live && b.potSol != null ? sol(b.potSol) : 'soon';
  $('st-candles').textContent = fmt((world.candle?.number ?? 1) - 1);
}

function historyLine(h) {
  const link = (sig, text) => (sig ? `<a href="${solscan(esc(sig))}" target="_blank" rel="noopener">${text}</a>` : text);
  let what;
  if (h.status === 'burned' && h.burned > 0) {
    what = `${sol(h.buySol)} → ${link(h.burnSig, `<b>${compact(h.burned)} $${ticker()}</b> burned 🔥`)}`;
  } else if (h.note === 'not_live' || (h.status === 'ended' && !world.buyback.live)) {
    what = 'no buyback yet';
  } else if (h.note === 'paused' || (h.status === 'ended' && world.buyback.paused)) {
    what = 'buyback paused, pot carried over';
  } else if (['ended', 'buying', 'bought', 'burning_tx'].includes(h.status)) {
    what = '<span class="pulse-text">buyback in progress…</span>';
  } else if (h.note === 'empty_pot') {
    what = 'pot too small, carried over';
  } else {
    what = 'buyback missed, pot carried over';
  }
  return `<li><span class="mono">#${h.number}</span><span>${what}</span></li>`;
}

function feedItem(m) {
  const tags = [
    m.holder ? '<i class="tag gold" title="Launched by a $WICK holder">👑</i>' : '',
    m.burned > 0 ? `<i class="tag fire" title="$WICK burned by this launch">🔥 ${compact(m.burned)}</i>` : '',
  ].join('');
  return `<li class="fi${world.mine.has(m.mint) ? ' mine' : ''}${m.holder ? ' holder' : ''}">
    <a href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">
      ${avatar(m)}
      <span class="fi-main"><b>$${esc(m.symbol)} ${tags}</b><span>${esc(m.name)}</span></span>
      <span class="fi-meta"><span class="mono">${m.mcap ? `$${compact(m.mcap)}` : `#${fmt(m.seq)}`}</span><time data-at="${m.at}">${ago(m.at)}</time></span>
    </a></li>`;
}

function renderFeed() {
  const items = world.matches.slice(-40).reverse();
  $('feed').innerHTML = items.length
    ? items.map(feedItem).join('')
    : '<li class="fi-empty">No match on this candle yet.<br>Strike the first one.</li>';
  $('finals').hidden = !world.history.length;
  $('finals-list').innerHTML = world.history.slice(0, 8).map(historyLine).join('');
}

function renderToken() {
  const t = world.token;
  if (!t) return;
  const btn = $('wick-btn');
  btn.textContent = `$${t.ticker}`;
  btn.hidden = !t.mint;
  if (t.mint) btn.href = pumpUrl(t.mint);
  if (t.x) $('x-link').href = t.x;
}

// Les nouveaux burns : une notification pour chacun (pas au premier chargement).
function mergeBurns(data, first) {
  const list = data.burns?.list || [];
  if (data.burns?.full) {
    world.burns = list;
    return;
  }
  const known = new Set(world.burns.map(burnKey));
  const fresh = list.filter((b) => !known.has(burnKey(b))).reverse();
  for (const b of fresh) {
    world.burns.unshift(b);
    if (first) continue;
    if (b.kind === 'match') {
      toast(`<span>🔥 <b>$${esc(b.symbol || '?')}</b>'s launch burned <b>${compact(b.burned)} $${ticker()}</b></span>`, 6000);
      const m = world.matches.find((x) => x.mint === b.ref);
      if (m) m.burned = b.burned;
    } else {
      toast(`<span>🔥 <b>Buyback #${esc(b.ref)}</b> burned <b>${compact(b.burned)} $${ticker()}</b> · ${sol(b.sol)}</span>`, 7000);
    }
    scene?.flare();
  }
}

function applyState(data, first) {
  world.token = data.token;
  world.launch = data.launch;
  world.heat = data.heat;
  world.clock = data.now - Date.now();
  world.history = data.history || [];
  world.totals = data.totals || world.totals;
  world.buyback = data.buyback || world.buyback;
  world.hot = data.hot || world.hot;
  if (data.hall) world.hall = data.hall;
  mergeBurns(data, first);

  const consumed = world.candle && data.candle.number > world.candle.number;
  const breathed = world.breath && data.breath.number !== world.breath.number;
  const known = new Set(world.matches.map((m) => m.mint));
  const incoming = data.matches.filter((m) => m.seq > world.lastSeq && !known.has(m.mint));
  world.lastSeq = Math.max(world.lastSeq, data.total);
  world.breath = data.breath;

  if (breathed && !first && world.buyback.live && !world.buyback.paused) {
    scene?.flare();
    toast(`<span>💨 <b>Buyback #${world.history[0]?.number ?? ''}</b> is buying back $${ticker()}…</span>`, 5000);
  }

  if (first || !world.candle) {
    world.candle = data.candle;
    world.matches = data.matches;
    scene?.setMatches(world.matches);
  } else if (consumed) {
    // Une bougie entière a fondu : ce palier de $WICK est brûlé pour de bon. Les allumettes
    // plongent dans la flamme, la bougie rejoint la salle, la suivante sort de la cire.
    const done = world.candle.number;
    toast(`<span>🕯️ <b>Candle #${done} consumed.</b> ${pct(data.candle.burnedPct)} of $${ticker()} burned forever.</span>`, 8000);
    world.candle = { ...world.candle, melted: 1 };
    scene?.setCandle({ melted: 1, heat: data.heat / HEAT_FULL });
    const after = () => {
      world.candle = data.candle;
      world.matches = data.matches;
      for (const m of data.matches) { scene?.addMatch(m); world.fresh.set(m.mint, performance.now()); }
      renderMeter();
      renderStats();
      renderFeed();
    };
    if (scene) scene.burnout().then(after); else after();
  } else {
    world.candle = data.candle;
    // Beaucoup d'un coup (onglet en arrière-plan) : seules les dernières arrivent en vol.
    const quiet = incoming.slice(0, -6);
    const flying = incoming.slice(-6);
    if (quiet.length) {
      world.matches.push(...quiet);
      scene?.setMatches(world.matches);
    }
    for (const m of flying) {
      world.matches.push(m);
      scene?.addMatch(m);
      world.fresh.set(m.mint, performance.now());
      if (!world.mine.has(m.mint)) toast(`${avatar(m, 22)}<span><b>$${esc(m.symbol)}</b> struck a match${m.holder ? ' 👑' : ''}</span>`);
    }
  }
  if (data.markets) applyMarkets(data.markets);
  renderMeter();
  renderStats();
  renderFeed();
  renderToken();
}

// Le marché des allumettes : elles grossissent, se rapprochent de la flamme ou pâlissent.
function applyMarkets(markets) {
  const byMint = new Map(markets.map((k) => [k.mint, k]));
  for (const m of world.matches) {
    const k = byMint.get(m.mint);
    if (k) { m.mcap = k.mcap; m.change = k.change; }
  }
  scene?.updateMarkets(markets);
}

let polling = false;
let lastMarkets = 0;
async function poll(first = false) {
  if (polling) return;
  polling = true;
  try {
    const markets = !first && Date.now() - lastMarkets > 30_000;
    if (markets) lastMarkets = Date.now();
    const data = await api.state(first ? 0 : world.lastSeq, markets);
    applyState(data, first);
    $('status').classList.remove('off');
    world.ready = true;
  } catch (err) {
    console.warn('state', err);
    $('status').classList.add('off');
  } finally {
    polling = false;
  }
}

// ------------------------------------------------------------ étiquettes et survol
const labels = new Map();
function drawLabels() {
  const now = performance.now();
  for (const [mint, at] of world.fresh) {
    const age = now - at;
    let el = labels.get(mint);
    if (age > 7000) { world.fresh.delete(mint); el?.remove(); labels.delete(mint); continue; }
    const m = world.matches.find((x) => x.mint === mint);
    const pos = scene?.screenOf(mint);
    if (!m || !pos) continue;
    if (!el) {
      el = document.createElement('div');
      el.className = `label${world.mine.has(mint) ? ' mine' : ''}`;
      el.innerHTML = `$${esc(m.symbol)}`;
      $('labels').append(el);
      labels.set(mint, el);
    }
    el.style.opacity = pos.visible ? String(Math.min(1, (7000 - age) / 800)) : '0';
    el.style.transform = `translate(${pos.x}px, ${pos.y - 18}px) translate(-50%, -100%)`;
  }
  if (hovered) placeTip();
}

let hovered = null, tipX = 0, tipY = 0;
function showTip(m, x, y) {
  hovered = m;
  tipX = x; tipY = y;
  const tip = $('tip');
  if (!m) { tip.hidden = true; document.body.style.cursor = ''; scene?.pause(false); return; }
  tip.innerHTML = `${avatar(m, 44)}
    <div><b>$${esc(m.symbol)}${m.holder ? ' 👑' : ''}</b><span>${esc(m.name)}</span>
    <small class="mono">${m.mcap ? `mcap $${compact(m.mcap)}${m.change != null ? ` · ${m.change >= 0 ? '+' : ''}${Math.round(m.change)}%` : ''} · ` : ''}by ${esc(short(m.creator))} · ${ago(m.at)}</small>
    ${m.burned > 0 ? `<small class="mono fire">🔥 burned ${compact(m.burned)} $${ticker()}</small>` : ''}</div>`;
  tip.hidden = false;
  document.body.style.cursor = 'pointer';
  scene?.pause(true);
  placeTip();
}
function placeTip() {
  const pos = scene?.screenOf(hovered.mint);
  const tip = $('tip');
  const x = pos?.visible ? pos.x : tipX, y = pos?.visible ? pos.y : tipY;
  tip.style.transform = `translate(${Math.min(innerWidth - tip.offsetWidth - 12, x + 16)}px, ${Math.max(12, y - tip.offsetHeight - 14)}px)`;
}

function wirePointer() {
  const stage = $('stage');
  stage.addEventListener('pointermove', (e) => {
    if (!scene || e.pointerType === 'touch') return;
    const r = stage.getBoundingClientRect();
    const m = scene.pick(e.clientX - r.left, e.clientY - r.top);
    if (m?.mint !== hovered?.mint) showTip(m, e.clientX, e.clientY);
  });
  stage.addEventListener('pointerleave', () => showTip(null));
  let down = null;
  stage.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  stage.addEventListener('pointerup', (e) => {
    if (!scene || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = stage.getBoundingClientRect();
    const m = scene.pick(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch' ? 34 : 24);
    if (e.pointerType === 'touch') { showTip(m, e.clientX, e.clientY); return; }
    if (m) window.open(pumpUrl(m.mint), '_blank', 'noopener');
  });
  $('tip').addEventListener('click', () => { if (hovered) window.open(pumpUrl(hovered.mint), '_blank', 'noopener'); });
}

// ------------------------------------------------------------ fenêtres
const modal = $('modal');
function openModal(html, cls = '') {
  $('modal-body').innerHTML = html;
  modal.className = `modal ${cls}`;
  if (!modal.open) modal.showModal();
}
modal.addEventListener('click', (e) => { if (e.target === modal && !busy) modal.close(); });
modal.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });

function howItWorks() {
  const b = world.breath, c = world.candle;
  const fee = world.launch?.feeSol || 0.02;
  openModal(`
    <h2>How it works</h2>
    <ol class="how">
      <li><b>The candle is $${ticker()}.</b> It melts as $${ticker()} is burned, and it never comes back.
        One candle = ${c?.stepPct ?? 0.5}% of the supply. When it's fully consumed, that slice of $${ticker()} is gone
        forever: the candle joins the hall and the next one is lit.</li>
      <li><b>Strike a match = launch a coin.</b> Pick a name, a ticker and an image: your coin is created on
        pump.fun, signed by your own wallet. You are its creator.</li>
      <li><b>Every launch burns $${ticker()}.</b> A ${fee} SOL launch fee, signed with your launch, buys back
        $${ticker()} and burns it within a minute.</li>
      <li><b>The breath: a buyback every ${span(b?.durationMs ?? 1_800_000)} at most.</b> The $${ticker()} creator fees buy back
        and burn $${ticker()}. Every launch brings the next one ${span(b?.matchMs ?? 60_000)} closer.</li>
      <li><b>Living matches.</b> Coins that pump grow and move closer to the flame. Coins launched by a $${ticker()}
        holder burn in gold. The best creators climb the Pyromaniacs leaderboard.</li>
    </ol>
    <div class="note">
      <b>Everything is on-chain.</b> Every buyback and every burn has its Solscan link. Your keys stay yours: the
      site never sees them, and every transaction shows up in your wallet before you sign.
    </div>
    <p class="muted small">WICK is a meme. Coins launched here are made by their creators, not by WICK.
    Nothing here is financial advice.</p>`, 'm-how');
}

// ------------------------------------------------------------ le suivi des burns
// La courbe du $WICK brûlé, cumulé dans le temps : une seule série (une aire, une ligne de 2 px),
// un réticule qui suit la souris, et la liste des burns en dessous comme tableau.
function burnChart(list) {
  const pts = [...list].filter((b) => b.at && b.burned > 0).sort((a, b) => a.at - b.at);
  if (pts.length < 2) return '<p class="muted chart-empty">The chart starts with the first burns.</p>';
  let total = 0;
  const series = pts.map((b) => ({ at: b.at, total: (total += b.burned), b }));
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
  const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `<div class="chart" id="burn-chart" data-points='${JSON.stringify(series.map((p) => [x(p.at), y(p.total), p.at, p.total]))}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="$WICK burned over time, ${compact(total)} in total">
      ${ticks}
      <path class="area" d="${area}"/>
      <path class="line" d="${line}"/>
      <circle class="end" cx="${x(x1)}" cy="${y(total)}" r="4"/>
      <text class="axis" x="${L}" y="${H - 6}">${day(x0)}</text>
      <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${day(x1)}</text>
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
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - vx) < Math.abs(best[0] - vx)) best = p;
    $('cross').setAttribute('x1', best[0]); $('cross').setAttribute('x2', best[0]);
    $('cross').setAttribute("visibility", "visible");
    $('cross-dot').setAttribute('cx', best[0]); $('cross-dot').setAttribute('cy', best[1]);
    tip.hidden = false;
    tip.innerHTML = `<b>${compact(best[3])} $${ticker()}</b><span>${new Date(best[2]).toLocaleString()}</span>`;
    const left = (best[0] / svg.viewBox.baseVal.width) * r.width;
    tip.style.left = `${Math.min(r.width - 150, Math.max(0, left - 70))}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; $('cross').setAttribute("visibility", "hidden"); $('cross-dot').setAttribute('cx', -10); });
}

function burnTracker() {
  const t = world.totals, c = world.candle;
  const rows = world.burns.slice(0, 60).map((b) => `<tr>
    <td>${b.kind === 'match' ? `🔥 Launch <b>$${esc(b.symbol || '?')}</b>` : `💨 Buyback #${esc(b.ref)}`}</td>
    <td class="num">${sol(b.sol)}</td>
    <td class="num"><b>${compact(b.burned)}</b></td>
    <td class="num">${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">${ago(b.at)} ↗</a>` : ago(b.at)}</td></tr>`).join('');
  openModal(`
    <h2>🔥 Burn tracker</h2>
    <div class="bt-hero">
      <div><strong>${compact(t.burned || 0)}</strong><span>$${ticker()} burned</span></div>
      <div><strong>${t.supplyPct != null ? pct(t.supplyPct) : '—'}</strong><span>of the supply, forever</span></div>
      <div><strong>${fmt((c?.number ?? 1) - 1)}</strong><span>candles consumed</span></div>
    </div>
    <p class="muted small">Candle #${c?.number ?? 1} is ${Math.floor((c?.melted ?? 0) * 100)}% melted. One candle = ${c?.stepPct ?? 0.5}% of the $${ticker()} supply.</p>
    <h3 class="m-sub">$${ticker()} burned over time</h3>
    ${burnChart(world.burns)}
    <h3 class="m-sub">Every burn</h3>
    ${rows ? `<div class="scroll"><table class="bt-table"><thead><tr><th>What</th><th class="num">SOL</th><th class="num">$${ticker()} burned</th><th class="num">When</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="muted">No burn yet. ${world.buyback.live ? 'The first one is coming.' : `Burns start once $${ticker()} is live.`}</p>`}`, 'm-wide');
  wireChart();
}

// ------------------------------------------------------------ classements
async function leaderboardModal(tab = 'pyro') {
  const tabs = [['pyro', 'Pyromaniacs'], ['hot', 'Hottest coins'], ['hall', 'Candle hall']];
  const head = `<h2>Leaderboard</h2><div class="tabs">${tabs.map(([k, label]) => `<button class="tab${k === tab ? ' on' : ''}" data-tab="${k}">${label}</button>`).join('')}</div>`;
  let body = '<p class="muted">Loading…</p>';
  openModal(head + `<div id="board-body">${body}</div>`, 'm-wide');
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => leaderboardModal(b.dataset.tab)));
  if (tab === 'pyro') {
    try {
      const { pyromaniacs } = await api.leaderboard();
      body = pyromaniacs.length ? `<p class="muted small">Creators ranked by the $${ticker()} their launches burned. Titles: Spark (1 launch), Firestarter (3), Arsonist (10), Pyromaniac (25).</p>
        <ol class="board">${pyromaniacs.map((r) => `<li${r.holder ? ' class="holder"' : ''}>
          <span class="rank">${r.rank}</span>
          <span class="who"><b>${esc(short(r.creator))}${r.holder ? ' 👑' : ''}</b><em>${esc(r.title)}</em></span>
          <span class="stat">${fmt(r.launches)} <small>launch${r.launches === 1 ? '' : 'es'}</small></span>
          <span class="stat">${compact(r.burned)} <small>$${ticker()}</small></span>
          <span class="stat best">${r.best ? `<a href="${pumpUrl(esc(r.best.mint))}" target="_blank" rel="noopener">$${esc(r.best.symbol)}</a>${r.best.mcap ? ` <small>$${compact(r.best.mcap)}</small>` : ''}` : ''}</span>
        </li>`).join('')}</ol>` : '<p class="muted">No creator yet. Strike the first match and take the top spot.</p>';
    } catch {
      body = '<p class="muted">Could not load the leaderboard. Try again in a moment.</p>';
    }
  } else if (tab === 'hot') {
    body = world.hot.length ? `<p class="muted small">WICK coins with the highest market cap launched in the last 24 hours.</p>
      <ol class="board">${world.hot.map((m, i) => `<li${m.holder ? ' class="holder"' : ''}>
        <span class="rank">${i + 1}</span>${avatar(m, 30)}
        <span class="who"><b><a href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">$${esc(m.symbol)}</a>${m.holder ? ' 👑' : ''}</b><em>${esc(m.name)}</em></span>
        <span class="stat">$${compact(m.mcap)} <small>mcap</small></span>
        <span class="stat ${m.change >= 0 ? 'up' : 'down'}">${m.change != null ? `${m.change >= 0 ? '+' : ''}${Math.round(m.change)}%` : ''}</span>
      </li>`).join('')}</ol>` : '<p class="muted">No coin with a market yet. Market caps come from DexScreener once a coin trades.</p>';
  } else {
    body = world.hall.length ? `<p class="muted small">Every consumed candle: ${world.candle?.stepPct ?? 0.5}% of the $${ticker()} supply, burned forever.</p>
      <ol class="hall">${world.hall.map((h) => `<li>
        <span class="hall-candle" aria-hidden="true"></span>
        <span class="who"><b>Candle #${h.number}</b><em>${new Date(h.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</em></span>
        <span class="stat">${pct(h.pct)} <small>burned</small></span>
        <span class="stat">${fmt(h.launches)} <small>launches</small></span>
        <span class="stat best">${h.top ? `hottest <a href="${pumpUrl(esc(h.top.mint))}" target="_blank" rel="noopener">$${esc(h.top.symbol)}</a>` : ''}</span>
      </li>`).join('')}</ol>` : `<p class="muted">No candle consumed yet. Candle #${world.candle?.number ?? 1} is ${Math.floor((world.candle?.melted ?? 0) * 100)}% melted.</p>`;
  }
  const el = $('board-body');
  if (el) el.innerHTML = body;
}

// ------------------------------------------------------------ frapper une allumette
const ERRORS = {
  bad_name: 'Give your coin a name (32 characters max).',
  bad_symbol: 'Ticker: letters and numbers only, 10 max.',
  bad_description: 'Description: 500 characters max.',
  bad_twitter: 'X link: must start with https://',
  bad_telegram: 'Telegram link: must start with https://',
  bad_website: 'Website: must start with https://',
  bad_dev_buy: 'Dev buy: between 0 and 5 SOL.',
  no_image: 'Add an image for your coin.',
  bad_image_type: 'Image: PNG, JPG, GIF or WEBP.',
  image_too_big: 'Image too big (1.5 MB max).',
  too_many: 'Too many launches from here. Try again in an hour.',
  ipfs_failed: "pump.fun didn't take the image. Try again in a moment.",
  build_failed: "pump.fun couldn't build the transaction. Try again in a moment.",
  rejected: 'Cancelled in your wallet. Nothing was sent.',
  expired: 'The transaction expired before it was signed. Try again.',
  no_funds: 'Not enough SOL in your wallet.',
  tx_failed: 'The transaction failed on Solana. Try again.',
  send_failed: "Couldn't reach Solana. Try again.",
  mint_taken: 'Something got mixed up. Try again.',
  no_fee_tx: 'The launch fee was not signed. Try again and approve both in your wallet.',
  bad_fee_tx: 'The launch fee did not check out. Try again.',
  unsigned: 'Your wallet did not sign everything. Try again.',
};

let busy = false;
let draft = { fields: {}, image: null, preview: null };

function launchForm(error = '') {
  const f = draft.fields;
  const max = world.launch?.maxDevBuy ?? 5;
  openModal(`
    <h2>Strike a match</h2>
    <p class="muted">Launch a real coin on pump.fun. It joins the orbit around the $${ticker()} candle${world.launch?.feeSol ? ` and burns $${ticker()} right away` : ''}.</p>
    <form id="launch-form" novalidate>
      <div class="lf-top">
        <label class="drop">
          <input type="file" id="lf-image" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
          <span id="drop-view">${draft.preview ? `<img src="${draft.preview}" alt="">` : '＋<small>Image</small>'}</span>
        </label>
        <div class="lf-col">
          <label>Name<input name="name" maxlength="32" autocomplete="off" placeholder="Wick Cat" value="${esc(f.name)}"></label>
          <label>Ticker<input name="symbol" maxlength="11" autocomplete="off" placeholder="WCAT" value="${esc(f.symbol)}" class="mono up-case"></label>
        </div>
      </div>
      <label><span>Description <em>· optional</em></span><textarea name="description" maxlength="500" rows="2">${esc(f.description)}</textarea></label>
      <details${f.twitter || f.telegram || f.website ? ' open' : ''}><summary>Links <em>· optional</em></summary>
        <label>X<input name="twitter" type="url" placeholder="https://x.com/…" value="${esc(f.twitter)}"></label>
        <label>Telegram<input name="telegram" type="url" placeholder="https://t.me/…" value="${esc(f.telegram)}"></label>
        <label>Website<input name="website" type="url" placeholder="https://…" value="${esc(f.website)}"></label>
      </details>
      <label><span>Dev buy <em>· optional, buy your own coin at launch</em></span>
        <span class="sol"><input name="devBuy" type="number" min="0" max="${max}" step="0.01" value="${esc(f.devBuy ?? '0')}"><b>SOL</b></span>
      </label>
      <div class="presets">${[0, 0.1, 0.5, 1].map((v) => `<button type="button" data-sol="${v}">${v}</button>`).join('')}</div>
      <p class="cost">${world.launch?.feeSol
        ? `≈ 0.02 SOL to create + <b>${world.launch.feeSol} SOL launch fee, burned as $${ticker()}</b> + network fees + dev buy. One signature.`
        : '≈ 0.02 SOL to create + network fees + dev buy.'} Your wallet signs, your coin, your creator fees.</p>
      <p class="error" id="lf-error"${error ? '' : ' hidden'}>${esc(error)}</p>
      <button class="cta wide" type="submit">${DEMO ? 'Strike (demo)' : 'Connect wallet & strike'}</button>
    </form>`, 'm-launch');

  const form = $('launch-form');
  $('lf-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      draft.image = await prepareImage(file);
      draft.preview = URL.createObjectURL(draft.image);
      $('drop-view').innerHTML = `<img src="${draft.preview}" alt="">`;
    } catch {
      showFormError('That image could not be read.');
    }
  });
  form.querySelectorAll('[data-sol]').forEach((b) => b.addEventListener('click', () => { form.devBuy.value = b.dataset.sol; }));
  form.addEventListener('input', () => { draft.fields = Object.fromEntries(new FormData(form)); });
  form.addEventListener('submit', (e) => { e.preventDefault(); submitLaunch(form); });
}

function showFormError(msg) {
  const el = $('lf-error');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

// L'image : recadrée au carré et réduite à 512 px (les GIF restent tels quels, pour l'animation).
async function prepareImage(file) {
  if (file.type === 'image/gif') {
    if (file.size > 1_500_000) throw new Error('too big');
    return file;
  }
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(512, side);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  let blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (blob.size > 900_000) blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return new File([blob], blob.type === 'image/png' ? 'image.png' : 'image.jpg', { type: blob.type });
}

function checkForm(fields) {
  const symbol = (fields.symbol || '').trim().replace(/^\$/, '');
  if (!fields.name?.trim()) return ERRORS.bad_name;
  if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) return ERRORS.bad_symbol;
  if (!draft.image) return ERRORS.no_image;
  for (const k of ['twitter', 'telegram', 'website']) {
    if (fields[k] && !/^https:\/\//i.test(fields[k].trim())) return ERRORS[`bad_${k}`];
  }
  const d = Number(fields.devBuy || 0);
  if (!(d >= 0 && d <= (world.launch?.maxDevBuy ?? 5))) return ERRORS.bad_dev_buy;
  return null;
}

const STEPS = [
  ['upload', 'Sending your image to pump.fun'],
  ['sign', 'Sign in your wallet'],
  ['send', 'Sending to Solana'],
  ['confirm', 'Lighting your match'],
];
function progress(symbol) {
  openModal(`
    <h2>Striking <span class="grad">$${esc(symbol)}</span></h2>
    <ol class="steps">${STEPS.map(([k, t]) => `<li data-step="${k}">${t}</li>`).join('')}</ol>
    <p class="muted small">Keep this window open.</p>`, 'm-progress');
}
function setStep(step) {
  const i = STEPS.findIndex(([k]) => k === step);
  document.querySelectorAll('.steps li').forEach((li, j) => {
    li.classList.toggle('done', j < i);
    li.classList.toggle('now', j === i);
  });
}

async function chooseWallet(mod) {
  const wallets = mod.findWallets();
  if (wallets.length === 1) return wallets[0];
  if (!wallets.length) {
    const here = encodeURIComponent(location.href);
    const ref = encodeURIComponent(location.origin);
    openModal(`
      <h2>No Solana wallet found</h2>
      <p class="muted">You need a Solana wallet to launch a coin.</p>
      <div class="wallets">
        <a class="wbtn" href="https://phantom.app/ul/browse/${here}?ref=${ref}">Open in Phantom</a>
        <a class="wbtn" href="https://solflare.com/ul/v1/browse/${here}?ref=${ref}">Open in Solflare</a>
      </div>
      <button class="link-btn" id="back-form">Back</button>`, 'm-wallet');
    $('back-form').addEventListener('click', () => launchForm());
    return null;
  }
  return new Promise((resolve) => {
    openModal(`<h2>Choose a wallet</h2><div class="wallets">${
      wallets.map((w, i) => `<button class="wbtn" data-w="${i}">${esc(w.name)}</button>`).join('')
    }</div>`, 'm-wallet');
    document.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => resolve(wallets[Number(b.dataset.w)])));
    modal.addEventListener('close', () => resolve(null), { once: true });
  });
}

async function submitLaunch(form) {
  const fields = Object.fromEntries(new FormData(form));
  fields.symbol = (fields.symbol || '').trim().replace(/^\$/, '').toUpperCase();
  draft.fields = fields;
  const problem = checkForm(fields);
  if (problem) { showFormError(problem); return; }

  let mod = null, wallet = null, creator = null;
  if (!DEMO) {
    form.querySelector('[type=submit]').disabled = true;
    try {
      mod = await import('./wallet.js');
    } catch {
      showFormError('Could not load the wallet code. Check your connection.');
      form.querySelector('[type=submit]').disabled = false;
      return;
    }
    wallet = await chooseWallet(mod);
    if (!wallet) return;
    try {
      creator = await mod.connect(wallet);
    } catch {
      launchForm('Wallet connection cancelled.');
      return;
    }
  }

  busy = true;
  progress(fields.symbol);
  try {
    const run = DEMO ? api.launch : mod.strike;
    const result = await run({ wallet, creator, fields, image: draft.image, onStep: setStep });
    busy = false;
    const m = result.match;
    draft = { fields: {}, image: null, preview: null };
    if (m) {
      world.mine.add(m.mint);
      await poll();
      if (!world.matches.some((x) => x.mint === m.mint)) {
        world.matches.push(m);
        scene?.addMatch(m);
        world.fresh.set(m.mint, performance.now());
      }
      success(m, result.signature);
    } else {
      openModal(`
        <h2>Almost there</h2>
        <p class="muted">Your transaction was sent but Solana hasn't confirmed it yet. Your match will light up
        on its own as soon as it does.</p>
        ${result.signature ? `<a class="wbtn" href="https://solscan.io/tx/${esc(result.signature)}" target="_blank" rel="noopener">See it on Solscan</a>` : ''}`, 'm-done');
    }
  } catch (err) {
    busy = false;
    if (err.code === 'mint_taken') mod?.resetMint();
    launchForm(ERRORS[err.code] || 'Something went wrong. Try again.');
  }
}

function success(m, signature) {
  const share = `I just launched $${m.symbol} on WICK: every launch burns $${world.token?.ticker || 'WICK'} 🕯️🔥\n${location.origin}`;
  openModal(`
    <div class="lit">${avatar(m, 72)}</div>
    <h2><span class="grad">$${esc(m.symbol)}</span> is lit</h2>
    <p class="muted">Match #${fmt(m.seq)} is orbiting candle #${world.candle?.number ?? 1}${world.launch?.feeSol
      ? `, and its ${world.launch.feeSol} SOL fee is buying back $${ticker()} to burn it right now` : ''}. The next buyback just came
    ${span(world.breath?.matchMs ?? 60_000)} closer. Look for the label.</p>
    <div class="wallets">
      <a class="wbtn primary" href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">See it on pump.fun</a>
      <a class="wbtn" href="https://x.com/intent/post?text=${encodeURIComponent(share)}" target="_blank" rel="noopener">Share on X</a>
      ${signature ? `<a class="wbtn" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener">Transaction</a>` : ''}
    </div>`, 'm-done');
}

// ------------------------------------------------------------ première visite
function wireIntro() {
  const intro = $('intro');
  let seen = false;
  try { seen = localStorage.getItem('wick.intro') === '1'; } catch { /* pas de stockage : on l'affiche */ }
  const close = () => {
    intro.hidden = true;
    document.body.classList.remove('intro-open');
    try { localStorage.setItem('wick.intro', '1'); } catch { /* tant pis */ }
  };
  if (!seen) { intro.hidden = false; document.body.classList.add('intro-open'); }
  $('intro-close').addEventListener('click', close);
  $('intro-strike').addEventListener('click', () => { close(); launchForm(); });
}

// ------------------------------------------------------------ démarrage
function start() {
  if (DEMO) {
    $('demo-bar').hidden = false;
    $('demo-bar').innerHTML = 'Demo · a simulated, sped-up world · <a href="/">see the real candle</a>';
  }
  $('strike-btn').addEventListener('click', () => launchForm());
  wireIntro();
  $('how-btn').addEventListener('click', howItWorks);
  $('burns-btn').addEventListener('click', burnTracker);
  $('board-btn').addEventListener('click', () => leaderboardModal());
  $('finals-more').addEventListener('click', burnTracker);
  $('feed-toggle').addEventListener('click', () => document.body.classList.toggle('feed-open'));
  wirePointer();
  setInterval(() => {
    if (!document.hidden) poll();
    document.querySelectorAll('time[data-at]').forEach((t) => { t.textContent = ago(Number(t.dataset.at)); });
  }, POLL_MS);
  // Le compte à rebours, chaque seconde. À zéro, on demande plus souvent le souffle suivant.
  setInterval(() => {
    if (!world.breath || document.hidden) return;
    renderMeter();
    if (breathNow().remaining === 0 && !scene?.burning) poll();
  }, 1000);
  startScene();
  poll(true);
}

start();
