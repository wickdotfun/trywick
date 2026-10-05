// Le site : la bougie géante, ses allumettes, le fil, et le bouton pour en frapper une.
import { createCandles } from './candles.js';
import { createCrew } from './crew.js';
import { createProof } from './proof.js';
import { asMind, createModels, filterModels, labCounts, loadModels, runPrice, runsFor } from './models.js';
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
  crew: () => get('/api/crew'),
  proof: () => get('/api/proof'),
  // Le compte X d'un coin : son créateur le relie (signature de son wallet, puis X).
  xStart: (b) => post('/api/x/start', b),
  xUnlink: (b) => post('/api/x/unlink', b),
  // L'IA : les questions aux agents (créer le coin se fait à la main, comme sur pump.fun).
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
  thoughts: [],              // ce que disent les agents (premiers mots, journal, décisions)
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
    ? `Launch a coin. Give it an AI agent. Let it burn. · <b>Ignition Fee ${from < fee ? `from ${from}` : fee} SOL</b>, ${world.launch.teamSol ? 'half of it burns' : 'burns'} ${esc(tk)}`
    : 'Launch a coin. Give it an AI agent. Let it burn.';
  document.querySelectorAll('[data-t="ticker"]').forEach((el) => { el.textContent = tk; });
  if (!scene?.burning) scene?.setCandle({ melted: c.melted, heat: world.heat / HEAT_FULL });
  $('css-candle')?.style.setProperty('--h', `${Math.max(4, (1 - c.melted) * 100)}%`);
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
// « 40% of its creator fees go to WICK, forever (10% burn $WICK, 20% its crew, 10% team) »
function shareText(s) {
  const burn = (s.bps - (s.teamBps || 0) - (s.crewBps || 0)) / 100;
  return `${s.bps / 100}% of its creator fees go to WICK, forever${s.teamBps || s.crewBps ? ` (${burn}% burn $${ticker()}${s.crewBps ? `, ${s.crewBps / 100}% its crew` : ''}, ${s.teamBps / 100}% team)` : ''}`;
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
      <span class="ev-main"><b>Agent of $${esc(t.symbol || '?')}</b><span class="voice" title="${esc(t.line)}">“${esc(t.line)}”</span></span>
      <span class="ev-meta"><span class="mono">${icon('keeper')}</span><time data-at="${t.at}">${ago(t.at)}</time></span>
    </a></li>`;
}

function pendingCard() {
  const h = world.history[0];
  if (!h || !['ended', 'buying', 'bought', 'burning_tx'].includes(h.status) || !world.buyback.live || world.buyback.paused) return '';
  return `<li class="ev pending"><div><span class="ev-ico">${icon('wind')}</span>
    <span class="ev-main"><b>Buyback #${h.number}</b><span class="pulse-text">buying $${ticker()}…</span></span></div></li>`;
}

