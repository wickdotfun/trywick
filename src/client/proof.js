// La page Proof (#proof) : ce que chacun peut vérifier lui-même. Les wallets, les règles des fees,
// où est allé chaque SOL, ce que les crews ont gagné et dépensé, et chaque burn avec sa
// transaction (GET /api/proof, lib/proof.js).
import { ago, compact, esc, fmt, icon, short, sol, solscan } from './util.js';

const account = (a) => `https://solscan.io/account/${a}`;
const tokenUrl = (a) => `https://solscan.io/token/${a}`;
const KIND = { candle: 'Buyback', match: 'Launch burn', coin: 'Coin burn' };

export function createProof({ api, openModal, isOpen, ticker, demo }) {
  const tk = () => `$${ticker()}`;

  function walletCard(w) {
    return `<article class="pf-wallet">
      <div class="pf-w-head"><span class="pf-w-ico">${icon(w.role === 'burn' ? 'flame' : 'user')}</span>
        <div><b>${esc(w.label)}</b><a class="mono" href="${account(esc(w.address))}" target="_blank" rel="noopener">${esc(short(w.address))} ↗</a></div>
        <button type="button" class="wbtn pf-copy" data-copy="${esc(w.address)}">Copy</button></div>
      <ul class="pf-list">${w.does.map((d) => `<li>${icon('check')}${esc(d)}</li>`).join('')}${w.never.map((d) => `<li class="no">${icon('lock')}${esc(d)}</li>`).join('')}</ul>
    </article>`;
  }

  function splitBar(s) {
    return `<div class="split-bar cw-split">
      <span style="width:${s.creatorPct}%">Creator ${s.creatorPct}%</span>
      ${s.crewPct ? `<span class="crew" style="width:${s.crewPct}%">Crew ${s.crewPct}%</span>` : ''}
      <span class="wick" style="width:${s.burnPct}%">${s.burnPct}%</span>
      <span class="team" style="width:${s.teamPct}%">${s.teamPct}%</span></div>`;
  }

  const row = (label, value, sub = '') => `<div class="pf-row"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  function render(d) {
    const f = d.flows, r = d.rules, c = d.crew;
    const sharedSol = f.shareBurnSol + f.shareSelfSol + f.shareCrewSol + f.shareTeamSol;
    return `
      <div class="cw-hero pf-hero">
        <span class="eyebrow">Proof</span>
        <h2>Don't trust. <span class="grad">Verify.</span></h2>
        <p class="lead muted">Every wallet, every rule, every SOL and every burn of WICK, each with its transaction on Solana.
          Nothing here is an estimate unless it says so. <b>The code is open source.</b></p>
        <div class="pf-links">
          <a class="wbtn" href="${esc(d.code.repo)}" target="_blank" rel="noopener">${icon('book')} Source code</a>
          ${d.token.mint ? `<a class="wbtn" href="${tokenUrl(esc(d.token.mint))}" target="_blank" rel="noopener">${icon('candle')} ${tk()} on Solscan</a>` : ''}
          <a class="wbtn" href="${demo ? '#' : '/api/proof/burns.csv'}" ${demo ? 'data-csv' : 'download'}>${icon('chart')} Every burn (CSV)</a>
        </div>
      </div>

      ${d.lock ? `<section class="pf-lock">${icon('lock')}<div><b>Team ${tk()} locked${d.lock.amount ? `: ${fmt(d.lock.amount)} ${tk()}` : ''}</b>
        <small>${d.lock.until ? `Until ${new Date(d.lock.until).toUTCString().slice(5, 16)}. ` : ''}Can't be canceled or moved before then.</small></div>
        <a class="wbtn" href="${esc(d.lock.url)}" target="_blank" rel="noopener">See the contract ↗</a></section>` : ''}

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('lock')} The wallets</h3><small class="muted">two wallets, nothing hidden</small></div>
        <div class="pf-wallets">${d.wallets.map(walletCard).join('')}</div>
      </section>

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('chart')} The rules</h3><small class="muted">set in the code, and on-chain for each coin</small></div>
        <div class="pf-rules">
          <div><small class="k-label">Ignition Fee, every launch</small>
            <div class="split-bar cw-split"><span class="wick" style="width:${r.ignition.burnPct}%">Burns ${tk()} ${r.ignition.burnPct}%</span><span class="team" style="width:${r.ignition.teamPct}%">Team ${r.ignition.teamPct}%</span></div></div>
          <div><small class="k-label">Every coin's creator fees</small>${splitBar(r.split)}
            <small class="muted">${r.split.creatorPct}% creator (Make it burn: ${r.selfBurnPcts.join(', ')}% of it buys the coin back and burns it) · ${r.split.crewPct}% its crew (AI, X posts) · ${r.split.burnPct}% burns ${tk()} · ${r.split.teamPct}% team.</small></div>
        </div>
        <p class="muted small">${esc(r.locked)} ${tk()}'s own pump.fun creator fees go ${r.wickCreatorFees === 'burn' ? 'to the burn wallet' : 'to the team wallet, like any pump.fun creator'}.</p>
      </section>

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('flame')} Where every SOL went</h3><small class="muted">totals of what WICK recorded; every burn below has its transaction</small></div>
        <div class="pf-flows">
          <div class="pf-flow"><small class="k-label">In</small>
            ${row('Ignition Fees', sol(f.ignitionSol), `${fmt(f.launches)} launches`)}
            ${row('Creator fees shared with WICK', sol(sharedSol), `${fmt(f.sharedCoins)} distributions`)}
          </div>
          <div class="pf-flow"><small class="k-label">Out</small>
            ${row(`Bought ${tk()} and burned it`, sol(f.wickBurnSol), `${compact(f.wickBurned)} ${tk()} · ${fmt(f.wickBurns)} burns`)}
            ${row('Coins burned themselves', sol(f.coinBurnSol), `${fmt(f.coinBurns)} burns`)}
            ${row('Crews (AI, X posts)', sol(f.shareCrewSol))}
            ${row('WICK team', sol(f.ignitionTeamSol + f.shareTeamSol), 'Ignition half + team share')}
          </div>
        </div>
        <p class="muted small">What hasn't been burned yet waits in the burn wallet for the next buyback. Its live balance:
          <a href="${account(esc(d.wallets[0].address))}" target="_blank" rel="noopener">Solscan ↗</a>.</p>
      </section>

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('keeper')} The crews' book</h3><small class="muted">what the 20% paid for</small></div>
        <div class="cw-stats">
          <div><strong>${sol(c.earnedSol)}</strong><span>earned by ${fmt(c.coins)} crews</span></div>
          <div><strong>${fmt(c.premiumCalls)}</strong><span>premium mind calls</span></div>
          <div><strong>${fmt(c.xPosts)}</strong><span>posts on X</span></div>
          <div><strong>≈ $${c.spentUsd.toLocaleString('en-US')}</strong><span>spent, at list prices</span></div>
        </div>
        <p class="muted small">Counted for real; the dollar amount is estimated at $${c.rates.premiumUsdPerCall} per premium call and $${c.rates.xUsdPerPost} per X post (no links).</p>
      </section>

      <section class="cw-sec">
        <div class="cw-sec-head"><h3>${icon('flame')} Every burn</h3><small class="muted">latest ${d.receipts.length} · all of them in the CSV</small></div>
        ${d.receipts.length ? `<div class="pf-table"><table>
          <thead><tr><th>When</th><th>What</th><th>Token</th><th class="num">SOL</th><th class="num">Burned</th><th>Transactions</th></tr></thead>
          <tbody>${d.receipts.map((b) => `<tr>
            <td><time data-at="${b.at}">${ago(b.at)}</time></td>
            <td>${KIND[b.kind] || esc(b.kind)}${b.kind === 'match' && b.symbol ? ` <small>$${esc(b.symbol)}</small>` : ''}</td>
            <td>${b.kind === 'coin' ? `<a href="#coin/${esc(b.mint)}">$${esc(b.symbol || '?')}</a>` : tk()}</td>
            <td class="num mono">${(+b.sol || 0).toFixed(4)}</td>
            <td class="num mono gold">${compact(b.burned || 0)}</td>
            <td class="pf-tx">${b.buySig ? `<a href="${solscan(esc(b.buySig))}" target="_blank" rel="noopener">buy ↗</a>` : ''}${b.sig ? `<a href="${solscan(esc(b.sig))}" target="_blank" rel="noopener">burn ↗</a>` : '<span class="muted">demo</span>'}</td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No burn yet: the first one comes with the first launch.</p>'}
      </section>`;
  }

  function bind(d) {
    document.querySelectorAll('#modal-body [data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; } catch { b.textContent = 'Select it'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1600);
    }));
    // La démo : le CSV est fait ici, avec ses burns.
    document.querySelector('#modal-body [data-csv]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const lines = ['date_utc,kind,token,sol,burned,burn_tx,buy_tx', ...d.receipts.map((b) => [new Date(b.at).toISOString(), b.kind, b.kind === 'coin' ? b.symbol : ticker(), b.sol, Math.round(b.burned), b.sig || '', b.buySig || ''].join(','))];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }));
      a.download = 'wick-burns-demo.csv';
      a.click();
    });
  }

  async function open() {
    openModal('<div class="cw-hero pf-hero"><span class="eyebrow">Proof</span><h2>Don\'t trust. <span class="grad">Verify.</span></h2><p class="muted">Loading…</p></div>', 'm-wide m-crew m-proof');
    try {
      const d = await api.proof();
      if (!isOpen('m-proof')) return;
      openModal(render(d), 'm-wide m-crew m-proof');
      bind(d);
    } catch {
      if (isOpen('m-proof')) openModal('<h2>Proof</h2><p class="muted">Could not load the proof. Try again in a moment.</p>', 'm-wide m-crew m-proof');
    }
  }

  return { open };
}
