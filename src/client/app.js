// Le site : la bougie géante, ses allumettes, le fil, et le bouton pour en frapper une.
import { createCandles } from './candles.js';
import { createDemo } from './demo.js';
import { createPages } from './pages.js';
import { createScene, headColor } from './scene.js';
import * as connect from './connect.js';
import { createTokenPage, remember } from './token.js';
import { ago, aiLogo, compact, esc, fmt, icon, pumpUrl, short, sol, solscan, span } from './util.js';

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo');
const POLL_MS = DEMO ? 1500 : 4000;
const HEAT_FULL = 25;          // 25 coins en 10 minutes : la flamme est à fond

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
// Les appels POST : une erreur du serveur (« too_many »…) devient err.code.
async function post(url, body, as = 'json') {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok || !(res.headers.get('content-type') || '').startsWith(as === 'blob' ? 'image/' : 'application/json')) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.error || 'ai_failed' });
  }
  return as === 'blob' ? res.blob() : res.json();
}
const api = DEMO ? createDemo() : {
  state: (since = 0, markets = false) => get(`/api/state?since=${since}${markets ? '&markets=1' : ''}`),
  leaderboard: () => get('/api/leaderboard'),
  launches: (sort, offset = 0) => get(`/api/launches?sort=${encodeURIComponent(sort)}&offset=${offset}`),
  profile: (wallet) => get(`/api/profile?wallet=${encodeURIComponent(wallet)}`),
  token: () => get('/api/token'),
  candles: () => get('/api/candles'),
  coin: (mint) => get(`/api/coin?mint=${encodeURIComponent(mint)}`),
  // L'IA : Spark (le coin inventé par le Operator), son logo, et les questions aux Operators.
  spark: (b) => post('/api/spark', b),
  sparkImage: (b) => post('/api/spark/image', b, 'blob'),
  ask: (b) => post('/api/ask', b),
};

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
  recent: [],                // les derniers lancements, toutes bougies confondues (le fil)
  history: [],               // les buybacks (un par souffle)
  burns: [],                 // le journal des burns, du plus récent au plus ancien
  coinBurns: [],             // les burns des coins qui se brûlent eux-mêmes (« Make it burn »)
  thoughts: [],              // ce que disent les Operators (premiers mots, journal, décisions)
  hall: [],                  // la salle des bougies consumées
  hot: [],                   // les coins WICK les plus chauds
  totals: { burned: 0, supplyPct: null },
  total: 0,                  // le nombre de coins lancés
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
const pad = (n) => String(n).padStart(3, '0');
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
  const tk = `$${world.token?.ticker || 'WICK'}`;
  $('candle-no').textContent = `#${pad(c.number)}`;
  $('candle-melt').textContent = `${Math.floor(c.melted * 100)}% melted`;
  $('bar').style.width = `${(c.melted * 100).toFixed(2)}%`;
  $('supply-pct').textContent = pct(c.burnedPct);
  $('supply-label').textContent = `of the ${tk} supply burned forever`;
  $('count-label').textContent = p.remaining > 0
    ? (live ? 'Next buyback in' : world.buyback.paused ? 'Buybacks paused · next breath in' : 'Next breath in')
    : (live ? `Buying back ${tk}…` : 'Breathing…');
  $('countdown').textContent = clockText(p.remaining);
  $('countdown').classList.toggle('hot', p.remaining < 60_000);
  const from = world.launch?.shareBps && world.launch.sharedFeeSol != null ? world.launch.sharedFeeSol : fee;
  $('meter-sub').innerHTML = live
    ? `Every launch removes <b>${esc(tk)}</b> from circulation and brings the buyback <b>${off}</b> closer.`
    : world.buyback.paused
      ? 'Buybacks are paused for now. The candle waits.'
      : `The candle starts melting once ${esc(tk)} is live.`;
  $('cta-sub').innerHTML = fee
    ? `Launch a coin. Give it an Operator. Put it to work. · <b>Ignition Fee ${from < fee ? `from ${from}` : fee} SOL</b>, ${world.launch.teamSol ? 'half of it burns' : 'burns'} ${esc(tk)}`
    : 'Launch a coin. Give it an Operator. Put it to work.';
  document.querySelectorAll('[data-t="ticker"]').forEach((el) => { el.textContent = tk; });
  if (!scene?.burning) scene?.setCandle({ melted: c.melted, heat: world.heat / HEAT_FULL });
  if (document.body.classList.contains('no-webgl')) {
    $('css-candle').style.setProperty('--h', `${Math.max(4, (1 - c.melted) * 100)}%`);
  }
  tokenPage.tick();
}

function renderStats() {
  const t = world.totals;
  $('st-burned-label').textContent = `$${world.token?.ticker || 'WICK'} burned`;
  $('st-burned').textContent = t.burned ? compact(t.burned) : '0';
  $('st-sol').textContent = (t.sol || 0).toLocaleString('en-US', { maximumFractionDigits: t.sol >= 10 ? 1 : 3 });
  $('st-launches').textContent = fmt(t.launches ?? world.total ?? 0);
}

