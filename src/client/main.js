// Le site de WICK : chacun sa bougie. Navigation, scène 3D, gestes, classement, pages.
import { CONFIG } from '../../lib/config.js';
import { idleLine } from '../../lib/lines.js';
import { isSolanaAddress, shortAddress } from '../../lib/rewards.js';
import { WORDS, normalizePhrase } from '../../lib/players.js';
import { makeCard } from './card.js';
import { SPEEDS, createDemo } from './demo.js';
import { renderWick } from './fallback2d.js';
import { T } from './i18n.js';
import { ICONS } from './icons.js';
import { createScene } from './scene3d.js';

// ------------------------------------------------------------ mode démo (?demo)
const DEMO = new URLSearchParams(location.search).has('demo');
const demo = DEMO ? createDemo() : null;
let demoPhrase = null;

// ------------------------------------------------------------ mémoire locale
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
// Le site est uniquement en anglais.
const lang = 'en';
// En démo, on ne touche jamais au vrai jeton du visiteur.
let token = DEMO ? null : store.get('wick.token');
const t = () => T;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WARN = (text) => `<p class="warn">${ICONS.lock}<span>${text}</span></p>`;
const STAGES = ['allumette', ...CONFIG.stages.map((s) => s.key)];

// ------------------------------------------------------------ état
let data = null;          // la dernière réponse du serveur
let cooldownsAt = 0;
let viewingId = null;     // #/b/12 : on regarde la bougie de quelqu'un d'autre
let viewing = null;
let thought = null;
let reactionUntil = 0;
let bubbleKey = '';
let bubbleAt = 0;
let flamesAt = 0;
let flamesKey = '';
let chartMint = null;
let view = 'home';

// ------------------------------------------------------------ formats
function dur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function pct(n) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`;
}
function usd(n, compact = true) {
  if (n == null) return '—';
  const opts = compact
    ? { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }
    : { style: 'currency', currency: 'USD', ...(n < 1 ? { maximumSignificantDigits: 4 } : { maximumFractionDigits: 2 }) };
  return new Intl.NumberFormat('en-US', opts).format(n);
}
const num = (n) => new Intl.NumberFormat('en-US').format(n ?? 0);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const fullName = (c) => `${c.name}${c.gen > 1 ? ` ${ROMAN[c.gen] || c.gen}` : ''}`;
const stageName = (k) => t().stages[k] || k;
const mood = () => data?.market?.mood || 'calme';
const trackLabel = () => (data.market.tracking === 'sol' ? 'SOL' : `$${data.market.symbol || data.token.ticker}`);
const upDown = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
// N'écrit dans la page que si le contenu a changé (sinon les boutons seraient
// recréés sous le doigt du visiteur à chaque rafraîchissement).
function setHtml(el, html) {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

// La bougie affichée : celle qu'on regarde, sinon la mienne (null = l'allumette).
const shown = () => (viewingId ? viewing : data?.candle ?? null);
// Une bougie qui a faim est stressée, même quand le chart va bien.
function feel(c) {
  const m = mood();
  return c?.alive && c.hungry && ['calme', 'content', 'euphorie'].includes(m) ? 'stress' : m;
}

// ------------------------------------------------------------ réseau
async function api(path, opts = {}) {
  if (demo) return demo.api(path, opts);
  const headers = { ...(opts.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let body = null;
  try { body = await res.json(); } catch { /* vide */ }
  return { ok: res.ok, status: res.status, body: body || {} };
}
// En démo, le temps est accéléré : les délais fondent plus vite.
const timeScale = () => (demo ? demo.speed : 1);

// ------------------------------------------------------------ scène
const stageEl = $('stage');
let scene = null;
try {
  scene = createScene(stageEl, { onPoke: poke });
} catch (err) {
  console.warn('3D indisponible, dessin 2D', err);
  stageEl.classList.add('fallback');
}

function drawScene() {
  const c = shown();
  const m = mood();
  const props = c
    ? { stage: c.stage, lit: c.alive, wax: c.wax, mood: feel(c), shielded: false, windy: c.alive && m === 'panique', look: c.look }
    : { stage: 'allumette', lit: false, wax: 0, mood: m, shielded: false, windy: false, look: null };
  document.body.dataset.mood = m;
  document.body.classList.toggle('is-out', Boolean(c && !c.alive));
  document.body.classList.toggle('has-candle', Boolean(data.candle));
  if (scene) {
    scene.update(props);
    // Les autres bougies vivantes tournent autour de la tienne (rafraîchies toutes les 10 s au plus).
    const list = (data.around || []).filter((f) => f.id !== String(c?.id)).map((f) => ({ ...f, name: '' }));
    const key = list.map((f) => f.id).join(',');
    if (key !== flamesKey && (Date.now() - flamesAt > 10_000 || !flamesKey)) {
      flamesKey = key;
      flamesAt = Date.now();
      scene.setFlammeches(list, null);
    }
  } else {
    stageEl.innerHTML = renderWick(props);
  }
}

// La bulle suit le haut de la bougie.
if (scene) {
  const bubble = $('bubble');
  const card = stageEl.parentElement;
  scene.onFrame(() => {
    const a = scene.anchor();
    const w = card.clientWidth;
    const bw = bubble.offsetWidth;
    const x = Math.max(bw / 2 + 12, Math.min(w - bw / 2 - 12, a.x));
    const y = Math.max(bubble.offsetHeight + (w < 600 ? 70 : 78), a.y - 10);
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
  });
}

// ------------------------------------------------------------ rendu : accueil
function drawHud() {
  const c = shown();
  const m = mood();
  $('hud-id').textContent = viewingId ? `${t().hudOther} #${viewingId}` : c ? `${t().hudMine} · #${c.id}` : t().hudMatch;
  $('hud-name').textContent = c ? fullName(c) : t().notLit;
  $('hud-sub').textContent = !c ? '' : c.alive ? `${stageName(c.stage)} · ${dur(c.ageMs)}` : t().deadAfter(dur(c.ageMs));
  const moodText = !c ? t().asleep : !c.alive ? t().out : c.hungry ? t().hungry : t().moods[m];
  $('mood-chip').innerHTML = `<i class="dot"></i>${t().mood} <strong>${moodText}</strong>`;
  const chip = $('market-chip');
  chip.innerHTML = `${esc(trackLabel())} 1h <strong>${pct(data.market.change1h)}</strong>`;
  chip.className = `chip ${upDown(data.market.change1h)}`;
  // Quand le chart monte, la bougie grandit plus vite : on l'affiche.
  const boost = $('boost-chip');
  boost.hidden = !(c?.alive && c.boost > 1);
  if (!boost.hidden) boost.innerHTML = `${ICONS.pulse}${esc(t().growthChip(fmtBoost(c.boost)))}`;

}