// L'accueil : les agents au travail (les derniers coins, avec ce que dit leur agent).
const thoughtOf = (mint) => world.thoughts.find((t) => t.mint === mint);
function agentCard(m) {
  const t = thoughtOf(m.mint);
  const k = m.keeper || t?.keeper;
  const line = t?.line || k?.intro || null;
  return `<a class="ag-card${world.mine.has(m.mint) ? ' mine' : ''}" href="#coin/${esc(m.mint)}" data-coin="${esc(m.mint)}">
    <span class="ag-top">${avatar(m, 40)}<span class="ag-id"><b>$${esc(m.symbol)}</b><small>${esc(m.name)}</small></span>
      <span class="ag-mc mono">${m.mcap ? `$${compact(m.mcap)}` : 'new'}</span></span>
    <span class="ag-line">${line ? `“${esc(line)}”` : '<i>Its agent is waking up…</i>'}</span>
    <span class="ag-foot">${k?.logo ? `<span class="ag-mind">${aiLogo(k, 13)} ${esc(k.label || '')}</span>` : '<span></span>'}
      ${m.candle ? `<span class="tag burn">burns ${m.candle.bps / 100}%</span>` : ''}<time data-at="${m.at}">${ago(m.at)}</time></span>
  </a>`;
}
function renderHome() {
  const coins = world.recent.slice().reverse().slice(0, 6);
  const live = $('feed');
  if (live) {
    live.innerHTML = coins.length ? coins.map(agentCard).join('')
      : `<div class="ag-empty"><b>No agent yet.</b><span>Launch the first coin: its agent shows up here, live.</span><button class="cta small-cta" data-launch>Launch a coin</button></div>`;
  }
  // Les esprits : les labos d'OpenRouter (et leur nombre de modèles), sinon les esprits gratuits.
  const minds = $('h-minds');
  if (minds && world.launch?.keepers && !minds.dataset.done) {
    minds.dataset.done = '1';
    minds.innerHTML = world.launch.keepers.models.map((m) => `<span class="h-mind">${aiLogo(m, 22)}<b>${esc(m.by)}</b><small>${esc(m.name)} · free</small></span>`).join('');
    loadModels().then((d) => {
      if (!d.models.length) return;
      const labs = labCounts(d.models).filter((l) => l.logo).slice(0, 10);
      minds.innerHTML = labs.map((l) => `<a class="h-mind" href="#models" data-go="models">${aiLogo({ logo: l.logo, by: l.name }, 22)}<b>${esc(l.name)}</b><small>${l.n} model${l.n === 1 ? "" : "s"}</small></a>`).join('');
      $('h-minds-sub').textContent = `${d.models.length} models from every big AI lab, paid by your coin's own fees. Or a free one.`;
    }).catch(() => {});
  }
  renderHeroAgent();
}
// La carte du haut : un agent qui parle, en direct (sinon, un exemple, dit comme tel).
let heroIdx = 0;
function renderHeroAgent() {
  const el = $('hero-agent');
  if (!el) return;
  const ts = world.thoughts.slice(0, 6);
  const t = ts.length ? ts[heroIdx % ts.length] : null;
  const k = t?.keeper;
  el.innerHTML = t
    ? `<a href="#coin/${esc(t.mint)}" data-coin="${esc(t.mint)}">
        <span class="ha-head">${avatar(t, 44)}<span><b>Agent of $${esc(t.symbol)}</b><small>${k?.logo ? `${aiLogo(k, 12)} ${esc(k.model || '')} · ` : ''}${esc(k?.label || '')}</small></span><span class="ha-live"><i></i>live</span></span>
        <span class="ha-line">“${esc(t.line)}”</span>
        <span class="ha-foot"><time data-at="${t.at}">${ago(t.at)}</time><span>See its journal →</span></span></a>`
    : `<div><span class="ha-head"><span class="ha-ph">${icon('keeper')}</span><span><b>Agent of $YOURCOIN</b><small>Llama 3.3 70B · Stoic</small></span><span class="ha-live ex">example</span></span>
        <span class="ha-line">“Fees came in overnight. I bought back 2.1M and burned them. The candle is a little shorter.”</span>
        <span class="ha-foot"><span>Every word, every burn: public</span></span></div>`;
}

function renderFeed() {
  if (document.body.classList.contains('home')) { renderHome(); return; }
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
    $('candle-card')?.classList.remove('melt');
    void $('candle-card')?.offsetWidth;
    $('candle-card')?.classList.add('melt');
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

// Le crew : sa page (#crew), et les narratifs du Scout proposés au lancement.
const crewPage = createCrew({ api, openModal, isOpen, world, ticker, avatar, onStrike: () => launchForm() });
// La page Proof : les wallets, les règles, chaque SOL et chaque burn.
const proofPage = createProof({ api, openModal, isOpen, ticker, demo: DEMO });
// Les modèles d'OpenRouter : « Launch with it » ouvre le lancement avec ce modèle choisi.
const modelsPage = createModels({ openModal, isOpen, onLaunch: (id) => { draft.keeper.tab = 'any'; draft.keeper.or = id; draft.step = 1; launchForm(); } });
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
  crew: () => crewPage.open(() => launchForm()),
  proof: () => proofPage.open(),
  models: () => modelsPage.open(),
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
  pick_model: 'Pick its model in the list, or switch to Free minds.',
  bad_model: 'That model is not available anymore. Pick another one.',
  bad_fuel: 'Pick one of the fuel amounts.',
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
  bad_prompt: 'Write its character in a few words (8 characters at least), or pick another one.',
  no_fee_tx: 'The Ignition Fee was not signed. Try again and approve both in your wallet.',
  bad_fee_tx: 'The Ignition Fee did not check out. Try again.',
  bad_share_tx: 'The fee sharing did not check out. Try again.',
  unsigned: 'Your wallet did not sign everything. Try again.',
};

let busy = false;
// burn : « Make it burn », la part (en %) des creator fees qui rachète et brûle le coin lui-même.
// keeper.tab : « free » (les esprits gratuits) ou « any » (un modèle d'OpenRouter : keeper.or, avec du fuel).
const DRAFT = () => ({ fields: {}, image: null, preview: null, burn: 20, fuel: 0.02, keeper: { style: 'analyst', model: 'gpt-oss', goal: null, prompt: '', tab: 'free', or: null }, idea: '', spark: null, step: 0 });
let draft = DRAFT();


// Ce que coûte un lancement, avec ou sans partage des creator fees.
// Les parts que le créateur peut choisir (en %), 0 = pas de bougie.
const burnOptions = () => (world.launch?.selfOptions || []).map((bps) => bps / 100);
const burning = () => (burnOptions().includes(draft.burn) ? draft.burn : 0);