// Le fil : chaque lancement (et son Ignition Fee ajoutée au feu), chaque burn, le buyback en cours.
const shareTag = (m) => (m.candle
  ? `<i class="tag burn" title="Burns itself: ${m.candle.bps / 100}% of its creator fees buy it back and burn it, forever">burns ${m.candle.bps / 100}%</i>`
  : m.share ? `<i class="tag share" title="${esc(shareText(m.share))}">${m.share.bps / 100}% shared</i>` : '');
// « 10% of its creator fees go to WICK, forever (5% burn $WICK, 5% team) »
function shareText(s) {
  const burn = (s.bps - (s.teamBps || 0)) / 100;
  return `${s.bps / 100}% of its creator fees go to WICK, forever${s.teamBps ? ` (${burn}% burn $${ticker()}, ${s.teamBps / 100}% team)` : ''}`;
}
const holderTag = (m) => (m.holder ? `<i class="tag gold" title="Launched by a $WICK holder">${icon('crown')}</i>` : '');
function launchCard(m) {
  const fee = m.fee ?? null;
  return `<li class="ev launch${world.mine.has(m.mint) ? ' mine' : ''}${m.holder ? ' holder' : ''}">
    <a href="#coin/${esc(m.mint)}" data-coin="${esc(m.mint)}">
      ${avatar(m)}
      <span class="ev-main"><b>$${esc(m.symbol)} launched ${holderTag(m)}</b>
        <span>${fee ? `<em class="fire">+${m.burnFee ?? fee} SOL</em> added to the fire` : esc(m.name)}${m.candle ? ` · burns itself ${m.candle.bps / 100}%` : m.share ? ` · ${m.share.bps / 100}% fees shared` : ''}</span></span>
      <span class="ev-meta"><span class="mono">${m.mcap ? `$${compact(m.mcap)}` : `#${fmt(m.seq)}`}</span><time data-at="${m.at}">${ago(m.at)}</time></span>
    </a></li>`;
}

function burnCard(b) {
  const what = b.kind === 'match' ? `$${esc(b.symbol || '?')}'s Ignition Fee` : `buyback #${esc(b.ref)}`;
  const inner = `<span class="ev-ico">${icon('flame')}</span>
      <span class="ev-main"><b>${compact(b.burned)} $${ticker()} burned</b><span>${sol(b.sol)} used · ${what}</span></span>
      <span class="ev-meta">${b.sig ? '<span class="mono">TX ↗</span>' : ''}<time data-at="${b.at}">${ago(b.at)}</time></span>`;
  return `<li class="ev burn">${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">${inner}</a>` : `<div>${inner}</div>`}</li>`;
}

// Un coin qui se brûle lui-même : sa bougie a fondu.
// (Un clic ouvre la page du coin : sa bougie, ses chiffres et chacun de ses burns, avec Solscan.)
function coinBurnCard(b) {
  return `<li class="ev burn coin"><a href="#coin/${esc(b.mint)}" data-coin="${esc(b.mint)}">
      ${avatar(b)}
      <span class="ev-main"><b>${compact(b.burned)} $${esc(b.symbol || '?')} burned</b><span${b.voice ? ` class="voice" title="${esc(b.voice)}"` : ''}>${b.voice ? `“${esc(b.voice)}”` : `${sol(b.sol)} of its fees · its own candle`}</span></span>
      <span class="ev-meta"><span class="mono">${icon('candle')}</span><time data-at="${b.at}">${ago(b.at)}</time></span>
    </a></li>`;
}

// Un Operator parle : ses premiers mots, son journal du jour, ou sa décision d'attendre.
function thoughtCard(t) {
  return `<li class="ev thought"><a href="#coin/${esc(t.mint)}" data-coin="${esc(t.mint)}">
      <span class="ev-keeper">${avatar(t)}${t.keeper?.logo ? `<i class="ev-mind">${aiLogo(t.keeper, 11)}</i>` : ''}</span>
      <span class="ev-main"><b>Operator of $${esc(t.symbol || '?')}</b><span class="voice" title="${esc(t.line)}">“${esc(t.line)}”</span></span>
      <span class="ev-meta"><span class="mono">${icon('keeper')}</span><time data-at="${t.at}">${ago(t.at)}</time></span>
    </a></li>`;
}

function pendingCard() {
  const h = world.history[0];
  if (!h || !['ended', 'buying', 'bought', 'burning_tx'].includes(h.status) || !world.buyback.live || world.buyback.paused) return '';
  return `<li class="ev pending"><div><span class="ev-ico">${icon('wind')}</span>
    <span class="ev-main"><b>Buyback #${h.number}</b><span class="pulse-text">buying $${ticker()}…</span></span></div></li>`;
}

function renderFeed() {
  const events = [
    ...world.recent.map((m) => ({ at: m.at, html: () => launchCard(m) })),
    ...world.burns.slice(0, 40).map((b) => ({ at: b.at, html: () => burnCard(b) })),
    ...world.coinBurns.slice(0, 12).map((b) => ({ at: b.at, html: () => coinBurnCard(b) })),
    // Une pensée déjà dite par un burn (sa voix) n'est pas répétée.
    ...world.thoughts.filter((t) => !world.coinBurns.some((b) => b.mint === t.mint && b.voice === t.line)).slice(0, 4)
      .map((t) => ({ at: t.at, html: () => thoughtCard(t) })),
  ].sort((a, b) => b.at - a.at).slice(0, 50);
  $('feed').innerHTML = pendingCard() + (events.length
    ? events.map((e) => e.html()).join('')
    : `<li class="fi-empty">The fire is quiet.<br>Launch the first coin.</li>`);
}