function drawKpis() {
  const s = data.stats;
  const rows = [
    [t().kpiAlive, num(s.alive)],
    [t().kpiDied, num(s.died24h)],
    [t().kpiBorn, num(s.born24h)],
    [t().kpiRecord, data.record ? dur(data.record.ageMs) : '—'],
  ];
  setHtml($('kpis'), rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join(''));
}

// Le bandeau qui défile : on ne reconstruit que si le nombre d'éléments change,
// sinon on met à jour les valeurs en place (l'animation continue sans à-coup).
let tickerCount = 0;
function drawTicker() {
  const m = data.market;
  const s = data.stats;
  const oldest = data.oldest?.[0];
  const last = data.feed?.[0];
  const items = [
    ['dot', `$${data.token.ticker}`, data.token.mint || (m.tracking === 'token' && m.priceUsd) ? usd(m.priceUsd, false) : t().tkSoon, ''],
    ['', `${trackLabel()} 1h`, pct(m.change1h), upDown(m.change1h)],
    ['', `${trackLabel()} 24h`, pct(m.change24h), upDown(m.change24h)],
    ['', t().tkMood, t().moods[m.mood], ''],
    ['', t().tkAlive, num(s.alive), ''],
    ['', t().tkDied, num(s.died24h), s.died24h ? 'down' : ''],
    ['', t().tkBorn, num(s.born24h), ''],
    oldest ? ['', t().tkOldest, `${oldest.name} · ${dur(oldest.ageMs)}`, ''] : null,
    last ? ['', t().tkLast, feedText(last).replace(/<[^>]+>/g, ''), ''] : null,
  ].filter(Boolean);
  const el = $('ticker');
  if (items.length !== tickerCount) {
    tickerCount = items.length;
    const group = `<div class="ticker-group">${items.map(([dot], i) => `<span class="tk">${dot ? '<i class="dot"></i>' : ''}<span data-l="${i}"></span> <b data-v="${i}"></b></span>`).join('')}</div>`;
    el.innerHTML = group.repeat(4);
  }
  items.forEach(([, label, value, cls], i) => {
    el.querySelectorAll(`[data-l="${i}"]`).forEach((n) => { if (n.textContent !== label) n.textContent = label; });
    el.querySelectorAll(`[data-v="${i}"]`).forEach((n) => { if (n.textContent !== value) n.textContent = value; n.className = cls; });
  });
}

function remaining(action) {
  return Math.max(0, (data?.cooldowns?.[action] ?? 0) - (Date.now() - cooldownsAt) * timeScale());
}

function actionList() {
  const c = shown();
  if (viewingId) return [data.candle?.alive ? 'back' : 'adopt', ...(c ? ['photo'] : [])];
  if (!c) return ['light'];
  if (!c.alive) return ['relight', 'photo'];
  return ['nourrir', 'photo'];
}

function drawActions() {
  const list = actionList();
  const html = list.map((a, i) => {
    const [label, sub] = t().actions[a];
    const cooldown = CONFIG.cooldown[a];
    const left = cooldown ? remaining(a) : 0;
    const big = ['light', 'relight', 'adopt'].includes(a);
    const cd = left > 0 ? `<i class="cd" style="width:${(left / cooldown) * 100}%"></i>` : '';
    return `<button class="act${big ? ' big' : ''}${a === 'photo' || a === 'back' ? ' ghost' : ''}" data-action="${a}" ${left > 0 ? 'disabled' : ''}>
      <span class="act-icon">${ICONS[a]}</span><span class="act-text"><b>${label}<kbd>${i + 1}</kbd></b><small>${left > 0 ? t().again(dur(left)) : sub}</small></span>${cd}</button>`;
  }).join('');
  setHtml($('actions'), html);
}

function segments(frac) {
  const n = 25;
  const on = Math.round(Math.max(0, Math.min(1, frac)) * n);
  return Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}${i === on - 1 && frac < 0.3 ? ' last' : ''}"></i>`).join('');
}

