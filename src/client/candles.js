// « Make it burn » côté site : la forêt des bougies (les coins qui se brûlent eux-mêmes) et la
// page de chaque coin, avec sa bougie, sa part brûlée et chacun de ses burns.
import { proofMessage } from '../../lib/xproof.js';
import * as connect from './connect.js';
import { bindChats, chatHtml } from './keeper.js';
import { ago, aiLogo, compact, esc, fmt, icon, pumpUrl, sol, solscan } from './util.js';

const $ = (id) => document.getElementById(id);
const xLogo = '<svg class="ico x-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>';
const usd = (n) => (n == null ? '—' : `$${compact(n)}`);
const pctText = (p) => (p == null ? '—' : `${p < 0.01 && p > 0 ? '<0.01' : p.toLocaleString('en-US', { maximumFractionDigits: p >= 10 ? 1 : 2 })}%`);

// Une bougie en CSS : sa hauteur suit la part de supply qui reste, la flamme danse.
export function candleHtml({ pct = 0, w = 34, full = 150, gold = false, out = false, big = false, label = '', sub = '', ghost = false, tag = 'div', attrs = '' }) {
  const h = Math.max(10, Math.round(full * (1 - Math.min(100, pct) / 100)));
  const fw = Math.round(w * (big ? 0.42 : 0.6));
  const fh = Math.round(fw * 1.9);
  const burnt = full - h;
  return `<${tag} class="cdl${gold ? ' gold' : ''}${big ? ' big' : ''}" style="--w:${w}px;--h:${h}px;--fw:${fw}px;--fh:${fh}px;--burnt:${burnt}px;--d:${(1.3 + ((w * 7) % 9) / 10).toFixed(1)}s" ${attrs}>
    <i class="cdl-halo"></i><i class="cdl-flame${out ? ' out' : ''}"><i></i></i><i class="cdl-wick"></i>
    <i class="cdl-wax">${ghost && burnt > 6 ? '<i class="cdl-ghost"></i>' : ''}</i>
    ${label ? `<span class="cdl-label"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>` : ''}
  </${tag}>`;
}

// La taille d'une bougie selon la market cap du coin (0,72 à 1,3).
const sizeOf = (m) => (m.mcap ? Math.max(0.72, Math.min(1.3, 0.55 + Math.log10(Math.max(1, m.mcap)) / 8)) : 0.8);