// La barre : où vont les creator fees du coin (toi, ta bougie, son crew, $WICK, l'équipe).
function burnSplit(pct) {
  const s = world.launch?.split || { creatorBps: 6000, burnBps: 1000, teamBps: 1000, crewBps: 2000 };
  const you = s.creatorBps / 100 - pct;
  const crew = (s.crewBps || 0) / 100;
  return {
    bar: `<span style="width:${you}%">You ${you}%</span>${pct ? `<span class="self" style="width:${pct}%">${pct >= 30 ? 'Burns it ' : ''}${pct}%</span>` : ''}`
      + `${crew ? `<span class="crew" style="width:${crew}%" title="Its crew">${crew}%</span>` : ''}<span class="wick" style="width:${s.burnBps / 100}%"></span><span class="team" style="width:${s.teamBps / 100}%"></span>`,
    legend: `You ${you}%${pct ? ` · ${pct}% buys your coin back and burns it` : ''}${crew ? ` · ${crew}% its crew (its AI, its posts)` : ''} · ${s.burnBps / 100}% burns $${ticker()} · ${s.teamBps / 100}% WICK team`,
  };
}

function costLine(burnPct) {
  const l = world.launch;
  const withShare = Boolean(l?.shareBps);
  const fee = withShare ? l.sharedFeeSol : l?.feeSol;
  const burn = withShare ? l.sharedBurnSol : l?.burnSol;
  const team = withShare ? l.sharedTeamSol : l?.teamSol;
  const split = team ? `${burn} SOL buys $${ticker()} and burns it, ${team} SOL funds the WICK team` : `buys $${ticker()} and burns it`;
  const fuel = fuelSol() ? ` Plus <b>${fuelSol()} SOL of fuel</b> for its agent (it pays its AI).` : '';
  return `${fee
    ? `<b>${fee} SOL WICK Ignition Fee</b>: ${split}.${fuel} Plus ≈ 0.02 SOL of pump.fun creation and network costs, and your dev buy.`
    : '≈ 0.02 SOL of pump.fun creation and network costs, plus your dev buy.'} Your wallet signs, your coin${withShare ? `, ${(l.split?.creatorBps ?? 10_000 - l.shareBps) / 100 - burnPct}% of your creator fees` : ', your pump.fun creator fees'}.`;
}

// Le Operator du coin : sa personnalité et son esprit (le modèle). Chaque coin en a un ; c'est lui
// qui invente le coin avec Spark, parle à ses holders, et (avec « Make it burn ») le brûle.
const mindOf = (id) => world.launch?.keepers?.models.find((m) => m.id === id) || world.launch?.keepers?.models[0];
// Le tunnel de lancement, en cinq étapes : son identité (Spark ou à la main), son esprit, son
// caractère, son objectif, puis le feu (Make it burn, dev buy) et le lancement.
const STEPS5 = [['Identity'], ['Its agent'], ['Launch']];
function stepper() {
  return `<ol class="lf-stepper">${STEPS5.map(([label], i) => `<li><button type="button" data-goto="${i}" class="${i === draft.step ? 'on' : ''}${i < draft.step ? ' done' : ''}">
    <span>${i < draft.step ? icon('check') : i + 1}</span><b>${label}</b></button></li>`).join('')}</ol>`;
}
const head = (i, title, sub) => `<div class="lf-step-head"><b>${title}</b><small>${sub}</small></div>`;
const show = (i) => (draft.step === i ? '' : ' hidden');

function identityStep(f) {
  return `<section class="lf-step" data-step="0"${show(0)}>
    ${head(0, 'Its <span class="grad">identity</span>', 'Like on pump.fun: its image, its name, its ticker. Its agent comes next.')}
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
    <label><span>Description <em>· optional</em></span><textarea name="description" maxlength="500" rows="3" placeholder="What is it about? Its agent will tell its story from here.">${esc(f.description)}</textarea></label>
    <details${f.twitter || f.telegram || f.website ? ' open' : ''}><summary>Links <em>· optional</em></summary>
      <label>X<input name="twitter" type="url" placeholder="https://x.com/…" value="${esc(f.twitter)}"></label>
      <label>Telegram<input name="telegram" type="url" placeholder="https://t.me/…" value="${esc(f.telegram)}"></label>
      <label>Website<input name="website" type="url" placeholder="https://…" value="${esc(f.website)}"></label>
    </details>
  </section>`;
}

