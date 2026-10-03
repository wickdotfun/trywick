// La connexion du wallet, comme sur les sites Solana d'aujourd'hui : un bouton « Connect wallet »
// en haut, une fenêtre qui liste les wallets installés (Phantom, Solflare, Backpack… avec leur
// icône), la reconnexion silencieuse au retour sur le site, et un menu une fois connecté.
//
// Les wallets sont découverts par le « Wallet Standard » (le protocole que tous les wallets Solana
// récents annoncent) : aucune bibliothèque, et la signature passe par l'API standard
// (solana:signTransaction), des octets en entrée et en sortie.
import { esc, short } from './util.js';

const $ = (id) => document.getElementById(id);
const STORE = 'wick.wallet.name';
const SOLANA = 'solana:mainnet';

// Les wallets proposés à l'installation quand aucun n'est trouvé (ou pour en ajouter un).
// Leurs logos officiels (public/brand/wallets, ceux des paquets @solana/wallet-adapter).
const SUGGESTED = [
  { name: 'Phantom', icon: '/brand/wallets/phantom.svg', url: 'https://phantom.com/download', deep: (u) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: 'Solflare', icon: '/brand/wallets/solflare.svg', url: 'https://solflare.com/download', deep: (u) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: 'Backpack', icon: '/brand/wallets/backpack.png', url: 'https://backpack.app/download' },
];
const logoOf = (w) => w.icon || SUGGESTED.find((s) => s.name === w.name)?.icon || null;
const logo = (w, size) => (logoOf(w)
  ? `<img src="${esc(logoOf(w))}" alt="" width="${size}" height="${size}">`
  : `<span class="wm-ico">${esc((w.name || '?')[0])}</span>`);

// ------------------------------------------------------------ découverte (Wallet Standard)
const found = new Set();
const listeners = new Set();
const api = Object.freeze({
  register(...wallets) {
    for (const w of wallets) found.add(w);
    listeners.forEach((fn) => fn());
    return () => { for (const w of wallets) found.delete(w); listeners.forEach((fn) => fn()); };
  },
});
if (typeof window !== 'undefined') {
  window.addEventListener('wallet-standard:register-wallet', (e) => { try { e.detail(api); } catch { /* wallet cassé */ } });
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  } catch { /* très vieux navigateur */ }
}

const canSolana = (w) => (w.chains || []).some((c) => c.startsWith('solana:'))
  && w.features?.['standard:connect'] && w.features?.['solana:signTransaction'];

export function wallets() {
  const list = [...found].filter(canSolana);
  // Un même wallet peut s'annoncer deux fois : on garde le premier de chaque nom.
  return list.filter((w, i) => list.findIndex((x) => x.name === w.name) === i);
}

// Les wallets s'annoncent parfois un peu après le chargement de la page.
function settled(ms = 600) {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------ la session
let session = null;           // { wallet, account, address }
const changes = new Set();
export const current = () => session;
export const onChange = (fn) => { changes.add(fn); return () => changes.delete(fn); };
function emit() { changes.forEach((fn) => { try { fn(session); } catch { /* */ } }); render(); }

function remember(name) { try { name ? localStorage.setItem(STORE, name) : localStorage.removeItem(STORE); } catch { /* */ } }
function remembered() { try { return localStorage.getItem(STORE); } catch { return null; } }

let unwatch = null;
function bind(wallet, account) {
  unwatch?.();
  session = { wallet, account, address: account.address, name: wallet.name, icon: logoOf(wallet) };
  try {
    localStorage.setItem('wick.wallet', account.address);   // pour « Your flames »
  } catch { /* */ }
  // Le wallet change de compte ou se déconnecte de son côté.
  const events = wallet.features['standard:events'];
  if (events) {
    unwatch = events.on('change', ({ accounts }) => {
      if (!accounts) return;
      const next = accounts.find((a) => (a.chains || [SOLANA]).some((c) => c.startsWith('solana:')));
      if (next) bind(wallet, next); else { session = null; emit(); }
    });
  }
  emit();
}

async function connectTo(wallet, silent = false) {
  const res = await wallet.features['standard:connect'].connect(silent ? { silent: true } : undefined);
  const accounts = res?.accounts?.length ? res.accounts : wallet.accounts;
  const account = accounts?.find((a) => (a.chains || [SOLANA]).some((c) => c.startsWith('solana:')));
  if (!account) throw Object.assign(new Error('no_account'), { code: 'no_connect' });
  remember(wallet.name);
  bind(wallet, account);
  return session;
}

export async function disconnect() {
  const w = session?.wallet;
  unwatch?.();
  unwatch = null;
  session = null;
  remember(null);
  try { await w?.features['standard:disconnect']?.disconnect(); } catch { /* */ }
  emit();
}

// Au retour sur le site : on se reconnecte sans fenêtre au wallet déjà autorisé.
export async function restore() {
  const name = remembered();
  if (!name) return null;
  let w = wallets().find((x) => x.name === name);
  if (!w) { await settled(); w = wallets().find((x) => x.name === name); }
  if (!w) return null;
  try { return await connectTo(w, true); } catch { return null; }
}

// Signer une transaction (octets sérialisés) avec le wallet connecté. Renvoie les octets signés.
export async function signBytes(bytes) {
  if (!session) throw Object.assign(new Error('not_connected'), { code: 'no_connect' });
  const feature = session.wallet.features['solana:signTransaction'];
  try {
    const [out] = await feature.signTransaction({ account: session.account, transaction: bytes, chain: SOLANA });
    return out.signedTransaction;
  } catch (err) {
    throw Object.assign(new Error('rejected'), { code: 'rejected', cause: err });
  }
}

// ------------------------------------------------------------ la fenêtre de choix
let dialog = null;
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'modal wallet-modal';
  dialog.innerHTML = '<form method="dialog" class="modal-close"><button aria-label="Close">✕</button></form><div class="wm-body"></div>';
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  return dialog;
}