function renderToken() {
  const t = world.token;
  if (!t) return;
  $('wick-btn').textContent = `$${t.ticker}`;
  if (t.x) $('x-link').href = t.x;
  if (t.telegram) $('tg-link').href = t.telegram;
}

// Le reçu d'un burn, au-dessus de la bougie : la flamme se ravive, la bougie fond.
const pops = [];
let popping = false;
function burnPop(b) {
  pops.push(b);
  if (!popping) nextPop();
}
function nextPop() {
  const b = pops.shift();
  const el = $('burn-pop');
  if (!b) { popping = false; return; }
  popping = true;
  const coin = b.kind === 'coin';
  // Le burn d'un coin qui se brûle lui-même : son logo, et un lien vers sa bougie.
  el.classList.toggle('coin', coin);
  el.innerHTML = `<strong>${coin ? avatar(b, 30) : icon('flame')} ${fmt(Math.round(b.burned))} $${coin ? esc(b.symbol || '?') : ticker()} burned</strong>
    <span>${sol(b.sol)} used · ${coin ? 'its own candle' : b.kind === 'match' ? `$${esc(b.symbol || '?')}'s Ignition Fee` : `buyback #${esc(b.ref)}`}</span>
    ${b.voice ? `<em class="pop-voice">${icon('keeper')} “${esc(b.voice)}”</em>` : ''}
    ${coin ? `<a href="#coin/${esc(b.mint)}" data-coin="${esc(b.mint)}">See its candle →</a>`
    : b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">View TX ↗</a>` : ''}`;
  el.hidden = false;
  el.classList.remove('out');
  void el.offsetWidth;
  el.classList.add('in');
  if (!coin) {
    scene?.flare();
    $('candle-card').classList.remove('melt');
    void $('candle-card').offsetWidth;
    $('candle-card').classList.add('melt');
  }
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.hidden = true; el.classList.remove('in', 'out'); nextPop(); }, 500);
  }, pops.length ? 3200 : 6000);
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
      for (const list of [world.matches, world.recent]) {
        const m = list.find((x) => x.mint === b.ref);
        if (m) m.burned = b.burned;
      }
    }
    burnPop(b);
  }
}

// Les burns des coins qui se brûlent eux-mêmes : les nouveaux s'affichent au-dessus de la bougie.
function mergeCoinBurns(data, first) {
  const key = (b) => b.sig || `${b.mint}:${b.at}`;
  const known = new Set(world.coinBurns.map(key));
  for (const b of (data.coinBurns || []).slice().reverse()) {
    if (known.has(key(b))) continue;
    world.coinBurns.unshift(b);
    if (!first) burnPop({ ...b, kind: 'coin' });
  }
  world.coinBurns.sort((a, b) => b.at - a.at);
  world.coinBurns = world.coinBurns.slice(0, 40);
}