// Le modèle choisi sur OpenRouter (le catalogue, chargé une fois), et ce que paie son fuel.
let orModels = null;
const orOn = () => Boolean(world.launch?.openrouter);
const usingOr = () => orOn() && draft.keeper.tab === 'any' && draft.keeper.or;
const fuelOn = () => Boolean(world.launch?.feeSol || world.launch?.sharedFeeSol);
const fuelSol = () => (usingOr() && fuelOn() ? draft.fuel : 0);
const orPick = () => orModels?.models.find((m) => m.id === draft.keeper.or) || null;
function orList() {
  if (!orModels) return '<p class="muted small">Loading the models…</p>';
  const list = filterModels(orModels.models, { q: draft.keeper.orQ || '', lab: draft.keeper.orLab || '', sort: draft.keeper.orSort || 'newest' }).slice(0, 60);
  return list.length ? list.map((m) => `<button type="button" class="or-row${draft.keeper.or === m.id ? ' on' : ''}" data-or="${esc(m.id)}" aria-pressed="${draft.keeper.or === m.id}">
      ${aiLogo(asMind(m), 20)}<span><b>${esc(m.name)}</b><small>${esc(m.lab)}</small></span><em class="mono">${runPrice(m.run)}<small>a run</small></em></button>`).join('')
    : '<p class="muted small">No model matches.</p>';
}
function fuelBox() {
  const m = orPick();
  const opts = world.launch?.openrouter?.fuelOptions || [0, 0.02, 0.05, 0.1];
  if (!m) return '<p class="muted small">Pick a model above.</p>';
  // Le fuel part avec la fee de lancement : il n'existe qu'une fois $WICK lancé.
  if (!fuelOn()) {
    return `<div class="or-pick">${aiLogo(asMind(m), 26)}<span><b>${esc(m.name)}</b><small>${esc(m.lab)} · about ${runPrice(m.run)} an answer</small></span></div>
      <small class="muted">It starts on a free mind, and switches to this model as soon as your coin's fees pay for it. Fuel opens with the $${ticker()} launch.</small>`;
  }
  const runs = (f) => runsFor(f, m, orModels?.solUsd);
  return `<div class="or-pick">${aiLogo(asMind(m), 26)}<span><b>${esc(m.name)}</b><small>${esc(m.lab)} · about ${runPrice(m.run)} an answer</small></span></div>
    <div class="or-fuel"><b>Its fuel</b> <small>SOL you add now, paid with the launch fee: its first answers. Then 20% of your coin's creator fees keep it running.</small>
      <div class="burn-pills" role="group" aria-label="Fuel">${opts.map((f) => `<button type="button" class="pill${draft.fuel === f ? ' on' : ''}" data-fuel="${f}" aria-pressed="${draft.fuel === f}">${f ? `${f} SOL` : 'None'}</button>`).join('')}</div>
      <small class="muted">${draft.fuel && runs(draft.fuel) != null ? `≈ ${runs(draft.fuel).toLocaleString('en-US')} answers with ${draft.fuel} SOL.` : draft.fuel ? '' : 'No fuel: it starts on a free mind, and switches to this model once its fees come in.'} When its budget is empty, it keeps going on a free mind.</small></div>`;
}

function mindStep(k) {
  const card = (m) => `<button type="button" class="k-mind${m.premium ? ' premium' : ''}${draft.keeper.model === m.id ? ' on' : ''}" data-kmodel="${esc(m.id)}" aria-pressed="${draft.keeper.model === m.id}"${m.premium && !m.available ? ' disabled' : ''}><i>${aiLogo(m, 22)}</i><span><b>${esc(m.by)}</b><small>${esc(m.name)}${m.premium && !m.available ? ' · soon' : ''}</small></span></button>`;
  const any = orOn() && draft.keeper.tab === 'any';
  const labs = orModels ? labCounts(orModels.models).slice(0, 6) : [];
  return `<div class="ag-block"><h4>Its mind <small>the AI it thinks with</small></h4>
    ${orOn() ? `<div class="or-tabs" role="tablist"><button type="button" role="tab" class="${any ? '' : 'on'}" data-mtab="free" aria-selected="${!any}">Free minds <small>${k.models.length} open models</small></button>
      <button type="button" role="tab" class="${any ? 'on' : ''}" data-mtab="any" aria-selected="${any}">Any model <small>${orModels ? orModels.models.length : '280+'} on OpenRouter</small></button></div>` : ''}
    <div${any ? ' hidden' : ''}>
      <div class="k-minds big" role="group" aria-label="The mind">${k.models.map(card).join('')}</div>
      <small class="muted k-note">${icon('sparkle')} Free: nothing to pay, ever.</small>
    </div>
    ${orOn() ? `<div class="or-box"${any ? '' : ' hidden'}>
      <div class="or-tools"><input type="search" id="lf-or-q" placeholder="Search: claude, gpt, gemini, grok, deepseek…" value="${esc(draft.keeper.orQ || '')}" autocomplete="off">
        <div class="md-labs small"><button type="button" class="pill${draft.keeper.orLab ? '' : ' on'}" data-orlab="">All</button>${labs.map((l) => `<button type="button" class="pill${draft.keeper.orLab === l.lab ? ' on' : ''}" data-orlab="${esc(l.lab)}">${esc(l.name)}</button>`).join('')}
          <button type="button" class="pill${draft.keeper.orSort === 'cheapest' ? ' on' : ''}" data-orsort="cheapest">Cheapest first</button></div></div>
      <div class="or-list" id="lf-or-list">${orList()}</div>
      <div id="lf-or-fuel">${fuelBox()}</div>
      <a class="linkish small" href="#models">See every model and its price →</a>
    </div>` : ''}
  </div>`;
}

