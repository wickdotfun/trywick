// La page $WICK : le vrai coin. Sa chart en direct (DexScreener), son prix, sa courbe pump.fun,
// ses plus gros holders, ce que WICK en a brûlé, et l'achat / la vente directement ici
// (PumpPortal construit la transaction, le wallet du visiteur la signe, le serveur la relaie).
import * as connect from './connect.js';
import { compact, esc, fmt, icon, pumpUrl, short, solscan } from './util.js';

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 15_000;
const BUY_PRESETS = [0.1, 0.5, 1, 2];
const SELL_PRESETS = [25, 50, 75, 100];
const SLIPPAGES = [5, 10, 15, 20, 30];
const TELEGRAM = 'https://t.me/trywickdotfun';

const ERRORS = {
  rejected: 'Cancelled in your wallet. Nothing was sent.',
  expired: 'The transaction expired before it was signed. Try again.',
  no_funds: 'Not enough SOL in your wallet.',
  no_tokens: 'No $WICK in this wallet to sell.',
  slippage: 'The price moved too much. Try again, or raise the slippage.',
  tx_failed: 'The transaction failed on Solana. Try again.',
  send_failed: "Couldn't reach Solana. Try again.",
  build_failed: "pump.fun couldn't build the trade. Try again in a moment.",
  not_live: '$WICK is not live yet.',
  bad_amount: 'Enter an amount between 0.001 and 100 SOL.',
  no_connect: 'Wallet connection cancelled.',
};

// Le dernier wallet connecté (son adresse publique seulement), pour « Your flames ».
export function remember(address) {
  try { localStorage.setItem('wick.wallet', address); } catch { /* pas de stockage */ }
}
export function remembered() {
  try { return localStorage.getItem('wick.wallet'); } catch { return null; }
}

