// La page du crew (#crew) : les quatre agents de chaque coin, au travail, en direct.
// Scout trouve le narratif, Chandler fait le coin, Igniter le lance (le créateur signe),
// l'Operator le fait vivre. Les données viennent de GET /api/crew (lib/crew.js).
import { ago, aiLogo, compact, esc, fmt, icon, solscan } from './util.js';

const usd = (n) => (n == null || !(n > 0) ? '—' : `$${compact(n)}`);
const change = (c) => (c == null ? '' : `<small class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '+' : ''}${Math.round(c)}%</small>`);

// Les quatre agents. Le Scout et le Chandler travaillent avant le lancement, l'Igniter au
// lancement, l'Operator après (pendant 30 jours, et tant que le coin brûle).
export const CREW = [
  { id: 'scout', name: 'Scout', icon: 'scout', role: 'Finds the narrative', text: 'Reads what is trending on Solana every 30 minutes and turns it into narratives, each one with its sources.' },
  { id: 'chandler', name: 'Chandler', icon: 'sparkle', role: 'Makes the coin', text: 'Writes the name, the ticker and the story, paints the logo, then the launch kit: lore, X posts, Telegram post.' },
  { id: 'igniter', name: 'Igniter', icon: 'rocket', role: 'Launches it, you sign', text: 'Prepares the pump.fun launch and the fee split. Nothing leaves without your wallet: you approve every launch.' },
  { id: 'operator', name: 'Operator', icon: 'keeper', role: 'Works it after launch', text: 'Tracks the market, writes its journal, runs its X account and its Telegram groups, and burns the coin under rules locked at launch.' },
];