function characterStep(k) {
  const custom = draft.keeper.style === 'custom';
  return `<div class="ag-block"><h4>Its character <small>how it talks to holders</small></h4>
    <div class="k-styles four" role="group" aria-label="Character">${k.styles.map((x) => `<button type="button" class="k-style${draft.keeper.style === x.id ? ' on' : ''}" data-kstyle="${esc(x.id)}" aria-pressed="${draft.keeper.style === x.id}"><b>${esc(x.label)}</b><small>${esc(x.hint)}</small></button>`).join('')}</div>
    <label class="k-custom"${custom ? '' : ' hidden'}><span>Its character, in your words <em>· ${k.customMax || 280} characters max, public</em></span>
      <textarea name="keeper_prompt" id="lf-prompt" maxlength="${k.customMax || 280}" rows="3" placeholder="A retired samurai who speaks in short proverbs and treats every burn like a duel.">${esc(draft.keeper.prompt || '')}</textarea></label>
  </div>`;
}

function objectiveStep(k) {
  const warn = draft.keeper.goal === 'deflation' && !burnOptions().length;
  const ico = { deflation: 'flame', survive: 'keeper', openbook: 'book', meme: 'sparkle' };
  return `<div class="ag-block"><h4>Its objective <small>what it aims for</small></h4>
    <div class="k-goals" role="group" aria-label="Objective">${(k.goals || []).map((g) => `<button type="button" class="k-goal${draft.keeper.goal === g.id ? ' on' : ''}" data-kgoal="${esc(g.id)}" aria-pressed="${draft.keeper.goal === g.id}">${icon(ico[g.id] || 'star')}<b>${esc(g.label)}</b><small>${esc(g.hint)}</small></button>`).join('')}</div>
    <small class="muted" id="lf-goal-note"${warn ? '' : ' hidden'}>Deflation works best with Make it burn, which unlocks with $${ticker()}. Until then, its agent watches and tells.</small>
  </div>`;
}

// L'étape 2 : son agent, en un seul écran (son esprit, son caractère, son objectif).
function agentStep(k) {
  return `<section class="lf-step keeper-opt" data-step="1"${show(1)}>
    ${head(1, 'Its <span class="grad">agent</span>', 'The AI that runs your coin: it talks to holders, posts, keeps a public journal and burns. Locked at launch.')}
    ${characterStep(k)}
    ${mindStep(k)}
    ${objectiveStep(k)}
  </section>`;
}

function fireStep(max, f) {
  const k = world.launch?.keepers;
  const mind = mindOf(draft.keeper.model);
  const style = k?.styles.find((x) => x.id === draft.keeper.style);
  const goal = k?.goals?.find((x) => x.id === draft.keeper.goal);
  return `<section class="lf-step lf-coin" data-step="2"${show(2)}>
    ${head(2, 'Launch <span class="grad">it</span>', 'The last settings, then your wallet signs.')}
    <div class="lf-summary">
      ${draft.preview ? `<img src="${draft.preview}" alt="">` : '<span class="lf-sum-ph">＋</span>'}
      <div><b>${esc(f.name || 'Your coin')} <span class="mono gold">${f.symbol ? `$${esc(String(f.symbol).toUpperCase())}` : ''}</span></b>
        <small>Agent: ${esc(style?.label || '')} · ${usingOr() && orPick() ? `${aiLogo(asMind(orPick()), 12)} ${esc(orPick().name)}${fuelSol() ? ` · ${fuelSol()} SOL fuel` : ''}` : `${aiLogo(mind, 12)} ${esc(mind?.name || '')}`} · ${esc(goal?.label || '')}</small></div>
      <button type="button" class="linkish" data-goto="0">Edit</button>
    </div>
    <label><span>Dev buy <em>· optional, buy your own coin at launch</em></span>
      <span class="sol"><input name="devBuy" type="number" min="0" max="${max}" step="0.01" value="${esc(f.devBuy ?? '0')}"><b>SOL</b></span>
    </label>
    <div class="presets">${[0, 0.1, 0.5, 1].map((v) => `<button type="button" data-sol="${v}">${v}</button>`).join('')}</div>
    ${burnOptions().length ? `<div class="burn-opt">
      <div class="burn-head"><b>Make it <span class="grad">burn</span></b>
        <small>Take a share of your creator fees to buy your coin back and burn it, forever. Your coin becomes a candle,
        and its agent picks the moments. Below: where every creator fee of your coin goes.</small></div>
      <div class="burn-pills" role="group" aria-label="Make it burn">${[0, ...burnOptions()].map((v) => `<button type="button" class="pill${burning() === v ? ' on' : ''}" data-burn="${v}" aria-pressed="${burning() === v}">${v ? `${v}%` : 'Off'}</button>`).join('')}</div>
      <div class="split-bar" id="lf-split">${burnSplit(burning()).bar}</div>
      <small class="muted" id="lf-legend">${burnSplit(burning()).legend}</small>
      <small class="lock">${icon('lock')} Locked on pump.fun. Nobody can change it, not even WICK.</small>
    </div>` : ''}
    ${burnTeaser()}
    <p class="cost" id="lf-cost">${costLine(burning())}</p>
  </section>`;
}