// Les prix des memecoins sont minuscules : 0.00002134 plutôt que 0.
function price(n) {
  if (n == null) return '—';
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4).replace(/0+$/, '')}`;
}
const usd = (n) => (n == null ? '—' : `$${compact(n)}`);
const signed = (n) => (n == null ? '' : `${n >= 0 ? '+' : ''}${n.toFixed(Math.abs(n) < 10 ? 2 : 1)}%`);

export function createTokenPage({ api, openModal, isOpen, world, ticker, breathText, demo, onBurns }) {
  let data = null;
  let side = 'buy';
  let slippage = 10;
  const owner = () => connect.current()?.address || null;
  let busy = false;
  let timer = null;

  // ---------------------------------------------------------- la page
  function open() {
    const t = world.token || {};
    const mint = demo ? 'WicKDemo1111111111111111111111111111111pump' : t.mint;
    const tk = ticker();
    if (!mint) { soon(tk, t); return; }
    openModal(`
      <div class="tk">
        <header class="tk-head">
          <img class="tk-logo" id="tk-logo" src="brand/icon-192.png" alt="">
          <div class="tk-title">
            <h2>$${tk} <span class="tk-badge">Official</span></h2>
            <p>The coin of the candle. Every burn on this site is $${tk}.</p>
          </div>
          <div class="tk-price"><strong id="tk-price">—</strong><span id="tk-change"></span></div>
        </header>
        <div class="tk-ca">
          <span class="tk-ca-label">CA</span>
          <code class="mono" id="tk-ca">${esc(mint)}</code>
          <button class="ghost tiny" id="tk-copy">Copy</button>
          <span class="tk-links">
            <a href="${pumpUrl(esc(mint))}" target="_blank" rel="noopener">pump.fun ↗</a>
            <a href="https://dexscreener.com/solana/${esc(mint)}" target="_blank" rel="noopener">DexScreener ↗</a>
            <a href="https://solscan.io/token/${esc(mint)}" target="_blank" rel="noopener">Solscan ↗</a>
          </span>
        </div>
        <div class="tk-grid">
          <div class="tk-main">
            <div class="tk-chart" id="tk-chart">${demo ? demoChart() : `<iframe title="$${tk} live chart" loading="lazy"
              src="https://dexscreener.com/solana/${encodeURIComponent(mint)}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=0&chartType=usdMarketCap&interval=5"></iframe>`}</div>
            <dl class="tk-stats">
              <div><dt>Market cap</dt><dd id="tk-mcap">—</dd></div>
              <div><dt>Volume 24h</dt><dd id="tk-vol">—</dd></div>
              <div><dt>Liquidity</dt><dd id="tk-liq">—</dd></div>
              <div><dt>Buys / sells 24h</dt><dd id="tk-txns">—</dd></div>
            </dl>
            <section class="tk-burn">
              <div class="tk-burn-big"><strong id="tk-burned-pct">—</strong><span>of $${tk} burned forever</span></div>
              <div><b id="tk-burned">—</b><span>$${tk} burned</span></div>
              <div><b id="tk-candles">—</b><span>candles consumed</span></div>
              <div><b id="tk-next">—</b><span>next buyback</span></div>
              <button class="link-btn tiny" id="tk-burns">burn tracker →</button>
            </section>
            <ul class="tk-why">
              <li>${icon('flame', 'fire')}<span><b>Every launch burns it.</b> Each coin launched on WICK pays a ${world.launch?.feeSol || 0.02} SOL Ignition Fee: 50% buys $${tk} and burns it within a minute, 50% funds the team.</span></li>
              <li>${icon('wind', 'fire')}<span><b>Buybacks, all day.</b> The burn share of the fees, including the creator fees shared by WICK coins, buys $${tk} back and burns it every ${Math.round((world.breath?.durationMs ?? 1_800_000) / 60_000)} minutes at most.</span></li>
              <li>${icon('crown', 'gold')}<span><b>Holders burn in gold.</b> Hold $${tk} and your launches get a golden flame around the candle.</span></li>
            </ul>
          </div>
          <aside class="tk-side">
            <div class="card tk-trade">
              <div class="seg" role="tablist">
                <button type="button" data-side="buy" class="on">Buy</button>
                <button type="button" data-side="sell">Sell</button>
              </div>
              <label class="tk-amount"><input id="tk-amt" type="number" inputmode="decimal" min="0" step="any" value="0.1" aria-label="Amount"><b id="tk-unit">SOL</b></label>
              <div class="presets" id="tk-presets"></div>
              <p class="tk-est" id="tk-est">&nbsp;</p>
              <details class="tk-slip"><summary>Slippage <b id="tk-slip-v">${slippage}%</b></summary>
                <div class="presets">${SLIPPAGES.map((s) => `<button type="button" data-slip="${s}"${s === slippage ? ' class="on"' : ''}>${s}%</button>`).join('')}</div>
              </details>
              <button class="cta wide" id="tk-go">Buy $${tk}</button>
              <p class="error" id="tk-err" hidden></p>
              <p class="tk-done" id="tk-done" hidden></p>
              <p class="tk-who" id="tk-who">${owner() ? `Wallet ${esc(short(owner()))}` : ''}</p>
              <p class="muted tiny">Traded on pump.fun (PumpSwap once it graduates), built by PumpPortal, which takes a small fee per
                trade. Your wallet shows everything before you sign. WICK never holds your funds.</p>
            </div>
            <div class="card">
              <h4>Bonding curve <b id="tk-curve-pct">—</b></h4>
              <div class="bar"><i id="tk-curve-bar"></i></div>
              <p class="muted tiny" id="tk-curve-note">&nbsp;</p>
            </div>
            <div class="card">
              <h4>Top holders</h4>
              <ol class="tk-holders" id="tk-holders"><li class="muted">Loading…</li></ol>
            </div>
          </aside>
        </div>
        <p class="muted tiny tk-foot">$${tk} is a meme coin. It can go to zero. Nothing here is financial advice. The only official
          address is the one above, also posted on <a href="https://x.com/trywickdotfun" target="_blank" rel="noopener">X</a> and
          <a href="${esc(t.telegram || TELEGRAM)}" target="_blank" rel="noopener">Telegram</a>.</p>
      </div>`, 'm-token');
    wire(mint);
    if (data) fill(data);
    refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (isOpen('m-token')) refresh(); else clearInterval(timer); }, REFRESH_MS);
    tick();
  }

  // Avant le lancement du vrai coin : ce qui arrive, et où sera annoncée l'adresse.
  function soon(tk, t) {
    openModal(`
      <div class="tk tk-soon">
        <header class="tk-head">
          <img class="tk-logo" src="brand/icon-192.png" alt="">
          <div class="tk-title"><h2>$${tk} <span class="tk-badge">Soon</span></h2><p>The coin of the candle.</p></div>
        </header>
        <div class="tk-soon-box">
          <div class="tk-chart tk-chart-soon" aria-hidden="true">${demoChart(7)}<span>Launching on pump.fun soon</span></div>
          <div>
            <h3>The candle is $${tk}. When it launches, this page becomes its home.</h3>
            <p class="muted">The live chart, buy and sell right here, the bonding curve, the top holders, and every $${tk} burned.</p>
            <ul class="tk-why">
              <li>${icon('flame', 'fire')}<span><b>Every launch burns it.</b> Each coin launched on WICK pays an Ignition Fee: 50% buys $${tk} and burns it within a minute, 50% funds the team.</span></li>
              <li>${icon('wind', 'fire')}<span><b>Buybacks, all day.</b> The burn share of the fees, including the creator fees shared by WICK coins, buys $${tk} back and burns it every 30 minutes at most.</span></li>
              <li>${icon('candle', 'fire')}<span><b>Supply only goes down.</b> The candle shows it: each one is 0.5% of the supply, gone forever.</span></li>
            </ul>
            <p class="note"><b>The only official address</b> will be posted here, on X and on Telegram at launch. Anything before that is fake.</p>
            <div class="wallets">
              <a class="wbtn" href="${esc(t.x || 'https://x.com/trywickdotfun')}" target="_blank" rel="noopener">Follow on X</a>
              <a class="wbtn" href="${esc(t.telegram || TELEGRAM)}" target="_blank" rel="noopener">Join the Telegram</a>
            </div>
          </div>
        </div>
      </div>`, 'm-token');
  }

  function wire(mint) {
    $('tk-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(mint); $('tk-copy').textContent = 'Copied'; } catch { $('tk-copy').textContent = 'Select it'; }
      setTimeout(() => { if ($('tk-copy')) $('tk-copy').textContent = 'Copy'; }, 1800);
    });
    $('tk-burns').addEventListener('click', onBurns);
    document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side)));
    document.querySelectorAll('[data-slip]').forEach((b) => b.addEventListener('click', () => {
      slippage = Number(b.dataset.slip);
      document.querySelectorAll('[data-slip]').forEach((x) => x.classList.toggle('on', x === b));
      $('tk-slip-v').textContent = `${slippage}%`;
    }));
    $('tk-amt').addEventListener('input', estimate);
    $('tk-go').addEventListener('click', go);
    setSide(side);
  }

  function setSide(s) {
    side = s;
    const tk = ticker();
    document.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === s));
    $('tk-unit').textContent = s === 'buy' ? 'SOL' : '%';
    $('tk-amt').value = s === 'buy' ? '0.1' : '50';
    $('tk-presets').innerHTML = (s === 'buy' ? BUY_PRESETS : SELL_PRESETS)
      .map((v) => `<button type="button" data-v="${v}">${s === 'buy' ? `${v} SOL` : `${v}%`}</button>`).join('');
    $('tk-presets').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { $('tk-amt').value = b.dataset.v; estimate(); }));
    $('tk-go').textContent = `${s === 'buy' ? 'Buy' : 'Sell'} $${tk}`;
    $('tk-go').classList.toggle('sell', s === 'sell');
    showError('');
    estimate();
  }

  function estimate() {
    const el = $('tk-est');
    if (!el) return;
    const v = Number($('tk-amt').value);
    const p = data?.market?.priceSol;
    if (side === 'sell') el.textContent = v > 0 ? `Sells ${Math.min(100, Math.round(v))}% of the $${ticker()} in your wallet` : ' ';
    else el.textContent = v > 0 && p ? `≈ ${compact(v / p)} $${ticker()} (before fees and slippage)` : ' ';
  }

  // ---------------------------------------------------------- les données
  async function refresh() {
    try {
      data = await api.token();
      if (isOpen('m-token')) fill(data);
    } catch (err) {
      console.warn('token', err);
    }
  }

  function fill(d) {
    if (!$('tk-price')) return;
    const m = d.market;
    $('tk-price').textContent = m ? price(m.priceUsd) : 'Not trading yet';
    const ch = m?.change?.h24;
    $('tk-change').textContent = ch != null ? `${signed(ch)} 24h` : '';
    $('tk-change').className = ch == null ? '' : ch >= 0 ? 'up' : 'down';
    $('tk-mcap').textContent = usd(m?.mcap);
    $('tk-vol').textContent = usd(m?.volume24h);
    $('tk-liq').textContent = m?.dex === 'pumpfun' ? 'bonding curve' : usd(m?.liquidity);
    $('tk-txns').innerHTML = m?.buys24h != null ? `<span class="up">${fmt(m.buys24h)}</span> / <span class="down">${fmt(m.sells24h ?? 0)}</span>` : '—';
    if (m?.image && /^https:/.test(m.image)) $('tk-logo').src = m.image;

    const c = d.curve;
    $('tk-curve-pct').textContent = c ? (c.complete ? 'Graduated' : `${(c.progress * 100).toFixed(1)}%`) : '—';
    $('tk-curve-bar').style.width = `${((c?.progress ?? 0) * 100).toFixed(1)}%`;
    $('tk-curve-note').textContent = !c ? 'Shown once $WICK trades.'
      : c.complete ? `$${ticker()} graduated from pump.fun: it now trades on PumpSwap.`
        : `When the curve fills, $${ticker()} graduates to PumpSwap.${c.sol != null ? ` ${c.sol.toFixed(1)} SOL in the curve.` : ''}`;

    const h = d.holders;
    $('tk-holders').innerHTML = !h ? '<li class="muted">Unavailable right now.</li>'
      : !h.length ? '<li class="muted">No holder yet.</li>'
        : h.map((x, i) => `<li><span class="rank">${i + 1}</span>
            <a class="mono" href="https://solscan.io/account/${esc(x.owner || '')}" target="_blank" rel="noopener">${esc(short(x.owner || '?'))}</a>
            ${x.label ? `<i class="tag${x.label === 'WICK buyback' ? ' fire' : ''}">${esc(x.label)}</i>` : ''}
            ${x.owner && x.owner === owner() ? '<i class="tag gold">you</i>' : ''}
            <b>${x.pct != null ? `${x.pct.toFixed(2)}%` : compact(x.amount)}</b></li>`).join('');
    estimate();
    tick();
  }

  // Chaque seconde (depuis app.js) : ce que WICK a brûlé et le prochain buyback.
  function tick() {
    if (!$('tk-next')) return;
    const t = world.totals;
    $('tk-burned-pct').textContent = t.supplyPct != null ? `${t.supplyPct < 1 ? t.supplyPct.toFixed(2) : t.supplyPct.toFixed(1)}%` : '—';
    $('tk-burned').textContent = compact(t.burned || 0);
    $('tk-candles').textContent = fmt((world.candle?.number ?? 1) - 1);
    $('tk-next').textContent = breathText();
  }

  // ---------------------------------------------------------- acheter / vendre
  function showError(msg) {
    const el = $('tk-err');
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }


  async function go() {
    if (busy) return;
    const amount = Number($('tk-amt').value);
    const tk = ticker();
    showError('');
    $('tk-done').hidden = true;
    if (side === 'buy' && !(amount >= 0.001 && amount <= 100)) { showError(ERRORS.bad_amount); return; }
    if (side === 'sell' && !(amount >= 1 && amount <= 100)) { showError('Choose between 1% and 100%.'); return; }
    const btn = $('tk-go');
    const label = btn.textContent;
    busy = true;
    btn.disabled = true;
    try {
      let mod = null;
      if (!demo) {
        btn.textContent = 'Connecting…';
        [mod] = await Promise.all([import('./wallet.js'), connect.ensure()]);
        if (!owner()) { showError('Connect a wallet to trade.'); return; }
        $('tk-who').textContent = `Wallet ${short(owner())}`;
      }
      const step = (s) => { if ($('tk-go')) $('tk-go').textContent = { build: 'Preparing…', sign: 'Sign in your wallet…', send: 'Sending…', confirm: 'Confirming…' }[s]; };
      const run = demo ? api.trade : mod.trade;
      const res = await run({ owner: owner(), side, amount, slippage, onStep: step });
      const done = $('tk-done');
      if (done) {
        done.hidden = false;
        done.innerHTML = res.status === 'ok'
          ? `${side === 'buy' ? 'Bought. Welcome to the holders: your next launch on WICK burns in gold.' : 'Sold.'}
             ${res.signature ? ` <a href="${solscan(esc(res.signature))}" target="_blank" rel="noopener">Transaction ↗</a>` : ''}`
          : `Sent. Solana hasn't confirmed it yet. <a href="${solscan(esc(res.signature))}" target="_blank" rel="noopener">Follow it ↗</a>`;
      }
      setTimeout(refresh, 4000);
    } catch (err) {
      if (err.code === 'rejected' || /reject|cancel|denied/i.test(err.message || '')) showError(ERRORS.rejected);
      else showError(ERRORS[err.code] || `Something went wrong. Try again.`);
    } finally {
      busy = false;
      const b = $('tk-go');
      if (b) { b.disabled = false; b.textContent = label || `${side === 'buy' ? 'Buy' : 'Sell'} $${tk}`; }
    }
  }

  return { open, tick, prefetch: refresh };
}