function applyState(data, first) {
  world.token = data.token;
  world.launch = data.launch;
  world.heat = data.heat;
  world.total = data.total;
  world.clock = data.now - Date.now();
  world.history = data.history || [];
  world.totals = data.totals || world.totals;
  world.buyback = data.buyback || world.buyback;
  world.hot = data.hot || world.hot;
  if (data.hall) world.hall = data.hall;
  mergeBurns(data, first);
  mergeCoinBurns(data, first);
  if (data.thoughts) world.thoughts = data.thoughts;
  // Le fil garde les lancements d'une bougie à l'autre.
  const seen = new Set(world.recent.map((m) => m.mint));
  if (data.recent) world.recent = data.recent.slice().reverse();
  for (const m of data.matches) if (!seen.has(m.mint) && !world.recent.some((x) => x.mint === m.mint)) world.recent.push(m);
  world.recent = world.recent.slice(-40);
  if (data.markets) {
    const byMint = new Map(data.markets.map((k) => [k.mint, k]));
    for (const m of world.recent) { const k = byMint.get(m.mint); if (k) { m.mcap = k.mcap; m.change = k.change; } }
  }

  const consumed = world.candle && data.candle.number > world.candle.number;
  const breathed = world.breath && data.breath.number !== world.breath.number;
  const known = new Set(world.matches.map((m) => m.mint));
  const incoming = data.matches.filter((m) => m.seq > world.lastSeq && !known.has(m.mint));
  world.lastSeq = Math.max(world.lastSeq, data.total);
  world.breath = data.breath;

  if (breathed && !first && world.buyback.live && !world.buyback.paused) {
    scene?.flare();
    toast(`<span><b>Buyback #${world.history[0]?.number ?? ''}</b> is buying back $${ticker()}…</span>`, 5000);
  }

  if (world.burningOut) {
    // La bougie fond encore à l'écran : la suivante attend la fin de l'animation.
  } else if (first || !world.candle) {
    world.candle = data.candle;
    world.matches = data.matches;
    scene?.setMatches(world.matches);
  } else if (consumed) {
    // Une bougie entière a fondu : ce palier de $WICK est brûlé pour de bon. Les allumettes
    // plongent dans la flamme, la bougie rejoint la salle, la suivante sort de la cire.
    const done = world.candle.number;
    toast(`<span><b>Candle #${pad(done)} fully melted.</b> ${pct(data.candle.burnedPct)} of $${ticker()} burned forever. It joins the Hall of Flames.</span>`, 8000);
    world.burningOut = true;
    world.candle = { ...world.candle, melted: 1 };
    scene?.setCandle({ melted: 1, heat: data.heat / HEAT_FULL });
    const after = () => {
      world.burningOut = false;
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
      if (!world.mine.has(m.mint)) toast(`${avatar(m, 22)}<span><b>$${esc(m.symbol)}</b> launched ${holderTag(m)}</span>`);
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
    <div><b>$${esc(m.symbol)} ${holderTag(m)}</b><span>${esc(m.name)}</span>
    <small class="mono">${m.mcap ? `mcap $${compact(m.mcap)}${m.change != null ? ` · ${m.change >= 0 ? '+' : ''}${Math.round(m.change)}%` : ''} · ` : ''}by ${esc(short(m.creator))} · ${ago(m.at)}</small>
    ${m.burned > 0 ? `<small class="mono fire">${icon('flame')} burned ${compact(m.burned)} $${ticker()}</small>` : ''}</div>`;
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
  modal.scrollTop = 0;
  if (!modal.open) modal.showModal();
}
modal.addEventListener('click', (e) => { if (e.target === modal && !busy) modal.close(); });
modal.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });

const isOpen = (cls) => modal.open && modal.classList.contains(cls);
// Fermer une page enlève son adresse (#explore, #wick…) de la barre d'adresse.
modal.addEventListener('close', () => {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});

// ------------------------------------------------------------ les pages
const tokenPage = createTokenPage({
  api, openModal, isOpen, world, ticker, demo: DEMO,
  breathText: () => (world.breath ? clockText(breathNow().remaining) : '—'),
  onBurns: () => go('dashboard'),
});
const pages = createPages({
  api, openModal, isOpen, world, ticker, avatar, pct, shareTag, holderTag, demo: DEMO,
  onStrike: () => launchForm(),
  onToken: () => go('wick'),
});

const candlesPage = createCandles({
  api, openModal, world, ticker, avatar, holderTag, demo: DEMO,
  onStrike: () => launchForm(),
  go: (page) => go(page),
});

const ROUTES = {
  candles: () => candlesPage.forest(),
  explore: () => pages.explore(),
  wick: () => tokenPage.open(),
  dashboard: () => pages.dashboard(),
  burns: () => pages.dashboard(),
  leaderboard: () => pages.leaderboard(),
  hall: () => pages.leaderboard('hall'),
  flames: () => pages.flames(),
  how: () => pages.how(),
  strike: () => launchForm(),
};
const isRoute = (page) => Boolean(ROUTES[page]) || /^coin\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(page || '');
function go(page) {
  if (busy || !isRoute(page)) return;
  if (page.startsWith('coin/')) candlesPage.coin(page.slice(5));
  else ROUTES[page]();
  const hash = `#${page}`;
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
}

// ------------------------------------------------------------ frapper une allumette
// Le serveur vérifie le solde avant de faire signer : il dit combien il faut, et combien le wallet a.
function noFunds(err, what) {
  const d = err.code === 'no_funds' ? err.data : null;
  if (!(d?.needSol > 0)) return '';
  return `Not enough SOL in your wallet. ${what} needs about ${d.needSol} SOL (fees included), your wallet has ${d.haveSol ?? 0} SOL. Nothing was sent.`;
}
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
  ipfs_failed: "The image upload failed. Try again in a moment.",
  ipfs_not_configured: 'Launching is not open yet. Come back in a moment.',
  busy: 'Lots of launches right now. Try again in a few minutes.',
  build_failed: "pump.fun couldn't build the transaction. Try again in a moment.",
  rejected: 'Cancelled in your wallet. Nothing was sent.',
  expired: 'The transaction expired before it was signed. Try again.',
  no_funds: 'Not enough SOL in your wallet.',
  tx_failed: 'The transaction failed on Solana. Try again.',
  send_failed: "Couldn't reach Solana. Try again.",
  mint_taken: 'Something got mixed up. Try again.',
  no_fee_tx: 'The Ignition Fee was not signed. Try again and approve both in your wallet.',
  bad_fee_tx: 'The Ignition Fee did not check out. Try again.',
  bad_share_tx: 'The fee sharing did not check out. Try again.',
  unsigned: 'Your wallet did not sign everything. Try again.',
};

let busy = false;
// burn : « Make it burn », la part (en %) des creator fees qui rachète et brûle le coin lui-même.
const DRAFT = () => ({ fields: {}, image: null, preview: null, burn: 20, keeper: { style: 'stoic', model: 'llama' }, idea: '', spark: null });
let draft = DRAFT();


// Ce que coûte un lancement, avec ou sans partage des creator fees.
// Les parts que le créateur peut choisir (en %), 0 = pas de bougie.
const burnOptions = () => (world.launch?.selfOptions || []).map((bps) => bps / 100);
const burning = () => (burnOptions().includes(draft.burn) ? draft.burn : 0);

// La barre : où vont les creator fees du coin, selon la part choisie.
function burnSplit(pct) {
  const s = world.launch?.split || { creatorBps: 9000, burnBps: 500, teamBps: 500 };
  if (!pct) return { bar: '<span style="width:100%">You 100%</span>', legend: 'You keep 100% of your creator fees. Your candle stays unlit.' };
  const you = s.creatorBps / 100 - pct;
  return {
    bar: `<span style="width:${you}%">You ${you}%</span><span class="self" style="width:${pct}%">${pct >= 30 ? 'Burns it ' : ''}${pct}%</span>`
      + `<span class="wick" style="width:${s.burnBps / 100}%"></span><span class="team" style="width:${s.teamBps / 100}%"></span>`,
    legend: `You ${you}% · ${pct}% buys your coin back and burns it · ${s.burnBps / 100}% burns $${ticker()} · ${s.teamBps / 100}% WICK team`,
  };
}

function costLine(burnPct) {
  const l = world.launch;
  const withShare = Boolean(burnPct && l?.shareBps);
  const fee = withShare ? l.sharedFeeSol : l?.feeSol;
  const burn = withShare ? l.sharedBurnSol : l?.burnSol;
  const team = withShare ? l.sharedTeamSol : l?.teamSol;
  const split = team ? `${burn} SOL buys $${ticker()} and burns it, ${team} SOL funds the WICK team` : `buys $${ticker()} and burns it`;
  return `${fee
    ? `<b>${fee} SOL WICK Ignition Fee</b>: ${split}. Plus ≈ 0.02 SOL of pump.fun creation and network costs, and your dev buy.`
    : '≈ 0.02 SOL of pump.fun creation and network costs, plus your dev buy.'} Your wallet signs, your coin${withShare ? `, ${(l.split?.creatorBps ?? 10_000 - l.shareBps) / 100 - burnPct}% of your creator fees` : ', your pump.fun creator fees'}.`;
}

// Le Operator du coin : sa personnalité et son esprit (le modèle). Chaque coin en a un ; c'est lui
// qui invente le coin avec Spark, parle à ses holders, et (avec « Make it burn ») le brûle.
const mindOf = (id) => world.launch?.keepers?.models.find((m) => m.id === id) || world.launch?.keepers?.models[0];
function keeperBlock() {
  const k = world.launch?.keepers;
  if (!k) return '';
  return `<section class="lf-step keeper-opt" id="lf-keeper">
    <div class="lf-step-head"><span class="lf-num">1</span><b>Summon its <span class="grad">Operator</span></b>
      <small>The AI agent of your coin. It creates it with you, talks to its holders, and burns it.</small></div>
    <span class="k-label">Personality</span>
    <div class="k-styles" role="group" aria-label="Personality">${k.styles.map((s) => `<button type="button" class="k-style${draft.keeper.style === s.id ? ' on' : ''}" data-kstyle="${esc(s.id)}" aria-pressed="${draft.keeper.style === s.id}"><b>${esc(s.label)}</b><small>${esc(s.hint)}</small></button>`).join('')}</div>
    <span class="k-label">The mind <em>· open models, run free by Cloudflare</em></span>
    <div class="k-minds" role="group" aria-label="The mind">${k.models.map((m) => `<button type="button" class="k-mind${draft.keeper.model === m.id ? ' on' : ''}" data-kmodel="${esc(m.id)}" aria-pressed="${draft.keeper.model === m.id}"><i>${aiLogo(m, 18)}</i><span><b>${esc(m.name)}</b><small>${esc(m.by)}</small></span></button>`).join('')}</div>
  </section>`;
}

// Spark : une idée, et le Operator invente le coin (nom, ticker, description, logo).
function sparkBlock() {
  if (!world.launch?.keepers) return '';
  const sp = draft.spark;
  return `<section class="lf-step spark" id="lf-spark">
    <div class="lf-step-head"><span class="lf-num">2</span><b>Spark <span class="grad">an idea</span></b>
      <small>One sentence. Your Operator writes the name, the ticker, the story and paints the logo. You can change everything.</small></div>
    <div class="spark-box">
      <textarea id="sp-idea" maxlength="200" rows="2" placeholder="${esc(pick(IDEAS))}">${esc(draft.idea || '')}</textarea>
      <button type="button" class="cta spark-go" id="sp-go">${icon('sparkle')} <span>${sp ? 'Spark again' : 'Spark it'}</span></button>
    </div>
    <div class="spark-status" id="sp-status"${sp ? '' : ' hidden'}>${sp ? sparkDone(sp) : ''}</div>
  </section>`;
}
const IDEAS = ['A cat that is terrified of fire but lives in a candle shop', 'A tiny dragon who only breathes birthday candles',
  'A moth that finally caught the flame', 'A frog who runs a candle factory on Solana', 'The last ember of a burned-down casino'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function sparkDone(sp) {
  return `<div class="sp-done">
      <span class="sp-who">${aiLogo(sp.mind, 16)} <b>${esc(sp.mind?.name || 'Your Operator')}</b> wrote it${draft.image ? ' and painted the logo' : ''}.</span>
      ${sp.intro ? `<blockquote>“${esc(sp.intro)}”</blockquote>` : ''}
      <span class="sp-actions"><button type="button" class="linkish" id="sp-logo">${icon('sparkle')} New logo</button></span>
    </div>`;
}

// « Make it burn » avant $WICK : ce qui arrive, sans pouvoir le choisir.
function burnTeaser() {
  if (burnOptions().length) return '';
  return `<div class="burn-opt soon">
    <div class="burn-head"><b>Make it <span class="grad">burn</span> <span class="tag soon">${icon('lock')} unlocks with $${ticker()}</span></b>
      <small>Once $${ticker()} is live, a share of your creator fees can buy your coin back and burn it, forever. Your Operator picks the moments.</small></div>
  </div>`;
}

function launchForm(error = '') {
  const f = draft.fields;
  const max = world.launch?.maxDevBuy ?? 5;
  openModal(`
    <h2>Launch a coin <span class="grad">with its Operator</span></h2>
    <p class="muted">A real coin on pump.fun, with an AI agent of its own. It becomes a match orbiting the $${ticker()} candle${world.launch?.feeSol ? `, and ${world.launch.teamSol ? 'half of its Ignition Fee burns' : 'its Ignition Fee burns'} $${ticker()} within a minute` : ''}.</p>
    <form id="launch-form" novalidate>
      ${keeperBlock()}
      ${sparkBlock()}
      <section class="lf-step lf-coin">
      <div class="lf-step-head"><span class="lf-num">${world.launch?.keepers ? 3 : 1}</span><b>Your <span class="grad">coin</span></b>
        <small>Check it, change it, make it yours.</small></div>
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
      <label><span>Description <em>· optional</em></span><textarea name="description" maxlength="500" rows="3">${esc(f.description)}</textarea></label>
      <details${f.twitter || f.telegram || f.website ? ' open' : ''}><summary>Links <em>· optional</em></summary>
        <label>X<input name="twitter" type="url" placeholder="https://x.com/…" value="${esc(f.twitter)}"></label>
        <label>Telegram<input name="telegram" type="url" placeholder="https://t.me/…" value="${esc(f.telegram)}"></label>
        <label>Website<input name="website" type="url" placeholder="https://…" value="${esc(f.website)}"></label>
      </details>
      <label><span>Dev buy <em>· optional, buy your own coin at launch</em></span>
        <span class="sol"><input name="devBuy" type="number" min="0" max="${max}" step="0.01" value="${esc(f.devBuy ?? '0')}"><b>SOL</b></span>
      </label>
      <div class="presets">${[0, 0.1, 0.5, 1].map((v) => `<button type="button" data-sol="${v}">${v}</button>`).join('')}</div>
      ${burnOptions().length ? `<div class="burn-opt">
        <div class="burn-head"><b>Make it <span class="grad">burn</span></b>
          <small>A share of your creator fees buys your coin back and burns it, forever. Your coin becomes a candle.
          Your Ignition Fee drops to ${world.launch.sharedFeeSol} SOL.</small></div>
        <div class="burn-pills" role="group" aria-label="Make it burn">${[0, ...burnOptions()].map((v) => `<button type="button" class="pill${burning() === v ? ' on' : ''}" data-burn="${v}" aria-pressed="${burning() === v}">${v ? `${v}%` : 'Off'}</button>`).join('')}</div>
        <div class="split-bar" id="lf-split">${burnSplit(burning()).bar}</div>
        <small class="muted" id="lf-legend">${burnSplit(burning()).legend}</small>
        <small class="lock">${icon('lock')} Locked on pump.fun. Nobody can change it, not even WICK.</small>
      </div>` : ''}
      ${burnTeaser()}
      </section>
      <input type="hidden" name="burn" value="${burning()}"><input type="hidden" name="share" value="${burning() ? '1' : ''}">
      <input type="hidden" name="keeper_style" value="${esc(draft.keeper.style)}"><input type="hidden" name="keeper_model" value="${esc(draft.keeper.model)}">
      <p class="cost" id="lf-cost">${costLine(burning())}</p>
      <p class="error" id="lf-error"${error ? '' : ' hidden'}>${esc(error)}</p>
      <button class="cta wide" type="submit">${DEMO ? 'Launch (demo)' : connect.current() ? 'Launch your coin' : 'Connect wallet & launch'}</button>
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
  const pickKeeper = (attr, key) => form.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', () => {
    draft.keeper[key] = b.getAttribute(attr);
    form.querySelectorAll(`[${attr}]`).forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', String(on));
    });
    form[`keeper_${key}`].value = draft.keeper[key];
  }));
  pickKeeper('data-kstyle', 'style');
  pickKeeper('data-kmodel', 'model');
  form.querySelectorAll('[data-burn]').forEach((b) => b.addEventListener('click', () => {
    draft.burn = Number(b.dataset.burn);
    const pct = burning();
    form.querySelectorAll('[data-burn]').forEach((x) => {
      const on = Number(x.dataset.burn) === pct;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', String(on));
    });
    form.burn.value = String(pct);
    form.share.value = pct ? '1' : '';
    const split = burnSplit(pct);
    $('lf-split').innerHTML = split.bar;
    $('lf-legend').textContent = split.legend;
    $('lf-cost').innerHTML = costLine(pct);
  }));
  $('sp-go')?.addEventListener('click', () => runSpark(form));
  $('sp-idea')?.addEventListener('input', (e) => { draft.idea = e.target.value; });
  $('sp-idea')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runSpark(form); } });
  bindLogoAgain(form);
  form.addEventListener('submit', (e) => { e.preventDefault(); submitLaunch(form); });
}

// ------------------------------------------------------------ Spark
const SPARK_ERRORS = {
  bad_idea: 'Give your Operator an idea first: a few words are enough.',
  blocked_idea: "Your Operator won't make that one. Try another idea.",
  too_many: 'Lots of sparks from here. Try again in a little while.',
  ai_busy: 'The Operators have created a lot today. Come back tomorrow, or fill in your coin yourself.',
  ai_off: 'Spark is resting right now. Fill in your coin yourself, or try again later.',
  ai_failed: "Your Operator couldn't find the words. Try again, or try another mind.",
};
let sparking = false;
function sparkStatus(html, cls = '') {
  const el = $('sp-status');
  if (!el) return;
  el.hidden = false;
  el.className = `spark-status ${cls}`.trim();
  el.innerHTML = html;
}
const thinking = (mind, what) => `<span class="sp-think">${aiLogo(mind, 16)} <b>${esc(mind?.name || 'Your Operator')}</b> ${what}<i></i><i></i><i></i></span>`;

async function runSpark(form) {
  if (sparking) return;
  const idea = ($('sp-idea')?.value || '').trim();
  draft.idea = idea;
  if (idea.length < 3) { sparkStatus(SPARK_ERRORS.bad_idea, 'err'); return; }
  const mind = mindOf(draft.keeper.model);
  const btn = $('sp-go');
  sparking = true;
  btn.disabled = true;
  btn.classList.add('busy');
  sparkStatus(thinking(mind, 'is thinking'));
  try {
    const sp = await api.spark({ idea, style: draft.keeper.style, model: draft.keeper.model });
    draft.spark = sp;
    form.name.value = sp.name;
    form.symbol.value = sp.symbol;
    form.description.value = sp.description;
    for (const el of [form.name, form.symbol, form.description]) { el.classList.remove('filled'); void el.offsetWidth; el.classList.add('filled'); }
    draft.fields = Object.fromEntries(new FormData(form));
    sparkStatus(thinking(sp.mind || mind, 'is painting the logo'));
    await paintLogo(sp);
    sparkStatus(sparkDone(sp), 'done');
    bindLogoAgain(form);
  } catch (err) {
    sparkStatus(SPARK_ERRORS[err.code] || SPARK_ERRORS.ai_failed, 'err');
  } finally {
    sparking = false;
    if ($('sp-go')) {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.querySelector('span').textContent = draft.spark ? 'Spark again' : 'Spark it';
    }
  }
}

// Le logo peint par l'IA devient l'image du coin (recadré comme une image envoyée à la main).
async function paintLogo(sp) {
  const view = $('drop-view');
  view?.classList.add('painting');
  try {
    const blob = await api.sparkImage({ visual: sp.visual, name: sp.name });
    draft.image = await prepareImage(new File([blob], 'logo.png', { type: blob.type || 'image/png' }));
    draft.preview = URL.createObjectURL(draft.image);
    if ($('drop-view')) $('drop-view').innerHTML = `<img src="${draft.preview}" alt="">`;
  } catch {
    // Pas de logo cette fois : le reste est là, on peut en envoyer un.
  } finally {
    $('drop-view')?.classList.remove('painting');
  }
}

function bindLogoAgain(form) {
  $('sp-logo')?.addEventListener('click', async () => {
    if (sparking || !draft.spark) return;
    sparking = true;
    sparkStatus(thinking(draft.spark.mind || mindOf(draft.keeper.model), 'is painting a new logo'));
    await paintLogo(draft.spark);
    sparking = false;
    sparkStatus(sparkDone(draft.spark), 'done');
    bindLogoAgain(form);
  });
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

// Les étapes d'un lancement : deux signatures quand il y a une Ignition Fee (une transaction à la
// fois, le wallet d'abord : c'est ce que demande Phantom).
let STEPS = [];
function progress(symbol) {
  const fee = Boolean(world.launch?.feeSol);
  STEPS = [
    ['upload', 'Sending your image to pump.fun'],
    ['sign', fee ? 'Approve 1/2 in your wallet: create your coin' : 'Approve in your wallet: create your coin'],
    ...(fee ? [['sign2', `Approve 2/2: the Ignition Fee${burning() ? ' and your candle' : ''}`]] : []),
    ['send', 'Sending to Solana'],
    ['confirm', 'Lighting your match'],
  ];
  openModal(`
    <h2>Launching <span class="grad">$${esc(symbol)}</span></h2>
    <ol class="steps">${STEPS.map(([k, t]) => `<li data-step="${k}">${t}</li>`).join('')}</ol>
    <p class="muted small">Keep this window open. Each transaction shows up in your wallet before you sign.</p>`, 'm-progress');
}
function setStep(step) {
  const i = STEPS.findIndex(([k]) => k === step);
  document.querySelectorAll('.steps li').forEach((li, j) => {
    li.classList.toggle('done', j < i);
    li.classList.toggle('now', j === i);
  });
}

async function submitLaunch(form) {
  const fields = Object.fromEntries(new FormData(form));
  fields.symbol = (fields.symbol || '').trim().replace(/^\$/, '').toUpperCase();
  draft.fields = fields;
  const problem = checkForm(fields);
  if (problem) { showFormError(problem); return; }

  let mod = null, creator = null;
  if (!DEMO) {
    const submitBtn = form.querySelector('[type=submit]');
    submitBtn.disabled = true;
    try {
      [mod] = await Promise.all([import('./wallet.js'), connect.ensure()]);
    } catch {
      showFormError('Could not load the wallet code. Check your connection.');
      submitBtn.disabled = false;
      return;
    }
    creator = connect.current()?.address;
    submitBtn.disabled = false;
    if (!creator) { showFormError('Connect a wallet to launch your coin.'); return; }
  }

  busy = true;
  progress(fields.symbol);
  try {
    const run = DEMO ? api.launch : mod.strike;
    const result = await run({ creator, fields, image: draft.image, onStep: setStep });
    busy = false;
    const m = result.match;
    draft = DRAFT();
    if (m) {
      world.mine.add(m.mint);
      if (m.creator && !DEMO) remember(m.creator);
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
    launchForm(noFunds(err, 'This launch') || ERRORS[err.code] || 'Something went wrong. Try again.');
  }
}

function success(m, signature) {
  const share = `I just launched $${m.symbol} on WICK, the launchpad that burns itself. Every coin melts $${world.token?.ticker || 'WICK'}.\n${location.origin}`;
  openModal(`
    <div class="lit">${avatar(m, 72)}</div>
    <h2><span class="grad">$${esc(m.symbol)}</span> is lit</h2>
    <p class="muted">Match #${fmt(m.seq)} is orbiting candle #${pad(world.candle?.number ?? 1)}${world.launch?.feeSol
      ? `, and ${m.burnFee ?? (m.share ? world.launch.sharedBurnSol : world.launch.burnSol)} SOL of its Ignition Fee is buying $${ticker()} to burn it right now` : ''}.${m.share
      ? ` ${shareText(m.share)}.` : ''}${m.candle ? ` <b>Its candle burns ${m.candle.bps / 100}% of its creator fees, forever.</b>` : ''} The next buyback just came
    ${span(world.breath?.matchMs ?? 60_000)} closer. Look for the label.</p>
    <div class="wallets">
      <a class="wbtn primary" href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">See it on pump.fun</a>
      <a class="wbtn" href="https://x.com/intent/post?text=${encodeURIComponent(share)}" target="_blank" rel="noopener">Share on X</a>
      ${signature ? `<a class="wbtn" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener">Transaction</a>` : ''}
      ${m.candle ? `<a class="wbtn" href="#coin/${esc(m.mint)}" data-coin="${esc(m.mint)}">See its candle</a>` : ''}
      <button class="wbtn" id="see-flames">Your flames</button>
    </div>`, 'm-done');
  $('see-flames').addEventListener('click', () => go('flames'));
}

// ------------------------------------------------------------ démarrage
function start() {
  if (DEMO) {
    $('demo-bar').hidden = false;
    $('demo-bar').innerHTML = 'Demo · a simulated, sped-up world · <a href="/">see the real candle</a>';
  }
  $('strike-btn').addEventListener('click', () => launchForm());
  document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.go); }));
  $('menu-btn').addEventListener('click', () => pages.menu(go));
  // Le wallet : le bouton en haut, et la reconnexion silencieuse au wallet déjà autorisé.
  if (!DEMO) {
    connect.mountButton($('wallet-btn'), { onFlames: (address) => pages.flames(address) });
    connect.restore();
  } else {
    $('wallet-btn').hidden = true;
  }
  $('feed-more').addEventListener('click', () => go('explore'));
  // Un coin (dans le fil, Explore, la forêt…) : sa page, avec sa bougie.
  for (const root of [$('feed'), $('modal-body'), $('burn-pop')]) {
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-coin]');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      go(`coin/${a.dataset.coin}`);
    });
  }
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
  // Une page demandée dans l'adresse (trywick.fun/#wick…) s'ouvre une fois l'état chargé.
  const page = location.hash.slice(1);
  poll(true).then(() => { if (isRoute(page)) go(page); });
  // Un lien vers une autre page du site (#candles, #coin/…) depuis la même page l'ouvre aussi.
  window.addEventListener('hashchange', () => { const next = location.hash.slice(1); if (isRoute(next)) go(next); });
  tokenPage.prefetch();
}

start();
