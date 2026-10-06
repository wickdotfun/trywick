// Les modèles (#models) : tous ceux d'OpenRouter qu'un agent peut prendre, avec leur prix. Le même
// catalogue sert au lancement (l'étape « Its agent », onglet « Any model »).
import { aiLogo, esc, icon } from './util.js';

let cache = null;
export async function loadModels() {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const res = await fetch('/api/models');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cache = { at: Date.now(), data };
  return data;
}

// Les prix : par million de tokens, et un « run » (une réponse typique de l'agent).
export const perM = (p) => `$${(p * 1e6) < 1 ? (p * 1e6).toFixed(2) : +(p * 1e6).toFixed(2)}`;
export const runPrice = (usd) => (usd < 0.001 ? '< $0.001' : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`);
export const ctxLabel = (n) => (!n ? '—' : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}K`);
export const asMind = (m) => ({ name: m.name, by: m.lab, logo: m.logo });
// Combien de runs paie un fuel (en SOL), au prix du SOL.
export const runsFor = (fuelSol, m, solUsd) => (solUsd && m.run > 0 ? Math.floor((fuelSol * solUsd) / m.run) : null);

// Les bons points de départ : le plus récent de quelques labos connus.
const START = ['google', 'anthropic', 'openai', 'deepseek', 'x-ai', 'qwen', 'moonshotai', 'z-ai', 'mistralai'];
export function picks(models, n = 6) {
  const out = [];
  for (const lab of START) {
    const m = models.find((x) => x.id.startsWith(`${lab}/`) && !/preview|beta|exp|vision|image|audio|embed/i.test(x.id));
    if (m) out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

export function filterModels(models, { q = '', lab = '', sort = 'newest' } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = models.filter((m) => (!lab || m.id.startsWith(`${lab}/`)) && words.every((w) => `${m.id} ${m.name} ${m.lab}`.toLowerCase().includes(w)));
  if (sort === 'cheapest') list.sort((a, b) => a.run - b.run);
  else if (sort === 'context') list.sort((a, b) => (b.ctx || 0) - (a.ctx || 0));
  return list;
}

export function labCounts(models) {
  const n = new Map();
  for (const m of models) {
    const lab = m.id.split('/')[0];
    const cur = n.get(lab) || { lab, name: m.lab, logo: m.logo, n: 0 };
    cur.n++;
    n.set(lab, cur);
  }
  return [...n.values()].sort((a, b) => b.n - a.n);
}

export function createModels({ openModal, isOpen, onLaunch }) {
  let state = { q: '', lab: '', sort: 'newest' };

  const card = (m) => `<article class="md-card">
    <div class="md-top">${aiLogo(asMind(m), 28)}<span><small>${esc(m.lab)}</small><b>${esc(m.name)}</b></span></div>
    <dl><div><dt>Per 1M tokens</dt><dd><b>${perM(m.pin)}</b> in · <b>${perM(m.pout)}</b> out</dd></div>
      <div><dt>A run, about</dt><dd><b>${runPrice(m.run)}</b></dd></div>
      <div><dt>Context</dt><dd>${ctxLabel(m.ctx)}</dd></div></dl>
    <button type="button" class="wbtn" data-launch-model="${esc(m.id)}">${icon('rocket')} Launch with it</button></article>`;

  const row = (m) => `<tr><td><span class="md-name">${aiLogo(asMind(m), 18)}<span><b>${esc(m.name)}</b><small>${esc(m.lab)}</small></span></span></td>
    <td class="num mono">${perM(m.pin)}</td><td class="num mono">${perM(m.pout)}</td><td class="num mono">${runPrice(m.run)}</td><td class="num mono">${ctxLabel(m.ctx)}</td>
    <td><button type="button" class="wbtn small" data-launch-model="${esc(m.id)}">Launch</button></td></tr>`;

  function renderList(d) {
    const list = filterModels(d.models, state);
    const el = document.getElementById('md-rows');
    if (el) el.innerHTML = list.length ? list.slice(0, 400).map(row).join('') : '<tr><td colspan="6" class="muted">No model matches.</td></tr>';
    const n = document.getElementById('md-count');
    if (n) n.textContent = `${list.length} model${list.length === 1 ? '' : 's'}`;
  }

  function render(d) {
    const labs = labCounts(d.models);
    return `<div class="cw-hero md-hero"><span class="eyebrow">Models</span>
      <h2>Any mind. <span class="grad">${d.models.length} models.</span></h2>
      <p class="lead muted">Your coin's agent can think with any of these, from every big AI lab. The price is the model's own,
        paid by your coin: the fuel you add at launch, then 20% of its creator fees. When its budget is empty, it keeps going on a free mind.</p></div>
      ${d.ready ? '' : '<p class="note">The model picker opens with the launch of $WICK. Until then, agents use the free minds.</p>'}
      <section class="cw-sec"><div class="cw-sec-head"><h3>${icon('star')} Good places to start</h3><small class="muted">recent, from the big labs</small></div>
        <div class="md-grid">${picks(d.models).map(card).join('')}</div></section>
      <section class="cw-sec"><div class="cw-sec-head"><h3>${icon('chart')} Every model</h3><small class="muted" id="md-count"></small></div>
        <div class="md-tools">
          <input id="md-q" type="search" placeholder="Search a model or a lab" value="${esc(state.q)}" autocomplete="off">
          <div class="md-sorts">${[['newest', 'Newest'], ['cheapest', 'Cheapest'], ['context', 'Largest context']].map(([k, l]) => `<button type="button" class="pill${state.sort === k ? ' on' : ''}" data-md-sort="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="md-labs"><button type="button" class="pill${state.lab ? '' : ' on'}" data-md-lab="">All labs <i>${d.models.length}</i></button>${labs.slice(0, 24).map((l) => `<button type="button" class="pill${state.lab === l.lab ? ' on' : ''}" data-md-lab="${esc(l.lab)}">${l.logo ? aiLogo({ logo: l.logo, by: l.name }, 14) : ''}${esc(l.name)} <i>${l.n}</i></button>`).join('')}</div>
        <div class="pf-table md-table"><table><thead><tr><th>Model</th><th class="num">In / 1M</th><th class="num">Out / 1M</th><th class="num">A run</th><th class="num">Context</th><th></th></tr></thead>
          <tbody id="md-rows"></tbody></table></div>
        <p class="muted small">Prices from OpenRouter, per million tokens. A run is one typical answer of an agent (about ${d.runTokens.in.toLocaleString('en-US')} tokens in, ${d.runTokens.out} out). Each answer is paid at its exact price, shown on the Proof page.</p>
      </section>`;
  }

  // Un seul écouteur pour la fenêtre (elle sert à toutes les pages) : il agit sur le catalogue affiché.
  let current = null, bound = false;
  function bind(d) {
    current = d;
    const root = document.getElementById('modal-body');
    root.querySelector('#md-q')?.addEventListener('input', (e) => { state.q = e.target.value; renderList(current); });
    if (!bound) {
      bound = true;
      root.addEventListener('click', (e) => {
        if (!current || !isOpen('m-models')) return;
        const s = e.target.closest('[data-md-sort]');
        const l = e.target.closest('[data-md-lab]');
        const go = e.target.closest('[data-launch-model]');
        if (s) { state.sort = s.dataset.mdSort; root.querySelectorAll('[data-md-sort]').forEach((b) => b.classList.toggle('on', b === s)); renderList(current); }
        if (l) { state.lab = l.dataset.mdLab; root.querySelectorAll('[data-md-lab]').forEach((b) => b.classList.toggle('on', b === l)); renderList(current); }
        if (go) onLaunch(go.dataset.launchModel);
      });
    }
    renderList(d);
  }

  async function open() {
    openModal('<div class="cw-hero md-hero"><span class="eyebrow">Models</span><h2>Any mind.</h2><p class="muted">Loading…</p></div>', 'm-wide m-crew m-models');
    try {
      const d = await loadModels();
      if (!isOpen('m-models')) return;
      if (!d.models.length) { openModal('<h2>Models</h2><p class="muted">The list of models is on its way. Try again in a minute.</p>', 'm-wide m-crew m-models'); return; }
      openModal(render(d), 'm-wide m-crew m-models');
      bind(d);
    } catch {
      if (isOpen('m-models')) openModal('<h2>Models</h2><p class="muted">Could not load the models. Try again in a moment.</p>', 'm-wide m-crew m-models');
    }
  }
  return { open };
}
