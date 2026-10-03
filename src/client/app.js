// Le site : la bougie géante, ses allumettes, le fil, et le bouton pour en frapper une.
import { createDemo } from './demo.js';
import { createPages } from './pages.js';
import { createScene, headColor } from './scene.js';
import { createTokenPage, remember } from './token.js';
import { ago, compact, esc, fmt, pumpUrl, short, sol, solscan, span } from './util.js';

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo');
const POLL_MS = DEMO ? 1500 : 4000;
const HEAT_FULL = 25;          // 25 coins en 10 minutes : la flamme est à fond

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const api = DEMO ? createDemo() : {
  state: (since = 0, markets = false) => get(`/api/state?since=${since}${markets ? '&markets=1' : ''}`),
  leaderboard: () => get('/api/leaderboard'),
  launches: (sort, offset = 0) => get(`/api/launches?sort=${encodeURIComponent(sort)}&offset=${offset}`),
  profile: (wallet) => get(`/api/profile?wallet=${encodeURIComponent(wallet)}`),
  token: () => get('/api/token'),
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
  $('meter-sub').innerHTML = live
    ? `Every launch removes ${fee ? `<b>${fee} SOL of ${esc(tk)}</b>` : esc(tk)} from circulation and brings the buyback <b>${off}</b> closer.`
    : world.buyback.paused
      ? 'Buybacks are paused for now. The candle waits.'
      : `The candle starts melting once ${esc(tk)} is live.`;
  $('cta-sub').innerHTML = fee
    ? `Launch your coin on pump.fun · <b>${fee} SOL Ignition Fee</b> burns ${esc(tk)}`
    : 'Launch your coin on pump.fun · it feeds the flame';
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
function launchCard(m) {
  const fee = m.fee ?? null;
  return `<li class="ev launch${world.mine.has(m.mint) ? ' mine' : ''}${m.holder ? ' holder' : ''}">
    <a href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">
      ${avatar(m)}
      <span class="ev-main"><b>$${esc(m.symbol)} launched${m.holder ? ' <i class="tag gold" title="Launched by a $WICK holder">👑</i>' : ''}</b>
        <span>${fee ? `<em class="fire">+${fee} SOL</em> added to the fire` : esc(m.name)}</span></span>
      <span class="ev-meta"><span class="mono">${m.mcap ? `$${compact(m.mcap)}` : `#${fmt(m.seq)}`}</span><time data-at="${m.at}">${ago(m.at)}</time></span>
    </a></li>`;
}

function burnCard(b) {
  const what = b.kind === 'match' ? `$${esc(b.symbol || '?')}'s Ignition Fee` : `buyback #${esc(b.ref)}`;
  const inner = `<span class="ev-ico">🔥</span>
      <span class="ev-main"><b>${compact(b.burned)} $${ticker()} burned</b><span>${sol(b.sol)} used · ${what}</span></span>
      <span class="ev-meta">${b.sig ? '<span class="mono">TX ↗</span>' : ''}<time data-at="${b.at}">${ago(b.at)}</time></span>`;
  return `<li class="ev burn">${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">${inner}</a>` : `<div>${inner}</div>`}</li>`;
}

function pendingCard() {
  const h = world.history[0];
  if (!h || !['ended', 'buying', 'bought', 'burning_tx'].includes(h.status) || !world.buyback.live || world.buyback.paused) return '';
  return `<li class="ev pending"><div><span class="ev-ico">💨</span>
    <span class="ev-main"><b>Buyback #${h.number}</b><span class="pulse-text">buying $${ticker()}…</span></span></div></li>`;
}