// « Make it burn » avant $WICK : ce qui arrive, sans pouvoir le choisir.
function burnTeaser() {
  if (burnOptions().length) return '';
  return `<div class="burn-opt soon">
    <div class="burn-head"><b>Make it <span class="grad">burn</span> <span class="tag soon">${icon('lock')} unlocks with $${ticker()}</span></b>
      <small>Once $${ticker()} is live, a share of your creator fees can buy your coin back and burn it, forever. Your agent picks the moments.</small></div>
  </div>`;
}

function launchForm(error = '') {
  const f = draft.fields;
  const max = world.launch?.maxDevBuy ?? 5;
  const k = world.launch?.keepers || { styles: [], models: [], goals: [] };
  if (!draft.keeper.goal) draft.keeper.goal = burnOptions().length ? 'deflation' : 'survive';
  if (error) draft.step = STEPS5.length - 1;
  const last = draft.step === STEPS5.length - 1;
  openModal(`
    <h2>Launch a coin <span class="grad">with its agent</span></h2>
    <p class="muted">A real coin on pump.fun, with its own AI agent. You approve the launch, it does the rest.${world.launch?.feeSol ? ` ${world.launch.teamSol ? 'Half of its Ignition Fee burns' : 'Its Ignition Fee burns'} $${ticker()} within a minute.` : ''}</p>
    ${stepper()}
    <form id="launch-form" novalidate>
      ${identityStep(f)}
      ${agentStep(k)}
      ${fireStep(max, f)}
      <input type="hidden" name="burn" value="${burning()}"><input type="hidden" name="share" value="${burnOptions().length ? '1' : ''}">
      <input type="hidden" name="keeper_style" value="${esc(draft.keeper.style)}"><input type="hidden" name="keeper_model" value="${esc(draft.keeper.model)}">
      <input type="hidden" name="keeper_goal" value="${esc(draft.keeper.goal)}">
      <input type="hidden" name="mind_or" value="${esc(usingOr() ? draft.keeper.or : '')}"><input type="hidden" name="fuel" value="${fuelSol()}">
      <p class="error" id="lf-error"${error ? '' : ' hidden'}>${esc(error)}</p>
      <div class="lf-nav">
        <button type="button" class="wbtn" id="lf-back"${draft.step ? '' : ' hidden'}>Back</button>
        ${last
    ? `<button class="cta wide" type="submit">${DEMO ? 'Launch (demo)' : connect.current() ? 'Launch your coin' : 'Connect wallet & launch'}</button>`
    : `<button type="button" class="cta wide" id="lf-next">Next: ${STEPS5[draft.step + 1][0]}</button>`}
      </div>
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
  form.querySelectorAll('[data-kgoal]').forEach((b) => b.addEventListener('click', () => {
    draft.keeper.goal = b.dataset.kgoal;
    form.querySelectorAll('[data-kgoal]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    form.keeper_goal.value = draft.keeper.goal;
    const note = $('lf-goal-note');
    if (note) note.hidden = !(draft.keeper.goal === 'deflation' && !burnOptions().length);
  }));
  form.querySelectorAll('[data-kstyle]').forEach((b) => b.addEventListener('click', () => {
    const box = form.querySelector('.k-custom');
    if (box) box.hidden = draft.keeper.style !== 'custom';
    if (draft.keeper.style === 'custom') $('lf-prompt')?.focus();
  }));
  $('lf-prompt')?.addEventListener('input', (e) => { draft.keeper.prompt = e.target.value; if ($('lf-error')) $('lf-error').hidden = true; });
  // Avancer : chaque étape vérifie la sienne ; on ne saute pas une étape incomplète.
  const goTo = (i) => {
    draft.fields = Object.fromEntries(new FormData(form));
    for (let j = draft.step; j < i; j++) {
      const problem = stepProblem(j, draft.fields);
      if (problem) {
        if (j !== draft.step) { draft.step = j; launchForm(); }
        showFormError(problem);
        return;
      }
    }
    draft.step = Math.max(0, Math.min(STEPS5.length - 1, i));
    launchForm();
    modal.scrollTop = 0;
  };
  $('lf-next')?.addEventListener('click', () => goTo(draft.step + 1));
  $('lf-back')?.addEventListener('click', () => goTo(draft.step - 1));
  document.querySelectorAll('#modal-body [data-goto]').forEach((b) => b.addEventListener('click', () => goTo(Number(b.dataset.goto))));
  form.querySelectorAll('[data-burn]').forEach((b) => b.addEventListener('click', () => {
    draft.burn = Number(b.dataset.burn);
    const pct = burning();
    form.querySelectorAll('[data-burn]').forEach((x) => {
      const on = Number(x.dataset.burn) === pct;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', String(on));
    });
    form.burn.value = String(pct);
    const split = burnSplit(pct);
    $('lf-split').innerHTML = split.bar;
    $('lf-legend').textContent = split.legend;
    $('lf-cost').innerHTML = costLine(pct);
  }));
  bindOr(form);
  form.addEventListener('submit', (e) => { e.preventDefault(); submitLaunch(form); });
}

// L'onglet « Any model » : le catalogue (chargé une fois), la recherche, le choix, le fuel.
function bindOr(form) {
  if (!orOn()) return;
  const refresh = () => {
    if ($('lf-or-list')) $('lf-or-list').innerHTML = orList();
    if ($('lf-or-fuel')) $('lf-or-fuel').innerHTML = fuelBox();
    form.mind_or.value = usingOr() ? draft.keeper.or : '';
    form.fuel.value = String(fuelSol());
  };
  // Chargé en arrière-plan ; l'étape de l'agent se redessine seulement si elle est à l'écran.
  if (!orModels) loadModels().then((d) => { orModels = d; if (form.isConnected && draft.step === 1) launchForm(); }).catch(() => {});
  form.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => {
    draft.fields = Object.fromEntries(new FormData(form));
    draft.keeper.tab = b.dataset.mtab;
    launchForm();
  }));
  $('lf-or-q')?.addEventListener('input', (e) => { draft.keeper.orQ = e.target.value; refresh(); });
  form.querySelector('.or-box')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-or]');
    const lab = e.target.closest('[data-orlab]');
    const sort = e.target.closest('[data-orsort]');
    const fuel = e.target.closest('[data-fuel]');
    if (row) draft.keeper.or = row.dataset.or;
    if (lab) { draft.keeper.orLab = lab.dataset.orlab; form.querySelectorAll('[data-orlab]').forEach((x) => x.classList.toggle('on', x === lab)); }
    if (sort) { draft.keeper.orSort = draft.keeper.orSort === 'cheapest' ? 'newest' : 'cheapest'; sort.classList.toggle('on', draft.keeper.orSort === 'cheapest'); }
    if (fuel) draft.fuel = Number(fuel.dataset.fuel);
    if (row || lab || sort || fuel) refresh();
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

function stepProblem(step, fields) {
  if (step === 0) {
    const symbol = (fields.symbol || '').trim().replace(/^\$/, '');
    if (!fields.name?.trim()) return ERRORS.bad_name;
    if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) return ERRORS.bad_symbol;
    if (!draft.image) return ERRORS.no_image;
  }
  if (step === 1 && draft.keeper.style === 'custom' && (draft.keeper.prompt || '').trim().length < 8) return ERRORS.bad_prompt;
  if (step === 1 && orOn() && draft.keeper.tab === 'any' && !draft.keeper.or) return ERRORS.pick_model;
  return null;
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
    ['send', 'Sending to Solana'],
    ['confirm', 'Creating your coin on pump.fun'],
    ...(fee ? [['sign2', `Approve 2/2: the Ignition Fee and the fee split${burning() ? ', with your candle' : ''}${fuelSol() ? `, and ${fuelSol()} SOL of fuel for its agent` : ''}`], ['fee', 'Lighting your match']] : []),
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
    if (m && result.feeMissing) {
      world.mine.add(m.mint);
      feeDue(m, mod, result.feeMissing);
    } else if (m) {
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

// Le coin est créé, mais sa fee (et son partage) n'est pas signée : on la propose encore. Sans
// elle, pas de burn de $WICK, pas de partage, pas de crew payé.
function feeDue(m, mod, why = 'rejected') {
  openModal(`
    <div class="lit">${avatar(m, 72)}</div>
    <h2><span class="grad">$${esc(m.symbol)}</span> is live on pump.fun</h2>
    <p class="muted">One last approval lights it on WICK: its Ignition Fee and its fee split. Until then it doesn't burn
      $${ticker()}, and its crew isn't paid.${why === 'no_funds' ? ' <b>Your wallet needs a little more SOL for it.</b>' : ''}</p>
    <p class="error" id="fee-error" hidden></p>
    <div class="wallets">
      <button class="wbtn primary" id="fee-go">Approve the Ignition Fee</button>
      <a class="wbtn" href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">See it on pump.fun</a>
      <a class="wbtn" href="#coin/${esc(m.mint)}">Later, from its page</a>
    </div>`, 'm-done');
  $('fee-go').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Check your wallet…';
    try {
      const w = mod || await import('./wallet.js');
      await w.payFee({ mint: m.mint });
      await poll();
      success(world.matches.find((x) => x.mint === m.mint) || m, null);
    } catch (err) {
      b.disabled = false;
      b.textContent = 'Approve the Ignition Fee';
      const box = $('fee-error');
      box.hidden = false;
      box.textContent = noFunds(err, 'The Ignition Fee') || ERRORS[err.code] || 'Could not send it. Try again.';
    }
  });
}

function success(m, signature) {
  const share = `I just launched $${m.symbol} on WICK: it has its own AI agent, and it burns itself.\n${location.origin}/#coin/${m.mint}`;
  const burnSol = world.launch?.feeSol ? (m.burnFee ?? (m.share ? world.launch.sharedBurnSol : world.launch.burnSol)) : 0;
  openModal(`
    <div class="lit">${avatar(m, 72)}</div>
    <h2><span class="grad">$${esc(m.symbol)}</span> is live</h2>
    <p class="muted">Its agent is waking up: its first words in a few minutes, then its journal, its posts and its burns, all on its page.
      ${m.candle ? `<b>${m.candle.bps / 100}% of its fees buy it back and burn it, forever.</b> ` : ''}${burnSol ? `${burnSol} SOL of its Ignition Fee is burning $${ticker()} right now.` : ''}</p>
    <div class="wallets">
      <a class="wbtn primary" href="#coin/${esc(m.mint)}" data-coin="${esc(m.mint)}">See its agent</a>
      <a class="wbtn" href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">See it on pump.fun</a>
      <a class="wbtn" href="https://x.com/intent/post?text=${encodeURIComponent(share)}" target="_blank" rel="noopener">Share on X</a>
      ${signature ? `<a class="wbtn" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener">Transaction</a>` : ''}
    </div>`, 'm-done');
}

// ------------------------------------------------------------ démarrage
function start() {
  if (DEMO) {
    $('demo-bar').hidden = false;
    $('demo-bar').innerHTML = 'Demo · a simulated, sped-up world · <a href="/">see the real candle</a>';
  }
  $('strike-btn').addEventListener('click', () => launchForm());
  // Les autres boutons « Launch a coin » de la page (le dernier appel, l'accueil vide).
  document.addEventListener('click', (e) => { if (e.target.closest('[data-launch]')) launchForm(); });
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
  for (const root of [$('feed'), $('modal-body'), $('burn-pop'), $('hero-agent')].filter(Boolean)) {
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-coin]');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      go(`coin/${a.dataset.coin}`);
    });
  }
  $('feed-toggle')?.addEventListener('click', () => document.body.classList.toggle('feed-open'));
  if ($('stage')) wirePointer();
  // La carte de l'agent en haut de l'accueil change toutes les 7 secondes.
  setInterval(() => { if (!document.hidden && world.thoughts.length > 1) { heroIdx++; renderHeroAgent(); } }, 7000);
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
  // La bougie en 3D : seulement là où il y a une scène (l'accueil simple n'en a plus).
  if ($('stage')) startScene();
  // Retour de X (le compte X d'un coin) : on dit ce qui s'est passé, puis on nettoie l'adresse.
  const params = new URLSearchParams(location.search);
  const xs = params.get('x');
  if (xs) {
    params.delete('x');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    toast({ linked: `${icon('check')} Its agent now runs its X account. First post within the hour.`, denied: 'X authorization cancelled. Nothing was connected.' }[xs] || 'Could not connect the X account. Try again from its Kit tab.', 7000);
  }
  // Une page demandée dans l'adresse (trywick.fun/#wick…) s'ouvre une fois l'état chargé.
  const page = location.hash.slice(1);
  poll(true).then(() => { if (isRoute(page)) go(page); });
  // Un lien vers une autre page du site (#candles, #coin/…) depuis la même page l'ouvre aussi.
  window.addEventListener('hashchange', () => { const next = location.hash.slice(1); if (isRoute(next)) go(next); });
  tokenPage.prefetch();
}

start();