export function createCrew({ api, openModal, isOpen, world, ticker, avatar, onStrike }) {
  const tk = () => `$${ticker()}`;
  let cache = null;

  // Les narratifs du Scout, pour le lancement (gardés 5 minutes).
  async function picks() {
    if (cache && Date.now() - cache.at < 300_000) return cache.data.scout;
    try {
      cache = { at: Date.now(), data: await api.crew() };
      return cache.data.scout;
    } catch {
      return null;
    }
  }

  const sourceChip = (s) => (s ? `<a class="cw-src" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.name)} on DEX Screener">
    <b>$${esc(s.symbol)}</b><span>${usd(s.mcap)}</span>${change(s.change)}</a>` : '');

  function narrativeCard(n, sources) {
    const bySym = new Map((sources || []).map((s) => [s.symbol, s]));
    return `<article class="cw-narr">
      <b>${esc(n.title)}</b>
      <p>${esc(n.angle)}</p>
      <div class="cw-idea">${icon('sparkle')}<span>${esc(n.idea)}</span></div>
      <div class="cw-srcs"><small>Sources</small>${n.sources.map((s) => sourceChip(bySym.get(s)) || `<span class="cw-src"><b>$${esc(s)}</b></span>`).join('')}</div>
      <button type="button" class="wbtn cw-use" data-idea="${esc(n.idea)}">Launch on this narrative</button>
    </article>`;
  }

  const coinLine = (c) => `<a class="cw-coin" href="#coin/${esc(c.mint)}">${avatar(c, 30)}<span><b>$${esc(c.symbol)}</b>
    <small>${aiLogo(c.mind, 12)} ${esc(c.mind?.name || '')}${c.character ? ` · ${esc(c.character)}` : ''}</small></span></a>`;

  function splitHtml() {
    const s = world.launch?.split || { creatorBps: 6000, burnBps: 1000, teamBps: 1000, crewBps: 2000 };
    const p = (b) => (b || 0) / 100;
    return `<div class="split-bar cw-split">
        <span style="width:${p(s.creatorBps)}%">Creator ${p(s.creatorBps)}%</span>
        ${s.crewBps ? `<span class="crew" style="width:${p(s.crewBps)}%">Crew ${p(s.crewBps)}%</span>` : ''}
        <span class="wick" style="width:${p(s.burnBps)}%">${p(s.burnBps)}%</span>
        <span class="team" style="width:${p(s.teamBps)}%">${p(s.teamBps)}%</span>
      </div>
      <ul class="cw-fees">
        <li><b>${p(s.creatorBps)}%</b> the creator. <span>Make it burn takes its share from here: 10 to 50% buys the coin back and burns it, forever.</span></li>
        ${s.crewBps ? `<li><b>${p(s.crewBps)}%</b> its crew. <span>Pays for its AI and its posts. Received by the WICK team wallet, which runs the crew.</span></li>` : ''}
        <li><b>${p(s.burnBps)}%</b> burns ${tk()}. <span>Every coin feeds the great candle.</span></li>
        <li><b>${p(s.teamBps)}%</b> the WICK team.</li>
      </ul>
      <p class="muted small">Set with pump.fun's own fee sharing at launch and locked on-chain: nobody can change it, not even WICK.
        The Ignition Fee (${world.launch?.sharedFeeSol ?? 0.01} SOL) is split 50% ${tk()} burn, 50% team.</p>`;
  }

  function render(d) {
    const k = world.launch?.keepers || { models: [], styles: [], goals: [] };
    const sc = d.scout;
    const latest = d.fresh?.[0];
    const action = d.live?.[0];
    const now = {
      scout: sc ? `<b>${esc(sc.narratives[0].title)}</b> <small>· ${ago(sc.at)}</small>` : '<small>Warming up: first read within 30 minutes.</small>',
      chandler: latest ? `${avatar(latest, 20)} <b>$${esc(latest.symbol)}</b> <small>· ${ago(latest.at)}</small>` : '<small>Waiting for the first idea.</small>',
      igniter: latest ? `<b>Launched $${esc(latest.symbol)}</b> ${latest.sig ? `<a href="${solscan(esc(latest.sig))}" target="_blank" rel="noopener">tx ↗</a>` : ''}` : '<small>Ready when you are.</small>',
      operator: action ? `<b>$${esc(action.coin.symbol)}</b> <small>${esc(action.title)} · ${ago(action.at)}</small>` : '<small>On duty.</small>',
    };
    return `
      <div class="cw-hero">
        <span class="eyebrow">The crew</span>
        <h2>Every coin gets a <span class="grad">crew</span>.</h2>
        <p class="lead muted">Four AI agents take your coin from an idea to a living candle. The Scout finds the narrative, the
          Chandler makes the coin, the Igniter launches it, the Operator works it. <b>You approve every launch. The crew does the rest.</b></p>
        <div class="cw-stats">
          <div><strong>${fmt(d.stats.coins)}</strong><span>coins with a crew</span></div>
          <div><strong>${fmt(d.stats.actions)}</strong><span>actions, all public</span></div>
          <div><strong>${fmt(d.stats.burns)}</strong><span>burns decided</span></div>
          <div><strong>${fmt(d.stats.posts)}</strong><span>posts</span></div>
        </div>
        <button type="button" class="cta" data-crew-launch>${icon('flame')} Launch with your crew</button>
      </div>

      <ol class="cw-agents">${CREW.map((a, i) => `<li class="cw-agent">
        <span class="cw-step">${i + 1}</span>
        <span class="cw-ico">${icon(a.icon)}</span>
        <b>${a.name}</b><em>${a.role}</em>
        <p>${a.text}</p>
        <div class="cw-now"><i></i>${now[a.id]}</div>
      </li>`).join('')}</ol>

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('scout')} Scout's picks, right now</h3>
          <small class="muted">${sc ? `${sc.ai ? 'Read by the Scout' : 'What is running'} from ${fmt(sc.seen || 0)} trending Solana tokens · ${ago(sc.at)}` : ''}</small></div>
        ${sc ? `<div class="cw-narrs">${sc.narratives.map((n) => narrativeCard(n, sc.sources)).join('')}</div>
          <p class="muted small">Every narrative cites the tokens it comes from, with their DEX Screener page. Ideas only: the Chandler never copies a coin.</p>`
          : '<p class="muted">The Scout reads the market every 30 minutes. Its first picks land here soon.</p>'}
      </section>

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('keeper')} Operators, right now</h3><small class="muted">Every action, as it happens</small></div>
        ${d.live?.length ? `<ul class="cw-live">${d.live.slice(0, 10).map((e) => `<li>
          ${coinLine(e.coin)}
          <span class="cw-act"><b>${esc(e.title)}</b>${e.detail ? `<small>${esc(e.detail)}</small>` : ''}</span>
          <span class="cw-when">${e.sig ? `<a href="${solscan(esc(e.sig))}" target="_blank" rel="noopener">tx ↗</a>` : ''}<time data-at="${e.at}">${ago(e.at)}</time></span>
        </li>`).join('')}</ul>` : '<p class="muted">No action yet. The first launch wakes them up.</p>'}
      </section>

      <div class="cw-two">
        <section class="cw-sec">
          <div class="cw-sec-head"><h3>${icon('sparkle')} Fresh from the Chandler</h3></div>
          ${d.fresh?.length ? `<div class="cw-fresh">${d.fresh.map((c) => `<a class="cw-card" href="#coin/${esc(c.mint)}">
            ${avatar(c, 44)}<b>$${esc(c.symbol)}</b><small>${esc(c.name)}</small>
            <span class="cw-mind">${aiLogo(c.mind, 12)} ${esc(c.character || '')}${c.goal ? ` · ${esc(c.goal)}` : ''}</span>
            ${c.burns ? `<i class="tag burn">burns ${c.burns}%</i>` : ''}
          </a>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}
        </section>
        <section class="cw-sec">
          <div class="cw-sec-head"><h3>${icon('trophy')} Top Operators</h3><small class="muted">by market cap, 30 days</small></div>
          ${d.top?.length ? `<ol class="cw-top">${d.top.map((c, i) => `<li><span class="cw-rank">${i + 1}</span>${coinLine(c)}
            <span class="cw-mc"><b>${usd(c.mcap)}</b>${change(c.change)}</span></li>`).join('')}</ol>` : '<p class="muted">No market yet.</p>'}
        </section>
      </div>

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('chart')} Where the fees go</h3><small class="muted">every coin, every creator fee</small></div>
        ${splitHtml()}
      </section>

      <section class="cw-sec cw-build">
        <div class="cw-sec-head"><h3>${icon('zap')} Build your crew</h3><small class="muted">locked at launch, in its Constitution</small></div>
        <small class="k-label">Its mind</small>
        <div class="hk-minds">${k.models.map((m) => `<div class="hk-mind">${aiLogo(m, 26)}<b>${esc(m.name)}</b><small>${esc(m.by)}${m.premium ? (m.available ? ' · premium' : ' · soon') : ''}</small></div>`).join('')}</div>
        <small class="k-label">Its character</small>
        <div class="hk-styles">${k.styles.map((x) => `<span class="ck-style"><b>${esc(x.label)}</b> ${esc(x.hint)}</span>`).join('')}</div>
        <small class="k-label">Its objective</small>
        <div class="hk-styles">${(k.goals || []).map((x) => `<span class="ck-style"><b>${esc(x.label)}</b> ${esc(x.hint)}</span>`).join('')}</div>
        <ul class="op-rules cw-rules">
          <li>${icon('check')}It can buy back its own coin and burn it. It can't sell, and it can't move funds.</li>
          <li>${icon('check')}Every action lands in its public Activity, every burn with its transaction.</li>
          <li>${icon('check')}Talking to it changes nothing: chat, decisions, rules and the signer are separate.</li>
        </ul>
        <button type="button" class="cta" data-crew-launch>${icon('flame')} Launch with your crew</button>
      </section>`;
  }

  function bind(onIdea) {
    document.querySelectorAll('#modal-body [data-crew-launch]').forEach((b) => b.addEventListener('click', () => onStrike()));
    document.querySelectorAll('#modal-body .cw-use').forEach((b) => b.addEventListener('click', () => onIdea(b.dataset.idea)));
  }

  async function open(onIdea) {
    openModal('<div class="cw-hero"><span class="eyebrow">The crew</span><h2>Every coin gets a <span class="grad">crew</span>.</h2><p class="muted">Loading…</p></div>', 'm-wide m-crew');
    try {
      const data = await api.crew();
      cache = { at: Date.now(), data };
      if (!isOpen('m-crew')) return;
      openModal(render(data), 'm-wide m-crew');
      bind(onIdea);
    } catch {
      if (isOpen('m-crew')) openModal('<h2>The crew</h2><p class="muted">Could not load the crew. Try again in a moment.</p>', 'm-wide m-crew');
    }
  }

  return { open, picks, narrativeCard };
}