// Une fausse chart en chandeliers (démo, et la page « bientôt ») : une marche aléatoire qui monte.
function demoChart(seed = 3) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const N = 64, W = 640, H = 300;
  const candles = [];
  let v = 20;
  for (let i = 0; i < N; i++) {
    const o = v;
    v = Math.max(4, v * (1 + (rnd() - 0.42) * 0.12));
    const c = v;
    candles.push({ o, c, h: Math.max(o, c) * (1 + rnd() * 0.05), l: Math.min(o, c) * (1 - rnd() * 0.05) });
  }
  const max = Math.max(...candles.map((k) => k.h)), min = Math.min(...candles.map((k) => k.l));
  const y = (p) => 12 + (1 - (p - min) / (max - min)) * (H - 40);
  const w = W / N;
  const body = candles.map((k, i) => {
    const x = i * w + w / 2, up = k.c >= k.o;
    return `<g class="${up ? 'up' : 'down'}"><line x1="${x}" x2="${x}" y1="${y(k.h).toFixed(1)}" y2="${y(k.l).toFixed(1)}"/>
      <rect x="${(x - w * 0.32).toFixed(1)}" width="${(w * 0.64).toFixed(1)}" y="${y(Math.max(k.o, k.c)).toFixed(1)}" height="${Math.max(1, Math.abs(y(k.o) - y(k.c))).toFixed(1)}"/></g>`;
  }).join('');
  const vol = candles.map((k, i) => {
    const h = 4 + rnd() * 18;
    return `<rect class="vol ${k.c >= k.o ? 'up' : 'down'}" x="${(i * w + w * 0.18).toFixed(1)}" width="${(w * 0.64).toFixed(1)}" y="${(H - 6 - h).toFixed(1)}" height="${h.toFixed(1)}"/>`;
  }).join('');
  return `<svg class="tk-fake" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Simulated chart">${vol}${body}</svg>`;
}