function drawVitals() {
  const c = shown();
  const el = $('vitals');
  if (c) el.style.setProperty('--me', c.color); else el.style.removeProperty('--me');
  const title = viewingId && c ? t().pOther(c.name) : t().pMine;
  const head = (right) => `<header class="panel-head"><span class="mono-label"><em>01</em>${esc(title)}</span><span class="muted">${right}</span></header>`;
  if (!c) {
    setHtml(el, `${head('')}
      <div class="me-row"><div class="me-flame">${ICONS.gratter}</div><div><div class="me-name">${t().notLit}</div><div class="me-sub">${t().noneText}</div></div></div>
      <div class="row-btns" style="margin-top:14px"><button class="link-btn" data-open="recover">${t().haveOne}</button></div>`);
    return;
  }
  const identity = `<div class="me-row"><div class="me-flame">${ICONS.flame}</div><div><div class="me-name">${esc(fullName(c))}</div>
    <div class="me-sub">${c.alive ? `${stageName(c.stage)} · ${t().age} ${dur(c.ageMs)}` : t().deadAfter(dur(c.ageMs))}</div></div></div>`;
  if (!c.alive) {
    setHtml(el, `${head(`#${c.id}`)}${identity}
      <div class="segs">${segments(0)}</div>
      <p class="vital-hint">${t().hintDead}</p>
      <div class="vital-grid">
        <div><span>${t().lived}</span><b>${dur(c.ageMs)}</b></div>
        <div><span>${t().feedsTitle}</span><b>${c.feeds}</b></div>
        <div><span>${t().genTitle}</span><b>${ROMAN[c.gen] || c.gen}</b></div>
      </div>
      ${lookHtml(c.look, c)}`);
    return;
  }
  const scared = mood() === 'panique' || mood() === 'stress';
  const hint = c.hungry ? t().hintHungry : c.boost > 1 ? t().hintBoost(fmtBoost(c.boost)) : scared ? t().hintScared : t().hintLit(dur(c.burnoutMs));
  setHtml(el, `${head(`#${c.id}`)}${identity}
    <div class="vital-row" style="margin-top:16px"><div class="vital-big">${Math.round(c.wax)}<small>/ ${c.waxMax} ${t().wax}</small></div>
      <div class="vital-side">${t().burnout}<b>≈ ${dur(c.burnoutMs)}</b></div></div>
    <div class="segs">${segments(c.wax / c.waxMax)}</div>
    <p class="vital-hint${c.hungry ? ' alert' : c.boost > 1 ? ' boost' : ''}">${hint}</p>
    <div class="vital-grid">
      <div><span>${t().meltTitle}</span><b>${t().melt(c.decayPerHour)}</b></div>
      <div><span>${t().growthTitle}</span><b class="${c.boost > 1 ? 'up' : ''}">×${fmtBoost(c.boost)}</b></div>
      <div><span>${t().feedsTitle}</span><b>${c.feeds}</b></div>
    </div>
    ${lookHtml(c.look, c)}`);
}

const fmtBoost = (b) => String(b);

// Le look unique d'une bougie : sa rareté et ses 4 traits.
function traitList(look) {
  const tr = t().traits;
  return [
    `${tr.wax} ${tr.waxes[look.wax.key]}`,
    `${tr.flame} ${tr.flames[look.flame.key]}`,
    look.accessory !== 'aucun' ? tr.accessories[look.accessory] : null,
  ].filter(Boolean);
}
function lookHtml(look, c) {
  if (!look) return '';
  return `<div class="look">
    ${c?.torchAt ? `<span class="badge-hof">${ICONS.trophy}${t().hallBadge}</span>` : ''}
    ${traitList(look).map((x) => `<span class="trait">${esc(x)}</span>`).join('')}</div>`;
}

function drawEvolution() {
  const c = shown();
  const idx = c ? c.stageIndex + 1 : 0;
  let label = '';
  let frac = 0;
  if (!c) label = t().notLit;
  else if (!c.alive) label = t().deadAfter(dur(c.ageMs));
  else if (c.nextStage) {
    label = t().nextIn(stageName(c.nextStage.key), dur(c.nextStage.inMs));
    const from = CONFIG.stages[c.stageIndex].age;
    frac = (c.ageMs - from) / (c.ageMs + c.nextStage.inMs - from);
  } else { label = t().finalForm; frac = 1; }
  setHtml($('evolution'), `
    <header class="panel-head"><span class="mono-label"><em>02</em>${t().pEvo}</span><span class="muted">${esc(label)}</span></header>
    <ol class="stepper">${STAGES.map((k, i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}">
      <span class="node">${i + 1}</span>${stageName(k)}<small>${t().stageAge[k]}</small></li>`).join('')}</ol>
    <div class="bar"><div class="bar-fill" style="width:${Math.max(2, Math.min(100, frac * 100))}%"></div></div>`);
}

function rankRow(c, i, mineId) {
  return `<a class="rank-row${c.id === mineId ? ' mine' : ''}${c.alive ? '' : ' dead'}" href="#/b/${c.id}">
    <span class="rank">${String(i + 1).padStart(2, '0')}</span>
    <span class="rank-dot" style="background:${esc(c.color)}"></span>
    <span class="rank-name"><span>${esc(fullName(c))}</span>${c.torchAt ? `<i class="rank-hof" title="${t().hallBadge}">${ICONS.trophy}</i>` : ''}${c.id === mineId ? `<em>${t().you}</em>` : ''}</span>
    <span class="rank-stage">${stageName(c.stage)}</span>
    <span class="rank-age">${dur(c.ageMs)}</span></a>`;
}

function drawPodium() {
  const s = data.stats;
  const mineId = data.candle?.id;
  const list = (data.oldest || []).slice(0, 5);
  setHtml($('podium'), `
    <header class="panel-head"><span class="mono-label"><em>${data.reward ? '04' : '03'}</em>${t().pTop}</span><span class="muted">${ICONS.trophy}</span></header>
    <div class="podium-stats"><span><i class="dot-live"></i>${t().aliveNow(num(s.alive))}</span><span class="down">${t().died24(num(s.died24h))}</span></div>
    <div class="rank-list">${list.length ? list.map((c, i) => rankRow(c, i, mineId)).join('') : `<p class="muted">${t().emptyTop}</p>`}</div>
    <a class="see-all" href="#/leaderboard">${t().seeTop} →</a>`);
}

// 03 · La récompense de la semaine (seulement si le dev l'a activée).
function drawReward() {
  const el = $('reward');
  const r = data.reward;
  el.hidden = !r;
  if (!r) return;
  const left = r.nextAt - data.now - (Date.now() - cooldownsAt) * timeScale();
  const me = data.me;
  const c = data.candle;
  let mine;
  if (!c?.alive) mine = `<p class="reward-me muted">${t().rewardNeedCandle}</p>`;
  else if (!me?.payout) mine = `<div class="reward-me"><p class="muted">${t().rewardNoAddress}</p><button class="btn primary" data-open="payout">${t().rewardAdd}</button></div>`;
  else mine = `<div class="reward-me row"><span>${me.rewardRank ? t().rewardYouRank(me.rewardRank) : ''}</span>
    <button class="link-btn" data-open="payout">${esc(shortAddress(me.payout))} · ${t().rewardEdit}</button></div>`;
  setHtml(el, `
    <header class="panel-head"><span class="mono-label"><em>03</em>${t().pReward}</span><span class="muted">${t().rewardNext(dur(Math.max(0, left)))}</span></header>
    <p class="reward-line">${t().rewardLine(esc(r.share))}</p>
    ${r.pool ? `<p class="reward-pool">${t().rewardPool(esc(r.pool))}</p>` : ''}
    <div class="rank-list">${r.contenders.length ? r.contenders.map((x, i) => rankRow(x, i, c?.id)).join('') : `<p class="muted">${t().rewardEmpty}</p>`}</div>
    ${viewingId ? '' : mine}`);
}

function feedText(e) {
  const f = t().feed;
  const who = `<span class="who">${esc(e.who || 'anon')}</span>`;
  if (e.kind === 'reward') return `$ ${f.reward(who, e.detail)}`;
  if (e.kind === 'born') return `★ ${f.born(who, Number(e.detail) || 1)}`;
  if (e.kind === 'evolved') return `▲ ${f.evolved(who, stageName(e.detail))}`;
  if (e.kind === 'died') return `✕ ${f.died(who, dur(Number(e.detail)))}`;
  return `${who} <span class="op">→</span> ${f[e.kind] || e.kind}`;
}

function clock(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function drawFeed() {
  const feed = data.feed || [];
  const el = $('feed');
  if (!feed.length) { setHtml(el, `<li><time>--:--</time><span class="txt">${t().empty}</span></li>`); return; }
  const mineId = data.candle?.id;
  const html = feed.map((e) => {
    const cls = [e.kind === 'died' ? 'died' : '', e.kind === 'born' || e.kind === 'evolved' ? 'big' : '', e.candle && e.candle === mineId ? 'mine' : ''].filter(Boolean).join(' ');
    return `<li class="${cls}"${e.candle ? ` data-go="${e.candle}"` : ''}><time>${clock(e.at)}</time><span class="txt">${feedText(e)}</span></li>`;
  }).join('');
  setHtml(el, html);
}

function drawNav() {
  const tk = data.token;
  document.querySelectorAll('.tab-ticker').forEach((el) => { el.textContent = `$${tk.ticker}`; });
  const buy = $('buy-btn');
  if (tk.mint) {
    buy.classList.remove('soon');
    buy.href = `https://pump.fun/coin/${tk.mint}`;
    setHtml(buy, `${esc(t().buy)}${ICONS.arrow}`);
  } else {
    buy.classList.add('soon');
    buy.removeAttribute('href');
    setHtml(buy, `<span>${t().soon}</span>`);
  }
  if (tk.x) { $('x-link').hidden = false; $('x-link').href = tk.x; }
  if (tk.telegram) { $('tg-link').hidden = false; $('tg-link').href = tk.telegram; }
  const me = data.me;
  $('me-btn').hidden = !me;
  if (me) {
    $('me-btn-name').textContent = me.name;
    document.body.style.setProperty('--me', me.color);
  }
}

function setOnline(on) {
  $('status').classList.toggle('off', !on);
  $('status-text').textContent = demo ? t().demoTag : on ? t().live : t().offline;
}

// ------------------------------------------------------------ rendu : classement
function drawTop() {
  const mineId = data.candle?.id;
  const r = data.record;
  const table = (list, empty) => (list.length
    ? `<div class="rank-list big">${list.map((c, i) => rankRow(c, i, mineId)).join('')}</div>`
    : `<p class="muted" style="padding:8px 0">${empty}</p>`);
  setHtml($('top-page'), `
    <header class="page-head"><p class="eyebrow">${t().topEyebrow}</p><h1>${t().topTitle}</h1><p class="lead">${t().topLead}</p></header>
    ${r ? `<a class="card record-card" href="#/b/${r.id}" style="--me:${esc(r.color)}">
      <span class="record-ico">${ICONS.trophy}</span>
      <div><span class="mono-label">${t().recordTitle}</span><h2>${esc(fullName(r))}</h2>
        <p class="muted">${stageName(r.stage)} · ${r.alive ? t().recordAlive : t().recordDead}</p></div>
      <b class="record-age">${dur(r.ageMs)}</b></a>` : ''}
    <div class="top-grid">
      <section class="card"><header class="panel-head"><span class="mono-label"><i class="dot-live"></i>${t().aliveTitle} · ${num(data.stats.alive)}</span></header>
        ${table(data.oldest || [], t().emptyTop)}</section>
      <section class="card"><header class="panel-head"><span class="mono-label">${ICONS.skull}${t().graveTitle} · ${num(data.stats.died24h)} / 24h</span></header>
        ${table(data.graveyard || [], t().graveEmpty)}</section>
    </div>
    ${rewardCard()}
    <h2 class="section-title">${t().hallTitle}</h2>
    <section class="card hall"><p class="muted" style="margin:0 0 10px">${t().hallLead}</p>
      ${table(data.hallOfFame || [], t().hallEmpty)}</section>`);
}

// Les derniers gagnants de la semaine, avec la preuve de paiement quand elle existe.
function rewardCard() {
  const r = data.reward;
  if (!r) return '';
  const last = r.last;
  return `<h2 class="section-title">${t().pReward}</h2>
    <section class="card reward-card">
      <p class="reward-line">${t().rewardLine(esc(r.share))} <span class="muted">${t().rewardNext(dur(Math.max(0, r.nextAt - data.now)))}</span></p>
      ${r.pool ? `<p class="reward-pool">${t().rewardPool(esc(r.pool))}</p>` : ''}
      ${last ? `<header class="panel-head" style="margin-top:14px"><span class="mono-label">${t().lastWinners} · ${new Date(last.week).toUTCString().slice(0, 16)}</span></header>
        <div class="rank-list big">${last.winners.map((w) => `<div class="rank-row winner">
          <span class="rank">#${w.rank}</span><span class="rank-dot" style="background:${esc(w.color)}"></span>
          <a class="rank-name" href="#/b/${w.id}"><span>${esc(w.name)}</span></a>
          <span class="rank-stage addr">${esc(w.address || '')}</span>
          ${w.tx ? `<a class="rank-age paid" href="https://solscan.io/tx/${esc(w.tx)}" target="_blank" rel="noopener">${t().paid} ↗</a>` : `<span class="rank-age muted">${t().pending}</span>`}
        </div>`).join('')}</div>` : ''}
      <p class="photo-tip">${t().payoutTerms}</p>
    </section>`;
}

// ------------------------------------------------------------ rendu : pages
function drawCoin() {
  const tk = data.token;
  const m = data.market;
  const el = $('coin-page');
  if (!tk.mint) {
    chartMint = null;
    el.innerHTML = `
      <header class="page-head"><p class="eyebrow">${t().coinEyebrow}</p><h1>$${esc(tk.ticker)}</h1></header>
      <div class="card soon-card">
        <span class="big-flame">${ICONS.flame}</span>
        <h2>${t().coinSoonTitle}</h2>
        <p>${t().coinSoonText}</p>
        ${tk.x ? `<p style="margin-top:18px"><a class="btn primary" style="display:inline-flex;flex:none" href="${esc(tk.x)}" target="_blank" rel="noopener">${t().coinFollow}${ICONS.arrow}</a></p>` : ''}
      </div>
      <h2 class="section-title">${m.tracking === 'sol' ? t().coinSolTitle : trackLabel()}</h2>
      <div class="stat-grid">
        <div class="stat"><span>${t().price}</span><b>${usd(m.priceUsd, false)}</b></div>
        <div class="stat"><span>${t().ch1h}</span><b class="${upDown(m.change1h)}">${pct(m.change1h)}</b></div>
        <div class="stat"><span>${t().ch24h}</span><b class="${upDown(m.change24h)}">${pct(m.change24h)}</b></div>
      </div>
      <div style="margin-top:12px">${WARN(t().officialWarn)}</div>`;
    return;
  }
  const links = [
    [t().buyPump, `https://pump.fun/coin/${tk.mint}`, true],
    [t().dexs, m.url || `https://dexscreener.com/solana/${tk.mint}`],
    [t().solscan, `https://solscan.io/token/${tk.mint}`],
    [t().birdeye, `https://birdeye.so/token/${tk.mint}?chain=solana`],
  ];
  const top = `
    <header class="page-head"><p class="eyebrow">${t().coinEyebrow}</p><h1>$${esc(tk.ticker)}</h1></header>
    <div class="coin-hero">
      <div class="card price-card">
        <span class="muted">${t().price}</span>
        <div class="price">${usd(m.priceUsd, false)}</div>
        <div class="changes">
          <span class="chip ${upDown(m.change1h)}">${t().ch1h} <strong>${pct(m.change1h)}</strong></span>
          <span class="chip ${upDown(m.change24h)}">${t().ch24h} <strong>${pct(m.change24h)}</strong></span>
        </div>
        <div class="stat-grid">
          <div class="stat"><span>${t().mcap}</span><b>${usd(m.marketCap)}</b></div>
          <div class="stat"><span>${t().vol}</span><b>${usd(m.volume24h)}</b></div>
          <div class="stat"><span>${t().liq}</span><b>${usd(m.liquidity)}</b></div>
        </div>
      </div>
      <div class="card price-card">
        <span class="muted">${t().ca}</span>
        <div class="ca-box"><code>${esc(tk.mint)}</code><button class="btn" style="flex:none" data-copy="${esc(tk.mint)}">${ICONS.copy}${t().copy}</button></div>
        <div class="links">${links.map(([label, href, primary]) => `<a class="btn${primary ? ' primary' : ''}" href="${esc(href)}" target="_blank" rel="noopener">${label}${ICONS.arrow}</a>`).join('')}</div>
        ${WARN(t().officialWarn)}
      </div>
    </div>`;
  // On garde l'iframe du chart d'un rafraîchissement à l'autre.
  if (chartMint !== tk.mint) {
    el.innerHTML = `<div id="coin-top"></div>
      <div class="card chart-card"><iframe title="${t().chartTitle}" loading="lazy"
        src="https://dexscreener.com/solana/${encodeURIComponent(tk.mint)}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15"></iframe></div>`;
    chartMint = tk.mint;
  }
  setHtml($('coin-top'), top);
}

// Sans récompense activée, la 4e étape ne parle que du Hall of Fame (on ne promet rien).
function howSteps() {
  const steps = [...t().steps];
  if (!data?.reward) steps[3] = t().stepHall;
  return steps;
}

function drawHow() {
  const stepIcons = [ICONS.gratter, ICONS.chart, ICONS.nourrir, ICONS.trophy];
  $('how-page').innerHTML = `
    <header class="page-head"><p class="eyebrow">${t().howEyebrow}</p><h1>${t().howTitle}</h1><p class="lead">${t().howLead}</p></header>
    <div class="steps">${howSteps().map(([title, text], i) => `
      <div class="card step"><span class="step-num">0${i + 1}</span><span class="step-ico">${stepIcons[i]}</span><h2>${title}</h2><p>${text}</p></div>`).join('')}
    </div>
    <h2 class="section-title">${t().evoTitle}</h2>
    <div class="card"><div class="evo-row">${STAGES.map((k, i) => `<div><span>0${i + 1}</span>${stageName(k)}<small>${t().stageAge[k]}</small></div>`).join('')}</div></div>
    <h2 class="section-title">${t().faqTitle}</h2>
    <div class="faq">${t().faq.filter(([q]) => data?.reward || !q.startsWith('How does the weekly')).map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
    <div style="margin-top:24px">${WARN(t().notSeed)}</div>`;
}

function drawDemoBar() {
  if (!demo) return;
  const bar = $('demo-bar');
  bar.hidden = false;
  bar.innerHTML = `<span class="demo-tag">${t().demoTag}</span><span class="demo-text">${t().demoText}</span>
    <span class="demo-speeds"><span class="mono-label">${t().demoSpeed}</span>${SPEEDS.map((s) => `<button data-speed="${s}" class="${demo.speed === s ? 'on' : ''}">×${num(s)}</button>`).join('')}</span>
    <a class="demo-exit" href="${location.pathname}">${t().demoExit}</a>`;
}

function drawAll() {
  if (!data) return;
  drawNav();
  drawScene();
  drawHud();
  drawKpis();
  drawTicker();
  drawActions();
  drawVitals();
  drawEvolution();
  drawReward();
  drawPodium();
  drawFeed();
  showLine();
  if (view === 'top') drawTop();
  if (view === 'coin') drawCoin();
}

function applyStaticTexts() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t()[el.dataset.i18n]; });
  $('foot-meta').textContent = t().footMeta;
  $('actions').dataset.html = '';
  tickerCount = 0;
  drawDemoBar();
}

// ------------------------------------------------------------ bulle
function say(text, tag) {
  $('bubble-text').textContent = text;
  $('bubble-tag').hidden = !tag;
  $('bubble-tag').textContent = tag || '';
  const b = $('bubble');
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
}
// Ce que dit la bougie au repos : l'allumette t'appelle, la morte se tait, l'affamée
// réclame, et sinon la pensée du moment. On ne change de réplique que si la situation
// change, ou toutes les 25 secondes.
function showLine() {
  if (Date.now() < reactionUntil) return;
  const c = shown();
  const state = !c ? 'none' : !c.alive ? 'dead' : c.hungry ? 'hungry' : `ok:${mood()}:${thought?.mood === mood() ? thought.text : ''}`;
  if (state === bubbleKey && Date.now() - bubbleAt < 25_000) return;
  bubbleKey = state;
  bubbleAt = Date.now();
  // La pensée du moment n'est dite que si elle correspond encore à l'humeur actuelle.
  if (state.startsWith('ok') && thought?.mood === mood() && !viewingId) say(thought.text, thought.ai ? t().thoughtTag : '');
  else say(idleLine(lang, c, feel(c)));
}
function poke() {
  const lines = t().poke;
  say(lines[Math.floor(Math.random() * lines.length)]);
  reactionUntil = Date.now() + 4000;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ------------------------------------------------------------ chargements
function accept(body) {
  data = body;
  cooldownsAt = Date.now();
}

async function loadState() {
  const { ok, body } = await api('/api/state').catch(() => ({ ok: false }));
  setOnline(ok);
  if (!ok) return;
  if (!body.me && token) {
    // Jeton inconnu (le site a été remis à zéro) : on l'oublie.
    token = null;
    store.del('wick.token');
    store.del('wick.phrase');
  }
  accept(body);
  if (viewingId) await loadViewing();
  drawAll();
}

async function loadViewing() {
  const { ok, body } = await api(`/api/candle?id=${viewingId}`).catch(() => ({ ok: false, body: {} }));
  if (ok) { viewing = body.candle; return; }
  toast(t().notFound);
  location.hash = '#/';
}

async function loadThought() {
  const { ok, body } = await api(`/api/thought?lang=${lang}`).catch(() => ({ ok: false }));
  if (ok) { thought = body; bubbleKey = ''; showLine(); }
}

// ------------------------------------------------------------ gestes
async function light() {
  if (viewingId) location.hash = '#/';
  document.querySelectorAll('[data-action]').forEach((b) => { b.disabled = true; });
  scene?.react('gratter');
  const { ok, body } = await api('/api/light', { method: 'POST', body: { lang } }).catch(() => ({ ok: false, body: {} }));
  if (!ok) {
    say(body.line || t().error);
    reactionUntil = Date.now() + 6000;
    drawActions();
    return;
  }
  if (body.welcome) {
    if (demo) demoPhrase = body.welcome.phrase;
    else {
      token = body.welcome.token;
      store.set('wick.token', token);
      store.set('wick.phrase', body.welcome.phrase);
    }
  }
  accept(body);
  flamesKey = '';
  drawAll();
  setTimeout(() => scene?.react('special'), 250);
  say(body.line);
  reactionUntil = Date.now() + 8000;
  if (body.welcome) setTimeout(() => openWelcome(body.me, body.welcome.phrase), 1400);
}

async function act(action) {
  const btn = document.querySelector(`[data-action="${action}"]`);
  if (btn) btn.disabled = true;
  scene?.react(action === 'nourrir' ? 'cire' : action);
  const { ok, body } = await api('/api/act', { method: 'POST', body: { action, lang } }).catch(() => ({ ok: false, body: {} }));
  if (body.line) { say(body.line); reactionUntil = Date.now() + 7000; }
  if (body.candle !== undefined) accept(body);
  if (!ok && !body.line) say(t().error);
  drawAll();
}

const shareUrl = (c) => `${location.origin}/#/b/${c.id}`;
function shareText(c) {
  return c.alive ? t().shareAlive(fullName(c), dur(c.ageMs), stageName(c.stage)) : t().shareDead(fullName(c), dur(c.ageMs));
}
function postOnX() {
  const c = shown();
  if (!c) return;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText(c))}&url=${encodeURIComponent(shareUrl(c))}`, '_blank', 'noopener');
}

function run(action) {
  if (action === 'light' || action === 'relight' || action === 'adopt') return light();
  if (action === 'photo') return openPhoto();
  if (action === 'back') { location.hash = '#/'; return undefined; }
  return act(action);
}

// ------------------------------------------------------------ la photo à partager
let photoBlob = null;

async function openPhoto() {
  const c = shown();
  if (!c) return;
  if (!scene) { postOnX(); return; }
  openModal(`<h2>${t().photoTitle}</h2><div class="photo-wait">${t().photoWait}</div>`);
  const shot = scene.capture(1080);
  const statusLabel = c.alive ? `${stageName(c.stage)} · ${dur(c.ageMs)}` : t().deadAfter(dur(c.ageMs));
  const canvas = await makeCard(shot, {
    name: fullName(c),
    id: c.id,
    alive: c.alive,
    statusLabel,
    badge: c.torchAt ? t().hallBadge : c.look.legacy ? t().eternalBadge : null,
    flameColor: c.look.flame.color,
    traits: [...(c.torchAt ? [t().hallBadge] : []), ...traitList(c.look)],
    site: location.host,
    tagline: t().cardTagline,
  });
  photoBlob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(photoBlob);
  const file = new File([photoBlob], `wick-${c.id}.png`, { type: 'image/png' });
  const canShare = navigator.canShare?.({ files: [file] });
  const canCopy = typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write;
  openModal(`
    <h2>${t().photoTitle}</h2>
    <p>${t().photoText}</p>
    <img class="photo-card" src="${url}" alt="${esc(fullName(c))}">
    <div class="row-btns photo-btns">
      ${canShare ? `<button class="btn primary" data-photo="share">${ICONS.share}${t().photoShare}</button>` : ''}
      <button class="btn${canShare ? '' : ' primary'}" data-photo="x">${t().photoX}${ICONS.arrow}</button>
      ${canCopy ? `<button class="btn" data-photo="copy">${ICONS.copy}${t().photoCopy}</button>` : ''}
      <a class="btn" href="${url}" download="wick-${c.id}.png">${t().photoSave}</a>
    </div>
    <p class="photo-tip">${canShare ? t().photoTipMobile : t().photoTipDesktop}</p>`);
}

async function photoAction(kind, el) {
  const c = shown();
  if (!photoBlob || !c) return;
  if (kind === 'share') {
    const file = new File([photoBlob], `wick-${c.id}.png`, { type: 'image/png' });
    try { await navigator.share({ files: [file], text: shareText(c), url: shareUrl(c) }); } catch { /* annulé */ }
  }
  if (kind === 'copy') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': photoBlob })]);
      el.textContent = t().copied;
    } catch { toast(t().error); }
  }
  if (kind === 'x') postOnX();
}

// ------------------------------------------------------------ fenêtres
const modal = $('modal');
function openModal(html) {
  $('modal-body').innerHTML = html;
  if (!modal.open) modal.showModal();
}
const wordsHtml = (phrase, blur = false) => `<div class="words${blur ? ' blur' : ''}" id="words">${phrase.split(' ').map((w) => `<span>${esc(w)}</span>`).join('')}</div>`;
const myPhrase = () => (demo ? demoPhrase : store.get('wick.phrase'));

function openWelcome(me, phrase) {
  openModal(`
    <div class="hello"><div class="me-flame" style="--me:${esc(me.color)}">${ICONS.flame}</div>
      <div><p class="eyebrow">${t().welcomeEyebrow}</p><h2>${esc(me.name)}</h2></div></div>
    <p>${t().welcomeText}</p>
    <h3 style="margin:18px 0 4px">${ICONS.key}${t().phraseTitle}</h3>
    <p>${t().phraseText}</p>
    ${wordsHtml(phrase)}
    ${WARN(t().notSeed)}
    <div class="row-btns" style="margin-top:16px">
      <button class="btn" data-copy-phrase>${t().copy}</button>
      <button class="btn primary" data-close>${t().noted}</button>
    </div>`);
}

function openMe() {
  const me = data?.me;
  if (!me) return openRecover();
  const phrase = myPhrase();
  openModal(`
    <div class="hello"><div class="me-flame" style="--me:${esc(me.color)}">${ICONS.flame}</div>
      <div><p class="eyebrow">${t().meTitle}</p><h2>${esc(me.name)}</h2></div></div>
    <h3 style="margin:14px 0 4px">${ICONS.key}${t().phraseTitle}</h3>
    ${phrase ? `${wordsHtml(phrase, true)}
      <div class="row-btns"><button class="btn" data-reveal>${t().show}</button><button class="btn" data-copy-phrase>${t().copy}</button></div>`
      : `<p>${t().noPhraseHere}</p>`}
    <div style="margin-top:14px">${WARN(t().notSeed)}</div>
    <div class="row-btns" style="margin-top:14px;justify-content:space-between">
      <button class="link-btn" data-open="recover">${t().otherDevice}</button>
      <button class="link-btn" data-forget>${t().forget}</button>
    </div>`);
}

// L'adresse de récompense : une adresse Solana PUBLIQUE, vérifiée ici avant tout envoi
// (une clé privée ou une seed collée par erreur ne part jamais).
function openPayout() {
  const me = data?.me;
  if (!me) return;
  openModal(`
    <h2>${t().payoutTitle}</h2>
    <p>${t().payoutText}</p>
    <input class="field" id="payout-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="7xKX…gAsU" value="${esc(me.payout || '')}">
    <div class="check" id="payout-check"></div>
    ${WARN(t().payoutWarn)}
    <p class="photo-tip">${t().payoutTerms}</p>
    <div class="row-btns" style="margin-top:14px">
      ${me.payout ? `<button class="btn" id="payout-remove">${t().payoutRemove}</button>` : ''}
      <button class="btn primary" id="payout-go" ${me.payout ? '' : 'disabled'}>${t().payoutSave}</button>
    </div>`);
  const input = $('payout-input');
  const check = $('payout-check');
  const go = $('payout-go');
  input.addEventListener('input', () => {
    const v = input.value.trim();
    const ok = isSolanaAddress(v);
    go.disabled = !ok;
    check.className = `check${ok ? ' ok' : ''}`;
    check.innerHTML = !v ? '' : ok ? '✓' : `<span class="bad">${t().payoutBad}</span>`;
  });
  const save = async (address) => {
    go.disabled = true;
    const { ok, body } = await api('/api/payout', { method: 'POST', body: { address } }).catch(() => ({ ok: false, body: {} }));
    if (!ok) {
      check.innerHTML = `<span class="bad">${body.error === 'address_taken' ? t().payoutTaken : t().payoutBad}</span>`;
      go.disabled = false;
      return;
    }
    accept(body);
    modal.close();
    toast(t().payoutSaved);
    drawAll();
  };
  go.addEventListener('click', () => { if (isSolanaAddress(input.value.trim())) save(input.value.trim()); });
  $('payout-remove')?.addEventListener('click', () => save(null));
  setTimeout(() => input.focus(), 50);
}

function checkPhrase(text) {
  const words = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const bad = words.filter((w) => !WORDS.includes(w));
  return { count: words.length, bad, valid: normalizePhrase(text) };
}

function openRecover() {
  openModal(`
    <h2>${t().recoverTitle}</h2>
    <p>${t().recoverText}</p>
    <textarea id="phrase-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="lune braise hibou …"></textarea>
    <div class="check" id="phrase-check">${t().recoverCount(0)}</div>
    ${WARN(t().notSeed)}
    <div class="row-btns" style="margin-top:14px"><button class="btn primary" id="recover-go" disabled>${t().recoverBtn}</button></div>`);
  const input = $('phrase-input');
  const check = $('phrase-check');
  const go = $('recover-go');
  input.addEventListener('input', () => {
    const r = checkPhrase(input.value);
    go.disabled = !r.valid;
    check.className = `check${r.valid ? ' ok' : ''}`;
    check.innerHTML = r.valid ? t().recoverOk
      : `${t().recoverCount(r.count)}${r.bad.length ? ` · <span class="bad">${esc(t().recoverBad(r.bad[0]))}</span>` : ''}`;
  });
  go.addEventListener('click', async () => {
    // La phrase n'est envoyée que si tous les mots sont les nôtres : une vraie seed ne part jamais.
    const phrase = checkPhrase(input.value).valid;
    if (!phrase) return;
    go.disabled = true;
    const { ok, body } = await api('/api/recover', { method: 'POST', body: { phrase } }).catch(() => ({ ok: false, body: {} }));
    if (!ok) {
      check.className = 'check';
      check.innerHTML = `<span class="bad">${esc(t().recoverErr[body.error] || t().error)}</span>`;
      go.disabled = false;
      return;
    }
    token = body.token;
    store.set('wick.token', token);
    store.set('wick.phrase', phrase);
    modal.close();
    toast(t().welcomeBack(body.me.name));
    loadState();
  });
  setTimeout(() => input.focus(), 50);
}

// ------------------------------------------------------------ navigation
const ROUTES = { '': 'home', '#/': 'home', '#/leaderboard': 'top', '#/coin': 'coin', '#/how': 'how' };
function route() {
  const m = location.hash.match(/^#\/b\/(\d+)$/);
  const nextViewing = m ? Number(m[1]) : null;
  view = m ? 'home' : ROUTES[location.hash] || 'home';
  if (nextViewing !== viewingId) {
    viewingId = nextViewing;
    viewing = null;
    flamesKey = '';
    bubbleKey = '';
    if (viewingId && data) loadViewing().then(drawAll);
  }
  document.body.dataset.view = view;
  document.querySelectorAll('.view').forEach((el) => { el.hidden = el.dataset.view !== view; });
  document.querySelectorAll('[data-tab]').forEach((el) => el.classList.toggle('active', el.dataset.tab === view && !viewingId));
  scene?.setActive(view === 'home' && !document.hidden);
  if (data) {
    if (view === 'home' && !viewingId) drawAll();
    if (view === 'top') drawTop();
    if (view === 'coin') drawCoin();
  }
  if (view === 'how') drawHow();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => scene?.setActive(view === 'home' && !document.hidden));

// ------------------------------------------------------------ clics
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action],[data-open],[data-close],[data-copy],[data-copy-phrase],[data-reveal],[data-forget],[data-go],[data-speed],[data-photo],#me-btn');
  if (!el) return;
  if (el.dataset.photo) return photoAction(el.dataset.photo, el);
  if (el.dataset.action && !el.disabled) return run(el.dataset.action);
  if (el.dataset.go) { location.hash = `#/b/${el.dataset.go}`; return undefined; }
  if (el.dataset.speed) {
    demo.setSpeed(Number(el.dataset.speed));
    drawDemoBar();
    return loadState();
  }
  if (el.id === 'me-btn' || el.dataset.open === 'me') return openMe();
  if (el.dataset.open === 'recover') return openRecover();
  if (el.dataset.open === 'payout') return openPayout();
  if (el.hasAttribute('data-close')) return modal.close();
  if (el.hasAttribute('data-reveal')) {
    const w = $('words');
    w.classList.toggle('blur');
    el.textContent = w.classList.contains('blur') ? t().show : t().hide;
    return undefined;
  }
  const text = el.dataset.copy ?? (el.hasAttribute('data-copy-phrase') ? myPhrase() : null);
  if (text) {
    try { await navigator.clipboard.writeText(text); el.textContent = t().copied; } catch { /* refusé */ }
    return undefined;
  }
  if (el.hasAttribute('data-forget') && confirm(t().forgetConfirm)) {
    token = null;
    store.del('wick.token');
    store.del('wick.phrase');
    modal.close();
    loadState();
  }
  return undefined;
});

// Raccourcis clavier : 1, 2, 3 pour les boutons sous la bougie.
document.addEventListener('keydown', (e) => {
  if (!data || view !== 'home' || modal.open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  const action = actionList()[Number(e.key) - 1];
  const btn = action && document.querySelector(`[data-action="${action}"]`);
  if (btn && !btn.disabled) run(action);
});

// ------------------------------------------------------------ démarrage
document.querySelectorAll('#tabbar [data-ico]').forEach((a) => a.insertAdjacentHTML('afterbegin', ICONS[a.dataset.ico]));
applyStaticTexts();
route();
loadState().then(loadThought);
// En démo, tout va plus vite : on rafraîchit chaque seconde.
setInterval(() => { if (!document.hidden) loadState(); }, demo ? 1000 : 15_000);
setInterval(() => { if (!document.hidden) loadThought(); }, demo ? 20_000 : 90_000);
setInterval(() => { if (data && view === 'home') { drawActions(); drawReward(); showLine(); } }, 1000);

// Pour le développement local : accès à la scène depuis la console.
window.WICK = { get scene() { return scene; }, get data() { return data; } };