function walletRow(w, i) {
  return `<button class="wm-row" data-i="${i}">
    ${logo(w, 32)}
    <span class="wm-name">${esc(w.name)}</span><span class="wm-tag">Detected</span></button>`;
}

// Ouvre la fenêtre, et renvoie la session une fois connecté (ou null si fermée).
export function choose() {
  const d = ensureDialog();
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    const draw = (error = '') => {
      const list = wallets();
      const names = new Set(list.map((w) => w.name));
      const others = SUGGESTED.filter((s) => !names.has(s.name));
      const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      d.querySelector('.wm-body').innerHTML = `
        <h2>Connect a wallet</h2>
        <p class="muted small">Your keys never leave your wallet. Every transaction shows up there before you sign.</p>
        ${list.length ? `<div class="wm-list">${list.map(walletRow).join('')}</div>` : ''}
        ${others.length ? `<p class="wm-sub">${list.length ? 'More wallets' : mobile ? 'Open WICK in your wallet app' : 'No Solana wallet found. Get one:'}</p>
          <div class="wm-list">${others.map((s) => `<a class="wm-row" href="${esc(mobile && s.deep ? s.deep(location.href) : s.url)}" target="_blank" rel="noopener">
            ${logo(s, 32)}<span class="wm-name">${esc(s.name)}</span><span class="wm-tag dim">${mobile && s.deep ? 'Open' : 'Install'}</span></a>`).join('')}</div>` : ''}
        <p class="error" ${error ? '' : 'hidden'}>${esc(error)}</p>`;
      d.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
        const w = list[Number(b.dataset.i)];
        b.classList.add('busy');
        b.querySelector('.wm-tag').textContent = 'Connecting…';
        try {
          const s = await connectTo(w);
          finish(s);
          d.close();
        } catch {
          draw(`${w.name}: connection cancelled.`);
        }
      }));
    };
    draw();
    const off = (() => { listeners.add(draw); return () => listeners.delete(draw); })();
    d.addEventListener('close', () => { off(); finish(session); }, { once: true });
    if (!d.open) d.showModal();
  });
}

// La session si connecté, sinon la fenêtre de choix.
export async function ensure() {
  if (session) return session;
  return choose();
}

// ------------------------------------------------------------ le bouton en haut du site
let button = null, menuEl = null, actions = {};
export function mountButton(el, { onFlames } = {}) {
  button = el;
  actions = { onFlames };
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!session) { choose(); return; }
    toggleMenu();
  });
  document.addEventListener('click', () => toggleMenu(false));
  render();
}

function toggleMenu(open) {
  if (!menuEl) {
    menuEl = document.createElement('div');
    menuEl.className = 'wallet-menu';
    menuEl.hidden = true;
    document.body.append(menuEl);
    menuEl.addEventListener('click', (e) => e.stopPropagation());
  }
  const show = open ?? menuEl.hidden;
  if (!show || !session) { menuEl.hidden = true; return; }
  const r = button.getBoundingClientRect();
  menuEl.style.top = `${r.bottom + 8}px`;
  menuEl.style.right = `${Math.max(12, innerWidth - r.right)}px`;
  menuEl.innerHTML = `
    <div class="wmn-head">${session.icon ? `<img src="${esc(session.icon)}" alt="" width="28" height="28">` : ''}
      <div><b class="mono">${esc(short(session.address))}</b><small>${esc(session.name)}</small></div></div>
    <button data-a="flames">Your flames</button>
    <button data-a="copy">Copy address</button>
    <a href="https://solscan.io/account/${esc(session.address)}" target="_blank" rel="noopener">View on Solscan ↗</a>
    <button data-a="switch">Change wallet</button>
    <button data-a="out" class="danger">Disconnect</button>`;
  menuEl.hidden = false;
  menuEl.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.a;
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(session.address); b.textContent = 'Copied'; } catch { b.textContent = session.address; }
      return;
    }
    menuEl.hidden = true;
    if (a === 'flames') actions.onFlames?.(session.address);
    if (a === 'switch') { await disconnect(); choose(); }
    if (a === 'out') disconnect();
  }));
}

function render() {
  if (!button) return;
  if (session) {
    button.className = 'wallet-btn connected';
    button.innerHTML = `${session.icon ? `<img src="${esc(session.icon)}" alt="" width="18" height="18">` : '<i></i>'}<span class="mono">${esc(short(session.address))}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  } else {
    button.className = 'wallet-btn';
    button.innerHTML = 'Connect wallet';
    if (menuEl) menuEl.hidden = true;
  }
}
