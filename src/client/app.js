// Le site : la bougie géante, ses allumettes, le fil, et le bouton pour en frapper une.
import { createDemo } from './demo.js';
import { createScene, headColor } from './scene.js';

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo');
const POLL_MS = DEMO ? 1500 : 4000;
const HEAT_FULL = 25;          // 25 coins en 10 minutes : la flamme est à fond

const api = DEMO ? createDemo() : {
  async state(since = 0) {
    const res = await fetch(`/api/state?since=${since}`);
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
  const color = headColor(m.mint);
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
  candle: null,
  matches: [],               // les allumettes de la bougie en cours, de la plus ancienne à la plus récente
  history: [],               // les bougies fondues et leur buyback
  totals: { burned: 0, sol: 0, buybacks: 0 },
  buyback: { live: false, potSol: null },
  clock: 0,                  // l'écart entre l'horloge du serveur et la nôtre
  seenBurns: null,           // les buybacks déjà annoncés
  heat: 0,
  token: null,
  lastSeq: 0,
  ready: false,
  fresh: new Map(),          // mint → moment d'arrivée (étiquettes à l'écran)
  mine: new Set(),           // les allumettes frappées depuis ce navigateur
};

// Où en est la bougie, recalculé chaque seconde avec l'horloge du serveur.
function candleNow() {
  const c = world.candle;
  const now = Date.now() + world.clock;
  const burned = Math.max(0, now - c.startedAt) + c.matches * c.matchMs;
  const remaining = Math.max(0, c.durationMs - burned);
  return { remaining, melted: Math.min(1, burned / c.durationMs) };
}

function clockText(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function renderMeter() {
  const c = world.candle;
  if (!c) return;
  const p = candleNow();
  const live = world.buyback.live;
  const off = span(c.matchMs);
  $('candle-no').textContent = `#${c.number}`;
  $('meter-matches').textContent = `${fmt(c.matches)} ${c.matches === 1 ? 'match' : 'matches'}`;
  $('count-label').textContent = p.remaining > 0
    ? (live ? 'Next buyback in' : 'Burns out in')
    : (live ? 'Buying back $WICK…' : 'Burning out…');
  $('countdown').textContent = clockText(p.remaining);
  $('countdown').classList.toggle('hot', p.remaining < 60_000);
  $('bar').style.width = `${(p.melted * 100).toFixed(2)}%`;
  $('meter-sub').innerHTML = live
    ? `Every coin launched here burns <b>${off}</b> off.`
    : `Every coin launched here burns <b>${off}</b> off. Buybacks start with $WICK.`;
  document.querySelectorAll('[data-t="match"]').forEach((el) => { el.textContent = off; });
  document.querySelectorAll('[data-t="total"]').forEach((el) => { el.textContent = span(c.durationMs); });
  if (!scene?.burning) scene?.setCandle({ melted: p.melted, heat: world.heat / HEAT_FULL });
  if (document.body.classList.contains('no-webgl')) {
    $('css-candle').style.setProperty('--h', `${Math.max(4, (1 - p.melted) * 100)}%`);
  }
}

function renderStats() {
  const t = world.totals, b = world.buyback;
  const ticker = world.token?.ticker || 'WICK';
  $('stats').querySelector('dt').textContent = `$${ticker} burned`;
  $('st-burned').textContent = t.burned ? compact(t.burned) : '0';
  $('st-pot').textContent = b.live && b.potSol != null ? sol(b.potSol) : 'soon';
  $('st-buybacks').textContent = fmt(t.buybacks);
}

function historyLine(h) {
  const ticker = world.token?.ticker || 'WICK';
  const link = (sig, text) => (sig ? `<a href="${solscan(esc(sig))}" target="_blank" rel="noopener">${text}</a>` : text);
  let what;
  if (h.status === 'burned' && h.burned > 0) {
    what = `${sol(h.buySol)} → ${link(h.burnSig, `<b>${compact(h.burned)} $${esc(ticker)}</b> burned 🔥`)}`;
  } else if (h.note === 'not_live' || (h.status === 'ended' && !world.buyback.live)) {
    what = 'no buyback yet';
  } else if (['ended', 'buying', 'bought', 'burning_tx'].includes(h.status)) {
    what = '<span class="pulse-text">buyback in progress…</span>';
  } else if (h.note === 'not_live') {
    what = 'no buyback yet';
  } else if (h.note === 'empty_pot') {
    what = 'pot too small, carried over';
  } else {
    what = 'buyback missed, pot carried over';
  }
  return `<li><span class="mono">#${h.number}</span><span>${what}</span></li>`;
}

function feedItem(m) {
  return `<li class="fi${world.mine.has(m.mint) ? ' mine' : ''}">
    <a href="${pumpUrl(m.mint)}" target="_blank" rel="noopener">
      ${avatar(m)}
      <span class="fi-main"><b>$${esc(m.symbol)}</b><span>${esc(m.name)}</span></span>
      <span class="fi-meta"><span class="mono">#${fmt(m.seq)}</span><time data-at="${m.at}">${ago(m.at)}</time></span>
    </a></li>`;
}

function renderFeed() {
  const items = world.matches.slice(-40).reverse();
  $('feed').innerHTML = items.length
    ? items.map(feedItem).join('')
    : '<li class="fi-empty">No match yet on this candle.<br>Strike the first one.</li>';
  $('finals').hidden = !world.history.length;
  $('finals-list').innerHTML = world.history.map(historyLine).join('');
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

function applyState(data, first) {
  world.token = data.token;
  world.launch = data.launch;
  world.heat = data.heat;
  const rolled = world.candle && data.candle.number !== world.candle.number;
  const known = new Set(world.matches.map((m) => m.mint));
  const incoming = data.matches.filter((m) => m.seq > world.lastSeq && !known.has(m.mint));
  world.lastSeq = Math.max(world.lastSeq, data.total);
  world.clock = data.now - Date.now();
  world.history = data.history || [];
  world.totals = data.totals || world.totals;
  world.buyback = data.buyback || world.buyback;
  announceBurns(first);

  if (first || !world.candle) {
    world.candle = data.candle;
    world.matches = data.matches;
    scene?.setMatches(world.matches);
  } else if (rolled) {
    // La bougie a fondu : les allumettes plongent dans la flamme, puis une nouvelle sort de la flaque.
    const nextCandle = data.candle;
    toast(`<span>🕯️ <b>Candle #${world.candle.number} burned out.</b> ${
      world.buyback.live ? `Buying back $${esc(world.token?.ticker || 'WICK')}…` : 'A new one is lit.'}</span>`, 6500);
    world.candle = { ...world.candle, startedAt: -Infinity };
    scene?.setCandle({ melted: 1, heat: data.heat / HEAT_FULL });
    const after = () => {
      world.candle = nextCandle;
      world.matches = data.matches;
      for (const m of data.matches) { scene?.addMatch(m); world.fresh.set(m.mint, performance.now()); }
      renderMeter();
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
      if (!world.mine.has(m.mint)) toast(`${avatar(m, 22)}<span><b>$${esc(m.symbol)}</b> struck a match</span>`);
    }
  }
  renderMeter();
  renderStats();
  renderFeed();
  renderToken();
}

// Un buyback vient d'être brûlé : on l'annonce (pas au premier chargement).
function announceBurns(first) {
  const burned = world.history.filter((h) => h.status === 'burned' && h.burned > 0);
  if (!world.seenBurns) { world.seenBurns = new Set(burned.map((h) => h.number)); return; }
  for (const h of burned) {
    if (world.seenBurns.has(h.number)) continue;
    world.seenBurns.add(h.number);
    if (!first) toast(`<span>🔥 <b>${compact(h.burned)} $${esc(world.token?.ticker || 'WICK')} burned</b> · ${sol(h.buySol)} bought back with candle #${h.number}</span>`, 7000);
  }
}

let polling = false;
async function poll(first = false) {
  if (polling) return;
  polling = true;
  try {
    const data = await api.state(first ? 0 : world.lastSeq);
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
    <div><b>$${esc(m.symbol)}</b><span>${esc(m.name)}</span>
    <small class="mono">match #${fmt(m.seq)} · by ${esc(short(m.creator))} · ${ago(m.at)}</small></div>`;
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
  const c = world.candle;
  const total = span(c?.durationMs ?? 1_800_000);
  const off = span(c?.matchMs ?? 60_000);
  const ticker = esc(world.token?.ticker || 'WICK');
  openModal(`
    <h2>How it works</h2>
    <ol class="how">
      <li><b>One giant candle.</b> Everyone sees the same one, burning live. Left alone, it lasts ${total}.</li>
      <li><b>Strike a match = launch a coin.</b> Pick a name, a ticker and an image: your coin is created on
        pump.fun, signed by your own wallet. You are its creator.</li>
      <li><b>Every coin is a match that melts the candle faster</b>: ${off} off per
        launch. The more launches, the more often it burns out.</li>
      <li><b>When the flame dies, $${ticker} is bought back and burned.</b> The pot is the $${ticker} creator fees.
        Every buyback and every burn is on-chain, with its Solscan link. Then a new candle is lit.</li>
      <li><b>The more coins, the bigger the flame.</b> Launches from the last 10 minutes make it burn harder.</li>
    </ol>
    <div class="note">
      <b>Your keys stay yours.</b> The site never sees them and never asks for a seed phrase. Every transaction
      shows up in your wallet before you sign. Creating a coin costs about 0.02 SOL plus network fees,
      plus your dev buy if you choose one.
    </div>
    <p class="muted small">WICK is a meme. Coins launched here are made by their creators, not by WICK.
    Nothing here is financial advice.</p>`, 'm-how');
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
};

let busy = false;
let draft = { fields: {}, image: null, preview: null };

function launchForm(error = '') {
  const f = draft.fields;
  const max = world.launch?.maxDevBuy ?? 5;
  openModal(`
    <h2>Strike a match</h2>
    <p class="muted">Launch a real coin on pump.fun. It joins the orbit and the candle melts a little.</p>
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
      <p class="cost">≈ 0.02 SOL to create + network fees + dev buy. Your wallet signs, your coin, your creator fees.</p>
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
  const share = `I just struck a match: $${m.symbol} is melting the WICK candle 🕯️🔥\n${location.origin}`;
  openModal(`
    <div class="lit">${avatar(m, 72)}</div>
    <h2><span class="grad">$${esc(m.symbol)}</span> is lit</h2>
    <p class="muted">Match #${fmt(m.seq)} is orbiting candle #${world.candle?.number ?? 1} and just burned
    ${span(world.candle?.matchMs ?? 60_000)} off it. Look for the label.</p>
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
    $('demo-bar').innerHTML = 'Demo · a simulated, sped-up world (2-minute candles) · <a href="/">see the real candle</a>';
  }
  $('strike-btn').addEventListener('click', () => launchForm());
  wireIntro();
  $('how-btn').addEventListener('click', howItWorks);
  $('feed-toggle').addEventListener('click', () => document.body.classList.toggle('feed-open'));
  wirePointer();
  setInterval(() => {
    if (!document.hidden) poll();
    document.querySelectorAll('time[data-at]').forEach((t) => { t.textContent = ago(Number(t.dataset.at)); });
  }, POLL_MS);
  // Le compte à rebours, chaque seconde. À zéro, on demande plus souvent la nouvelle bougie.
  setInterval(() => {
    if (!world.candle || document.hidden) return;
    renderMeter();
    if (candleNow().remaining === 0 && !scene?.burning) poll();
  }, 1000);
  startScene();
  poll(true);
}

start();