export function createCandles({ api, openModal, world, ticker, avatar, holderTag, demo, onStrike, go }) {
  const tk = () => `$${ticker()}`;

  // ---------------------------------------------------------- la forêt
  async function forest() {
    openModal(`<div id="cd-body" class="cd"><p class="muted">Lighting the candles…</p></div>`, 'm-wide m-candles');
    let data;
    try {
      data = await api.candles();
    } catch {
      if ($('cd-body')) $('cd-body').innerHTML = '<p class="muted">Could not load the candles. Try again in a moment.</p>';
      return;
    }
    const body = $('cd-body');
    if (!body) return;
    const coins = data.forest || [];
    const t = data.totals || {};
    // $WICK au centre, les coins de part et d'autre (les plus brûlés au plus près).
    const ranked = coins.slice(0, 12);
    const left = [], right = [];
    ranked.forEach((m, i) => (i % 2 ? left : right).push(m));
    const coinCandle = (m) => candleHtml({
      pct: m.candle?.pct ?? 0, w: Math.round(30 * sizeOf(m)), full: Math.round(140 * sizeOf(m)),
      gold: m.holder, label: `$${esc(m.symbol)}`, sub: pctText(m.candle?.pct ?? 0), tag: 'button',
      attrs: `data-coin="${esc(m.mint)}" aria-label="$${esc(m.symbol)}'s candle"`,
    });
    const wick = candleHtml({
      pct: world.totals?.supplyPct ?? 0, w: 78, full: 220, gold: true, big: true,
      label: tk(), sub: `${pctText(world.totals?.supplyPct ?? 0)} burned`, tag: 'button', attrs: 'data-wick aria-label="The $WICK candle"',
    });
    body.innerHTML = `
      <div class="cd-head">
        <div>
          <span class="eyebrow">Make it burn</span>
          <h2>Every coin is a <span class="grad">candle</span>.</h2>
          <p class="muted">Coins launched on WICK can burn themselves: a share of their creator fees buys them back and
            burns them, forever, locked on pump.fun. Each candle has an AI agent that picks the moments and tells you why.
            Every candle also burns ${tk()}.</p>
        </div>
        <button class="cta" id="cd-light">Light your candle</button>
      </div>
      <div class="cd-stage">
        <i class="cd-floor"></i>
        ${Array.from({ length: 12 }, (_, i) => `<i class="ember" style="left:${8 + ((i * 53) % 84)}%;animation-duration:${5 + (i % 5)}s;animation-delay:${((i * 0.7) % 6).toFixed(1)}s"></i>`).join('')}
        <div class="cd-row">${left.reverse().map(coinCandle).join('')}${wick}${right.map(coinCandle).join('')}</div>
        <span class="cd-live"><i></i>${fmt(t.candles || 0)} ${t.candles === 1 ? 'candle' : 'candles'} burning</span>
        <span class="cd-hint">Height = supply left · gold = launched by a ${tk()} holder</span>
      </div>
      <div class="tiles cd-tiles">
        <div><strong class="gold">${fmt(t.candles || 0)}</strong><span>coins burning themselves</span></div>
        <div><strong>${fmt(t.candleBurns || 0)}</strong><span>buybacks and burns</span></div>
        <div><strong>${sol(t.candleSol || 0)}</strong><span>fed to their own candles</span></div>
      </div>
      ${keepersShowcase()}
      <div class="cd-cols">
        <section class="cd-card">
          <h3>Brightest candles <small>most burned</small></h3>
          ${coins.length ? `<ol class="cd-list">${coins.slice(0, 20).map((m, i) => `<li><button class="cd-item" data-coin="${esc(m.mint)}">
            <span class="mono dim">${String(i + 1).padStart(2, '0')}</span>
            ${candleHtml({ pct: m.candle?.pct ?? 0, w: 11, full: 30, gold: m.holder })}
            ${avatar(m, 30)}
            <span class="cd-name"><b>$${esc(m.symbol)} ${holderTag(m)}</b><small>burns ${m.candle.bps / 100}% of its fees${m.candle.keeper ? ` · ${esc(m.candle.keeper.label)} agent` : ''}</small></span>
            <span class="cd-num gold">${pctText(m.candle.pct)}<small>burned</small></span>
            <span class="cd-num hide-sm">${usd(m.mcap)}<small>mcap</small></span>
          </button></li>`).join('')}</ol>`
            : `<p class="muted">No candle lit yet. Launch a coin with <b>Make it burn</b> and yours is the first.</p>`}
        </section>
        <section class="cd-card">
          <h3>Latest burns <small>on-chain</small></h3>
          ${(data.burns || []).length ? `<ul class="cd-burns">${data.burns.slice(0, 12).map((b) => `<li>
            <a href="${b.sig ? solscan(esc(b.sig)) : '#'}" target="_blank" rel="noopener">
              <span class="ev-ico">${icon('flame')}</span>
              <span class="cd-name"><b>${compact(b.burned)} $${esc(b.symbol)} burned</b><small>${sol(b.sol)} of its own fees</small></span>
              <time data-at="${b.at}">${ago(b.at)}</time>
            </a></li>`).join('')}</ul>`
            : '<p class="muted">The first burns show up here, each with its transaction.</p>'}
        </section>
      </div>`;
    $('cd-light').addEventListener('click', onStrike);
    // Sur un écran étroit, la forêt défile : on part de la bougie de $WICK, au centre.
    const row = body.querySelector('.cd-row'), center = body.querySelector('[data-wick]');
    if (row && center && row.scrollWidth > row.clientWidth) row.scrollLeft = center.offsetLeft - (row.clientWidth - center.offsetWidth) / 2;
    body.querySelector('[data-wick]')?.addEventListener('click', () => go('wick'));
  }

  // Les Operators : les six esprits (avec leur logo) et les quatre personnalités.
  function keepersShowcase() {
    const k = world.launch?.keepers;
    if (!k) return '';
    return `<section class="cd-keepers">
      <div class="ck-head">
        <span class="kc-avatar">${icon('keeper')}</span>
        <div><h3>Every candle has an AI <span class="grad">agent</span></h3>
          <p class="muted">The creator picks its personality and its mind. The agent picks the moments to buy the coin back
          and burn it, and tells the holders why. It never touches the amounts.</p></div>
      </div>
      <div class="ck-minds">${k.models.map((m) => `<div class="ck-mind">${aiLogo(m, 22)}<span><b>${esc(m.name)}</b><small>${esc(m.by)}${m.premium ? (m.available ? ' · premium' : ' · soon') : ''}</small></span></div>`).join('')}</div>
      <div class="ck-styles">${k.styles.map((x) => `<span class="ck-style"><b>${esc(x.label)}</b> ${esc(x.hint)}</span>`).join('')}</div>
    </section>`;
  }

  // Le panneau de l'Operator d'un coin : qui il est, ce qu'il a fait (Activity), ce qui le lie
  // (Constitution), et la conversation avec lui (Talk).
  const ACT = { posted: 'send', kit: 'sparkle', launched: 'rocket', sealed: 'lock', intro: 'chat', journal: 'book', wait: 'wind', decide: 'keeper', burned: 'flame', fed: 'candle', posted: 'send', milestone: 'trophy' };
  function activity(log = []) {
    if (!log.length) return '<p class="muted small">Its first actions show up here: the launch, its first words, every decision and every burn.</p>';
    return `<ol class="op-log">${log.map((e) => `<li class="op-ev ${esc(e.kind)}">
        <span class="op-ico">${icon(ACT[e.kind] || 'keeper')}</span>
        <span class="op-txt"><b>${esc(e.title)}</b>${e.detail ? `<small>${esc(e.detail)}</small>` : ''}</span>
        <span class="op-meta"><time data-at="${e.at}">${ago(e.at)}</time>${e.sig ? `<a href="${solscan(esc(e.sig))}" target="_blank" rel="noopener">TX ↗</a>` : ''}</span>
      </li>`).join('')}</ol>`;
  }
  // Les missions : ce qu'il a fait (coché), ce qu'il vise (avec sa progression), ce qu'il fait tout le temps.
  function missionsHtml(list = []) {
    if (!list.length) return '<p class="muted small">This coin was launched before agents had missions.</p>';
    const ico = { done: 'check', active: 'clock', ongoing: 'chart' };
    const label = { active: 'in progress', ongoing: 'always on' };
    return `<ol class="op-missions">${list.map((x) => `<li class="om ${esc(x.status)}">
        <span class="om-ico">${icon(ico[x.status] || 'clock')}</span>
        <span class="om-txt"><b>${esc(x.title)}</b>${x.hint ? `<small>${esc(x.hint)}</small>` : ''}
          ${x.status === 'active' && x.progress != null ? `<span class="om-bar"><i style="width:${Math.max(3, Math.round(x.progress * 100))}%"></i></span>` : ''}</span>
        <span class="om-meta">${x.status === 'done' ? (x.at ? `<time data-at="${x.at}">${ago(x.at)}</time>` : 'done') : label[x.status]}</span>
      </li>`).join('')}</ol>`;
  }
  // Le kit de lancement : ce que son Operator a écrit pour qu'on le poste.
  const lines = (t) => esc(t).replace(/\n/g, '<br>');
  // Relier un groupe Telegram : l'Operator y postera (lib/publish.js).
  function telegramHtml(t, m) {
    const bot = t?.bot ? `@${esc(t.bot)}` : 'the WICK bot';
    const cmd = `/link ${m.mint}`;
    return `<section class="kit-tg"><h4>Its Telegram groups${t?.groups ? ` <small>· posting in ${t.groups}</small>` : ''}</h4>
      <div class="kit-post"><p>Let its agent post in your group: its launch kit, its milestones, its burns and a daily recap.
        <b>1.</b> Add ${t?.bot ? `<a href="https://t.me/${esc(t.bot)}" target="_blank" rel="noopener">${bot}</a>` : bot} to the group.
        <b>2.</b> An admin sends:</p>
        <code class="kit-cmd">${esc(cmd)}</code>
        <div class="kit-act"><button type="button" class="wbtn" data-kcopy="${esc(cmd)}">Copy</button></div></div></section>`;
  }
  // Son compte X : son créateur le confie à son Operator, qui y poste tout seul.
  function xHtml(x, m) {
    if (!x?.enabled) return '';
    // La démo : les coins lancés dans la démo sont « les tiens ».
    const mine = demo ? String(m.creator).startsWith('YouDemo') : connect.current()?.address === m.creator;
    if (x.handle) {
      return `<section class="kit-x on"><h4>${xLogo} Its X account <small>· run by its agent</small></h4>
        <div class="kit-post"><p><a href="https://x.com/${esc(x.handle)}" target="_blank" rel="noopener"><b>@${esc(x.handle)}</b></a> · ${fmt(x.posts)} post${x.posts === 1 ? '' : 's'} so far.
          It posts its launch kit, then its milestones, its burns and its journal: ${x.perDay} posts a day at most, never a link.</p>
          ${mine ? '<div class="kit-act"><button type="button" class="wbtn" id="x-unlink">Take it back</button></div>' : ''}</div></section>`;
    }
    return `<section class="kit-x"><h4>${xLogo} Its X account</h4>
      <div class="kit-post"><p>${mine ? 'Hand its X account to its agent' : 'Its creator can hand its X account to its agent'}: it posts there on its own,
        in character. Its launch kit first, then its milestones, its burns and its journal. ${x.perDay} posts a day at most, never a link.
        Paid by its crew.</p>
        ${mine ? `<div class="kit-act"><button type="button" class="cta small-cta" id="x-connect">${xLogo} Connect its X account</button></div>
        <small class="muted">Your wallet signs a message (not a transaction) to prove the coin is yours, then X asks you to authorize WICK.
          You can take it back any time, here or in your X settings.</small><p class="error" id="x-error" hidden></p>` : ''}</div></section>`;
  }
  function kitHtml(kit, m, op) {
    if (!kit) return `${xHtml(op?.x, m)}<p class="muted small">Its agent writes the launch kit right after the launch: the lore, three posts for X and a Telegram announcement.</p>${telegramHtml(op?.telegram, m)}`;
    const page = `${location.origin}/#coin/${m.mint}`;
    const xIntent = (t) => `https://x.com/intent/post?text=${encodeURIComponent(t)}&url=${encodeURIComponent(page)}`;
    return `<div class="op-kit">
      ${xHtml(op?.x, m)}
      <p class="kit-note">${icon('sparkle')} Written by its agent${kit.ai ? '' : ', from its templates'}. Anyone can post it: the creator, the holders, you.</p>
      <section><h4>Lore</h4><div class="kit-post"><p>${lines(kit.lore)}</p>
        <div class="kit-act"><button type="button" class="wbtn" data-kcopy="${esc(kit.lore)}">Copy</button></div></div></section>
      <section><h4>Posts for X</h4>${kit.x.map((p) => `<div class="kit-post"><p>${lines(p)}</p>
        <div class="kit-act"><button type="button" class="wbtn" data-kcopy="${esc(p)}">Copy</button><a class="wbtn x" href="${xIntent(p)}" target="_blank" rel="noopener">Post on X</a></div></div>`).join('')}</section>
      <section><h4>Telegram</h4><div class="kit-post"><p>${lines(kit.telegram)}</p>
        <div class="kit-act"><button type="button" class="wbtn" data-kcopy="${esc(kit.telegram)}">Copy</button></div></div></section>
      <section><h4>Its card</h4><div class="kit-card" id="kit-card-out"><button type="button" class="cta small-cta" id="kit-card">${icon('sparkle')} Make its card</button>
        <small class="muted">1600 × 900, ready for X and Telegram. Drawn right here, in your browser.</small></div></section>
      ${telegramHtml(op?.telegram, m)}
    </div>`;
  }
  const X_ERRORS = {
    not_creator: 'Only the wallet that launched this coin can connect its X account.',
    bad_signature: 'The signature did not match. Try again.',
    no_sign_message: 'This wallet cannot sign messages. Try Phantom, Solflare or Backpack.',
    rejected: 'Signature cancelled.',
    too_many: 'Too many tries. Wait a moment.',
    x_off: 'X accounts are not open yet.',
  };
  async function xProof(m, action) {
    const wallet = connect.current()?.address;
    const message = proofMessage({ action, symbol: m.symbol, mint: m.mint, wallet, at: Date.now() });
    return { mint: m.mint, wallet, message, signature: await connect.signText(message) };
  }
  function bindX(root, m) {
    $('x-connect')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const { url } = await api.xStart(demo ? { mint: m.mint } : await xProof(m, 'link'));
        if (url) location.href = url; else go(`coin/${m.mint}`);
      } catch (err) {
        const box = $('x-error');
        box.hidden = false;
        box.textContent = X_ERRORS[err.code] || 'Could not connect its X account. Try again.';
        b.disabled = false;
      }
    });
    $('x-unlink')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await api.xUnlink(demo ? { mint: m.mint } : await xProof(m, 'unlink')); } catch { /* */ }
      go(`coin/${m.mint}`);
    });
  }
  function bindKit(root, m, op) {
    bindX(root, m);
    root.querySelectorAll('[data-kcopy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.kcopy); b.textContent = 'Copied'; } catch { b.textContent = 'Select it'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1600);
    }));
    $('kit-card')?.addEventListener('click', async () => {
      const box = $('kit-card-out');
      box.innerHTML = '<p class="muted small">Drawing its card…</p>';
      try {
        const { imageData, renderCard } = await import('/build/cardmaker.js');
        const c = op?.constitution;
        const coin = m.image ? await imageData(m.image) : null;
        const blob = await renderCard('coin', { symbol: m.symbol, name: m.name, burnPct: c?.burn?.pct || 0, mind: c?.mind?.name || m.keeper?.model }, coin ? { coin } : {});
        const url = URL.createObjectURL(blob);
        box.innerHTML = `<img src="${url}" alt="$${esc(m.symbol)}'s card"><div class="kit-act"><a class="wbtn" href="${url}" download="${esc(m.symbol.toLowerCase())}-wick.png">Download</a></div>`;
      } catch (err) {
        box.innerHTML = `<p class="muted small">Could not draw the card: ${esc(err.message)}</p>`;
      }
    });
  }
  function constitutionHtml(c, m) {
    if (!c) return '<p class="muted small">This coin was launched before agents had a Constitution.</p>';
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const no = '<span class="op-no">NO</span>';
    return `<div class="op-const">
      <p class="op-locked"><span class="op-badge">${icon('lock')} LOCKED</span> Set at launch. Nobody can change it, not even WICK.</p>
      <dl>
        ${row('Character', esc(c.personality))}
        ${c.character ? row('In its creator\'s words', `<i class="op-quote">“${esc(c.character)}”</i>`) : ''}
        ${c.objective ? row('Objective', `<b>${esc(c.objective.label)}</b> <small>· ${esc(c.objective.hint)}</small>`) : ''}
        ${row('Mind', `<span class="kc-model">${aiLogo(c.mind, 14)} ${esc(c.mind.name)}</span> <small>by ${esc(c.mind.by)}</small>`)}
        ${row('Burn allocation', c.burn ? `<b class="gold">${c.burn.pct}%</b> of creator fees <small>· +${c.burn.wickPct}% burns ${tk()}${c.burn.crewPct ? ` · ${c.burn.crewPct}% its crew` : ''} · ${c.burn.teamPct}% team</small>` : 'Off <small>· its creator keeps all creator fees</small>')}
        ${row('Can sell', no)}
        ${row('Can move funds', no)}
        ${c.proof ? row('Proof', `<a href="${solscan(esc(c.proof))}" target="_blank" rel="noopener">Fee split on Solscan ↗</a>`) : ''}
      </dl>
      <ul class="op-rules">${c.rules.map((r) => `<li>${icon('check')}${esc(r)}</li>`).join('')}</ul>
    </div>`;
  }
  function operatorPanel(m, op = {}) {
    const k = m.keeper || m.candle?.keeper;
    if (!k) return '';
    const c = m.candle;
    const log = op.log || [];
    const last = log.find((e) => e.kind !== 'launched');
    return `<section class="keeper-card op-panel">
      <div class="kc-head">
        <span class="kc-avatar">${icon('keeper')}${k.logo ? `<i class="kc-mind">${aiLogo(k, 14)}</i>` : ''}</span>
        <div><b>Agent of $${esc(m.symbol)}</b><small>${esc(k.label)}${op.constitution?.objective ? ` · ${esc(op.constitution.objective.label)}` : ''} · runs on <span class="kc-model">${aiLogo(k, 14)} ${esc(k.model)}</span> (${esc(k.by)})</small></div>
        <span class="kc-status"><i></i>${last && Date.now() - last.at < 86_400_000 ? `active ${ago(last.at)}` : 'on duty'}</span>
      </div>
      ${k.intro ? `<blockquote>“${esc(k.intro)}”</blockquote>` : ''}
      <div class="op-tabs" role="tablist">
        <button type="button" class="on" data-optab="act" role="tab">Activity <small>${log.length}</small></button>
        <button type="button" data-optab="missions" role="tab">Missions <small>${(op.missions || []).filter((x) => x.status === 'done').length}/${(op.missions || []).filter((x) => x.status !== 'ongoing').length}</small></button>
        <button type="button" data-optab="kit" role="tab">Kit</button>
        <button type="button" data-optab="const" role="tab">Constitution</button>
        <button type="button" data-optab="talk" role="tab">Talk</button>
      </div>
      <div class="op-pane" data-oppane="act">${activity(log)}</div>
      <div class="op-pane" data-oppane="missions" hidden>${missionsHtml(op.missions)}</div>
      <div class="op-pane" data-oppane="kit" hidden>${kitHtml(op.kit, m, op)}</div>
      <div class="op-pane" data-oppane="const" hidden>${constitutionHtml(op.constitution, m)}</div>
      <div class="op-pane" data-oppane="talk" hidden>${chatHtml({
        mint: m.mint, symbol: m.symbol,
        keeper: { name: `Agent of $${m.symbol}`, label: k.label, model: k.model, by: k.by, logo: k.logo },
        suggestions: [`What's the story of $${m.symbol}?`, c ? 'When do you burn next?' : 'How is it doing today?', 'What have you done so far?'],
      })}</div>
    </section>`;
  }
  function bindTabs(root) {
    root.querySelectorAll('[data-optab]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('[data-optab]').forEach((x) => x.classList.toggle('on', x === b));
      root.querySelectorAll('[data-oppane]').forEach((p) => { p.hidden = p.dataset.oppane !== b.dataset.optab; });
    }));
  }

  // ---------------------------------------------------------- la page d'un coin
  async function coin(mint) {
    openModal(`<div id="cn-body" class="cn"><p class="muted">Loading…</p></div>`, 'm-wide m-coin');
    let data;
    try {
      data = await api.coin(mint);
    } catch {
      if ($('cn-body')) $('cn-body').innerHTML = '<p class="muted">This coin is not on WICK, or could not be loaded.</p>';
      return;
    }
    const body = $('cn-body');
    if (!body || !data?.match) return;
    const m = data.match;
    const c = m.candle;
    const wickBps = m.share?.bps ?? 0;
    const teamBps = m.share?.teamBps ?? 0;
    const crewBps = m.share?.crewBps ?? 0;
    const selfBps = c?.bps ?? 0;
    const creatorBps = 10_000 - wickBps - selfBps;
    const tweet = c
      ? `$${m.symbol} burns itself on WICK: ${pctText(c.pct)} of its supply burned so far, ${selfBps / 100}% of its creator fees, forever.\n${location.origin}/#coin/${m.mint}`
      : `$${m.symbol} on WICK, the launchpad that burns itself.\n${location.origin}/#coin/${m.mint}`;
    body.innerHTML = `
      <div class="cn-grid">
        <div class="cn-stage">
          <div class="cn-corner"><small>Supply left</small><b>${c ? pctText(100 - c.pct) : '100%'}</b></div>
          <div class="cn-corner right"><small>Burns</small><b class="gold">${fmt(c?.burns || 0)}</b></div>
          ${candleHtml({ pct: c?.pct ?? 0, w: 104, full: 300, gold: m.holder, out: !c, ghost: true, big: true })}
          <p class="muted small">${!c ? 'This coin does not burn itself. Its candle is unlit.'
            : c.burned > 0 ? `The dashed outline is the ${pctText(c.pct)} of $${esc(m.symbol)} already burned. Gone forever.`
              : `Lit. Its first burn melts the candle, and every burn after that, forever.`}</p>
        </div>
        <div class="cn-info">
          <div class="cn-title">
            ${avatar(m, 60)}
            <div>
              <h2>$${esc(m.symbol)} <small>${esc(m.name)}</small></h2>
              <div class="cn-tags">
                ${c ? `<span class="cn-tag gold">Burns itself · ${selfBps / 100}%</span>` : ''}
                <span class="cn-tag">Launched on WICK · match #${fmt(m.seq)}</span>
                ${m.share ? '<span class="cn-tag">Split locked on pump.fun</span>' : ''}
                ${m.holder ? `<span class="cn-tag">${tk()} holder</span>` : ''}
              </div>
            </div>
          </div>
          <div class="tiles cn-tiles">
            <div><strong class="gold">${c ? compact(c.burned) : '0'}</strong><span>$${esc(m.symbol)} burned${c ? ` · ${pctText(c.pct)} of the supply` : ''}</span></div>
            <div><strong>${sol(c?.sol || 0)}</strong><span>of its fees spent burning it</span></div>
            <div><strong>${m.burned ? compact(m.burned) : '—'}</strong><span>${tk()} burned at launch</span></div>
            <div><strong>${usd(m.mcap)}</strong><span>market cap${m.volume ? ` · vol 24h ${usd(m.volume)}` : ''}</span></div>
          </div>
          <div class="cn-actions">
            <a class="cta small-cta" href="${pumpUrl(esc(m.mint))}" target="_blank" rel="noopener">Buy on pump.fun</a>
            <a class="wbtn" href="https://x.com/intent/post?text=${encodeURIComponent(tweet)}" target="_blank" rel="noopener">Share its candle</a>
            <a class="wbtn" href="https://solscan.io/token/${esc(m.mint)}" target="_blank" rel="noopener">Solscan ↗</a>
          </div>
          ${m.description ? `<p class="cn-about">${esc(m.description)}</p>` : ''}
          ${m.feeDue && !demo && connect.current()?.address === m.creator ? `<div class="fee-due"><p><b>Finish your launch.</b> Approve its Ignition Fee and its fee split:
            until then, $${esc(m.symbol)} doesn't burn ${tk()} and its crew isn't paid.</p><p class="error" id="fee-due-error" hidden></p>
            <button type="button" class="cta small-cta" id="fee-due-go">Approve the Ignition Fee</button></div>` : ''}
          ${operatorPanel(m, data.operator)}
          ${m.share ? `<div class="cn-split">
            <small class="eyebrow">Where its creator fees go</small>
            <div class="split-bar">
              <span style="width:${creatorBps / 100}%">Creator ${creatorBps / 100}%</span>
              ${selfBps ? `<span class="self" style="width:${selfBps / 100}%">${selfBps >= 1500 ? (selfBps >= 2000 && m.symbol.length <= 5 ? `Burns $${esc(m.symbol)} ` : 'Burns ') : ''}${selfBps / 100}%</span>` : ''}
              ${crewBps ? `<span class="crew" style="width:${crewBps / 100}%">Crew ${crewBps / 100}%</span>` : ''}
              ${wickBps - teamBps - crewBps > 0 ? `<span class="wick" style="width:${(wickBps - teamBps - crewBps) / 100}%"></span>` : ''}
              ${teamBps ? `<span class="team" style="width:${teamBps / 100}%"></span>` : ''}
            </div>
            <small class="muted">${selfBps ? `${selfBps / 100}% buys $${esc(m.symbol)} back and burns it · ` : ''}${crewBps ? `${crewBps / 100}% its crew (its AI, its posts) · ` : ''}${(wickBps - teamBps - crewBps) / 100}% burns ${tk()} · ${teamBps / 100}% WICK team. Set at launch, locked on pump.fun.</small>
          </div>` : ''}
          <section class="cd-card">
            <h3>Every burn <small>on-chain</small></h3>
            ${data.burns.length ? `<div class="cn-table"><table>
              <thead><tr><th>When</th><th>Burned</th><th>SOL used</th><th>Of supply</th><th></th></tr></thead>
              <tbody>${data.burns.map((b) => `<tr>
                <td class="dim"><time data-at="${b.at}">${ago(b.at)}</time></td>
                <td class="gold">${compact(b.burned)} $${esc(m.symbol)}</td>
                <td>${sol(b.sol)}</td>
                <td class="dim">${pctText((b.burned / 1e9) * 100)}</td>
                <td>${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">TX ↗</a>` : ''}</td>
              </tr>${b.voice ? `<tr class="voice"><td colspan="5">${icon('keeper')} “${esc(b.voice)}”</td></tr>` : ''}`).join('')}</tbody></table></div>`
              : `<p class="muted">${c ? 'No burn yet. Its first buyback happens once its creator fees pile up (at least 0.01 SOL for its candle).' : 'This coin was launched without Make it burn.'}</p>`}
          </section>
        </div>
      </div>
      <div class="cn-foot"><button class="link-btn" id="cn-forest">All the candles</button>
        <button class="cta" id="cn-light">Light your own candle</button></div>`;
    $('cn-forest').addEventListener('click', () => go('candles'));
    $('cn-light').addEventListener('click', onStrike);
    bindChats(body, api.ask);
    bindTabs(body);
    bindKit(body, m, data.operator);
    $('fee-due-go')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'Check your wallet…';
      try {
        const { payFee } = await import('./wallet.js');
        await payFee({ mint: m.mint });
        go(`coin/${m.mint}`);
      } catch (err) {
        b.disabled = false;
        b.textContent = 'Approve the Ignition Fee';
        const box = $('fee-due-error');
        box.hidden = false;
        box.textContent = err.code === 'no_funds' ? 'Your wallet needs a little more SOL for it.' : err.code === 'rejected' ? 'Cancelled in your wallet.' : 'Could not send it. Try again.';
      }
    });
  }

  return { forest, coin, candleHtml };
}