function renderFeed() {
  const events = [
    ...world.recent.map((m) => ({ at: m.at, html: () => launchCard(m) })),
    ...world.burns.slice(0, 40).map((b) => ({ at: b.at, html: () => burnCard(b) })),
  ].sort((a, b) => b.at - a.at).slice(0, 50);
  $('feed').innerHTML = pendingCard() + (events.length
    ? events.map((e) => e.html()).join('')
    : `<li class="fi-empty">The fire is quiet.<br>Strike the first match.</li>`);
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
  el.innerHTML = `<strong>🔥 ${fmt(Math.round(b.burned))} $${ticker()} burned</strong>
    <span>${sol(b.sol)} used · ${b.kind === 'match' ? `$${esc(b.symbol || '?')}'s Ignition Fee` : `buyback #${esc(b.ref)}`}</span>
    ${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">View TX ↗</a>` : ''}`;
  el.hidden = false;
  el.classList.remove('out');
  void el.offsetWidth;
  el.classList.add('in');
  scene?.flare();
  $('candle-card').classList.remove('melt');
  void $('candle-card').offsetWidth;
  $('candle-card').classList.add('melt');
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
    toast(`<span>💨 <b>Buyback #${world.history[0]?.number ?? ''}</b> is buying back $${ticker()}…</span>`, 5000);
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
    toast(`<span>🕯️ <b>Candle #${pad(done)} fully melted 🔥</b> ${pct(data.candle.burnedPct)} of $${ticker()} burned forever. It joins the Hall of Flames.</span>`, 8000);
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
  api, openModal, isOpen, world, ticker, avatar, pct, demo: DEMO,
  onStrike: () => launchForm(),
  onToken: () => go('wick'),
});

const ROUTES = {
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
function go(page) {
  if (busy || !ROUTES[page]) return;
  ROUTES[page]();
  const hash = `#${page}`;
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
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
  no_fee_tx: 'The Ignition Fee was not signed. Try again and approve both in your wallet.',
  bad_fee_tx: 'The Ignition Fee did not check out. Try again.',
  unsigned: 'Your wallet did not sign everything. Try again.',
};

let busy = false;
let draft = { fields: {}, image: null, preview: null };

function launchForm(error = '') {
  const f = draft.fields;
  const max = world.launch?.maxDevBuy ?? 5;
  openModal(`
    <h2>Strike a match</h2>
    <p class="muted">Launch a real coin on pump.fun. It becomes a match orbiting the $${ticker()} candle${world.launch?.feeSol ? `, and its Ignition Fee burns $${ticker()} within a minute` : ''}.</p>
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
        ? `<b>${world.launch.feeSol} SOL WICK Ignition Fee</b>: buys $${ticker()} and burns it. Plus ≈ 0.02 SOL of pump.fun creation and network costs, and your dev buy. One approval.`
        : '≈ 0.02 SOL of pump.fun creation and network costs, plus your dev buy.'} Your wallet signs, your coin, your pump.fun creator fees.</p>
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
    launchForm(ERRORS[err.code] || 'Something went wrong. Try again.');
  }
}

function success(m, signature) {
  const share = `I just launched $${m.symbol} on WICK, the launchpad that burns itself. Every coin melts $${world.token?.ticker || 'WICK'} 🕯️🔥\n${location.origin}`;
  openModal(`
    <div class="lit">${avatar(m, 72)}</div>
    <h2><span class="grad">$${esc(m.symbol)}</span> is lit</h2>
    <p class="muted">Match #${fmt(m.seq)} is orbiting candle #${pad(world.candle?.number ?? 1)}${world.launch?.feeSol
      ? `, and its ${world.launch.feeSol} SOL Ignition Fee is buying $${ticker()} to burn it right now` : ''}. The next buyback just came
    ${span(world.breath?.matchMs ?? 60_000)} closer. Look for the label.</p>
    <div class="wallets">
      <a class="wbtn primary" href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">See it on pump.fun</a>
      <a class="wbtn" href="https://x.com/intent/post?text=${encodeURIComponent(share)}" target="_blank" rel="noopener">Share on X</a>
      ${signature ? `<a class="wbtn" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener">Transaction</a>` : ''}
      <button class="wbtn" id="see-flames">Your flames 🔥</button>
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
  $('feed-more').addEventListener('click', () => go('explore'));
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
  poll(true).then(() => { if (ROUTES[page]) go(page); });
  tokenPage.prefetch();
}

start();
