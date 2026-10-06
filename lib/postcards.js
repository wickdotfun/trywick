// Les cartes de la bibliothèque de posts (lib/posts.js) : une mise en page par post, pour que le fil
// X et le canal Telegram ne montrent jamais deux fois la même image. 1600 × 900, en SVG, dessinées
// d'avance par scripts/cards.mjs (public/cards/post-<id>.png) avec les polices Geist.
//
// Trois fonds : « night » (le noir et l'or de WICK), « ember » (la braise, orange), « paper »
// (le papier crème, encre sombre). assets : { logo, wordmark, ai: { openai, … } } en data: URI.

const W = 1600, H = 900, L = 110, R = W - 110;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = 'M5 12.5 9.5 17 19 7.5';
const ROBOT = '<rect x="5" y="9.5" width="14" height="10" rx="3"/><path d="M9.5 14.5h.01M14.5 14.5h.01M12 9.5V7M12 2.8c.8.9 1.2 1.6 1.2 2.2a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.3 1.2-2.2z"/>';

const THEMES = {
  night: { ink: '#fbf3ea', soft: '#e9dccb', muted: '#b6a797', accent: '#ffc05a', line: 'rgba(255,196,110,0.22)', card: 'rgba(255,220,180,0.045)' },
  ember: { ink: '#1a0b03', soft: '#2b1406', muted: 'rgba(26,11,3,0.72)', accent: '#1a0b03', line: 'rgba(26,11,3,0.28)', card: 'rgba(26,11,3,0.08)' },
  paper: { ink: '#1b0f07', soft: '#3a2617', muted: '#6b5848', accent: '#d4600b', line: 'rgba(27,15,7,0.16)', card: '#ffffff' },
};

function defs() {
  return `<defs>
    <radialGradient id="glow" cx="390" cy="470" r="560" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff8a1c" stop-opacity="0.38"/><stop offset="0.45" stop-color="#b8420a" stop-opacity="0.14"/><stop offset="1" stop-color="#070403" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowc" cx="800" cy="980" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff8a1c" stop-opacity="0.55"/><stop offset="0.5" stop-color="#b8420a" stop-opacity="0.16"/><stop offset="1" stop-color="#070403" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="1450" cy="40" r="620" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffb347" stop-opacity="0.12"/><stop offset="1" stop-color="#070403" stop-opacity="0"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4d2"/><stop offset="0.3" stop-color="#ffd978"/><stop offset="0.62" stop-color="#f1b440"/><stop offset="1" stop-color="#d0821c"/></linearGradient>
    <linearGradient id="fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="0.5" stop-color="#ffa033"/><stop offset="1" stop-color="#f0700f"/></linearGradient>
    <linearGradient id="firedark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f08a1c"/><stop offset="1" stop-color="#c2410c"/></linearGradient>
    <linearGradient id="ember" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc061"/><stop offset="0.35" stop-color="#ff8a1c"/><stop offset="0.75" stop-color="#d9480f"/><stop offset="1" stop-color="#7a1d06"/></linearGradient>
    <radialGradient id="emberhot" cx="1250" cy="200" r="700" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff1c4" stop-opacity="0.55"/><stop offset="1" stop-color="#fff1c4" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M56 0H0V56" fill="none" stroke="rgba(255,200,150,0.045)" stroke-width="1"/></pattern>
    <pattern id="gridp" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M56 0H0V56" fill="none" stroke="rgba(27,15,7,0.05)" stroke-width="1"/></pattern>
    <pattern id="lines" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><path d="M0 0V22" stroke="rgba(26,11,3,0.06)" stroke-width="8"/></pattern>
  </defs>`;
}

function background(theme, glow = 'glow') {
  if (theme === 'ember') {
    return `<rect width="${W}" height="${H}" fill="url(#ember)"/><rect width="${W}" height="${H}" fill="url(#lines)"/><rect width="${W}" height="${H}" fill="url(#emberhot)"/>
      <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="34" fill="none" stroke="rgba(26,11,3,0.3)" stroke-width="2"/>`;
  }
  if (theme === 'paper') {
    return `<rect width="${W}" height="${H}" fill="#f6efe5"/><rect width="${W}" height="${H}" fill="url(#gridp)"/>
      <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="34" fill="none" stroke="rgba(27,15,7,0.14)" stroke-width="2"/>`;
  }
  return `<rect width="${W}" height="${H}" fill="#070403"/><rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#${glow})"/><rect width="${W}" height="${H}" fill="url(#glow2)"/>
    <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="34" fill="none" stroke="rgba(255,196,110,0.22)" stroke-width="2"/>`;
}

// Le nom WICK en haut : l'image (blanche) sur les fonds sombres, le texte sur le papier.
function brand(theme, a, x = R - 250, y = 78) {
  if (theme === 'paper' || !a.wordmark) {
    return `<text x="${x + 250}" y="${y + 50}" text-anchor="end" font-family="Geist" font-weight="900" font-size="54" letter-spacing="2" fill="${THEMES[theme].ink}">WICK</text>`;
  }
  return `<image x="${x}" y="${y}" width="250" height="62" xlink:href="${a.wordmark}" href="${a.wordmark}"/>`;
}

function footer(theme, right = 'Every coin gets an agent.') {
  const t = THEMES[theme];
  return `<line x1="${L}" y1="770" x2="${R}" y2="770" stroke="${t.line}" stroke-width="2"/>
    <text x="${L}" y="822" font-family="Geist Mono" font-weight="500" font-size="30" fill="${t.accent}">trywick.fun</text>
    <text x="${R}" y="822" text-anchor="end" font-family="Geist" font-weight="500" font-size="30" fill="${t.muted}">${esc(right)}</text>`;
}

const eyebrow = (theme, x, y, text, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Geist Mono" font-weight="500" font-size="28" letter-spacing="6" fill="${THEMES[theme].accent}">${esc(text)}</text>`;
const text = (x, y, size, weight, fill, s, extra = '') => `<text x="${x}" y="${y}" font-family="Geist" font-weight="${weight}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;
const check = (x, y, r = 16, fill = 'url(#gold)', stroke = '#1d1003') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/><path d="${CHECK}" transform="translate(${x - 12} ${y - 12})" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

function svg(theme, body, glow) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs()}${background(theme, glow)}${body}</svg>`;
}

// ------------------------------------------------------------------ les mises en page
const LAYOUTS = {
  // Une phrase, au centre, en très grand.
  teaser: (d, a) => svg('night', `
    ${a.wordmark ? `<image x="${W / 2 - 150}" y="96" width="300" height="74" xlink:href="${a.wordmark}" href="${a.wordmark}"/>` : ''}
    <text x="${W / 2}" y="420" text-anchor="middle" font-family="Geist" font-weight="900" font-size="150" letter-spacing="-3" fill="#fbf3ea">Every coin</text>
    <text x="${W / 2}" y="580" text-anchor="middle" font-family="Geist" font-weight="900" font-size="150" letter-spacing="-3" fill="url(#fire)">gets an agent.</text>
    <g transform="translate(${W / 2 - 180} 650)"><rect width="360" height="66" rx="33" fill="rgba(255,190,90,0.08)" stroke="rgba(255,196,110,0.45)" stroke-width="2"/>
      <circle cx="40" cy="33" r="9" fill="#3ddc84"/><text x="196" y="44" text-anchor="middle" font-family="Geist Mono" font-weight="500" font-size="28" letter-spacing="6" fill="#ffc05a">COMING SOON</text></g>
    ${footer('night', 'Launch on pump.fun.')}`, 'glowc'),

  // L'agent en action : une conversation avec des holders.
  what: (d) => {
    const t = `$${d.ticker || 'WICK'}`;
    const bubble = (x, y, w, lines, me) => `<g transform="translate(${x} ${y})">
      <rect width="${w}" height="${30 + lines.length * 40}" rx="24" fill="${me ? '#2b1d13' : 'rgba(255,190,90,0.12)'}" stroke="${me ? 'none' : 'rgba(255,196,110,0.4)'}" stroke-width="2"/>
      ${lines.map((l, i) => text(26, 50 + i * 40, 28, 500, me ? '#e9dccb' : '#fbf3ea', l)).join('')}</g>`;
    return svg('paper', `
      ${brand('paper', {})}
      ${eyebrow('paper', L, 250, 'MEET WICK')}
      ${text(L - 4, 380, 112, 900, '#1b0f07', 'Your coin.', 'letter-spacing="-3"')}
      ${text(L - 4, 500, 112, 900, 'url(#firedark)', 'Its agent.', 'letter-spacing="-3"')}
      ${text(L, 580, 34, 500, '#5b4636', 'Launch on pump.fun.')}
      ${text(L, 628, 34, 500, '#5b4636', 'It talks, posts and burns for you.')}
      <g transform="translate(820 150)">
        <rect width="670" height="590" rx="38" fill="#120a06"/>
        <g transform="translate(36 34)"><rect width="56" height="56" rx="16" fill="url(#gold)"/><g transform="translate(10 9) scale(1.5)" fill="none" stroke="#1d1003" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ROBOT}</g></g>
        ${text(110, 62, 30, 700, '#fbf3ea', '$FROG agent')}
        <text x="110" y="94" font-family="Geist Mono" font-weight="500" font-size="22" fill="#b6a797">Analyst · gpt-oss 120B</text>
        <circle cx="626" cy="62" r="9" fill="#3ddc84"/>
        <line x1="0" y1="124" x2="670" y2="124" stroke="rgba(255,196,110,0.16)" stroke-width="2"/>
        ${bubble(360, 152, 274, ['wen burn?'], true)}
        ${bubble(36, 236, 560, ['Burned 1.2M $FROG today:', '3.4% of the supply, gone.', 'Receipt on Solscan.'], false)}
        ${bubble(300, 420, 334, ['what is the plan?'], true)}
        ${bubble(36, 504, 470, ['Burn on every pump.'], false)}
      </g>
      ${footer('paper', `Every launch burns ${t}.`)}`);
  },

  // Les trois étapes, en trois cartes.
  steps: (d, a) => {
    const steps = [['01', 'Create', 'Image, name, ticker.', 'Live on pump.fun.'], ['02', 'Agent', 'Its character, its mind,', 'its objective.'], ['03', 'Burn', 'Its fees buy it back', 'and burn it. Forever.']];
    return svg('night', `
      ${brand('night', a)}
      ${eyebrow('night', L, 160, 'HOW IT WORKS')}
      ${text(L - 3, 240, 70, 900, '#fbf3ea', 'Three steps. Then it runs itself.', 'letter-spacing="-1.5"')}
      ${steps.map(([n, title, l1, l2], i) => {
        const x = L + i * 480;
        return `<g transform="translate(${x} 310)">
          <rect width="420" height="410" rx="30" fill="rgba(255,220,180,0.045)" stroke="${i === 1 ? 'rgba(255,196,110,0.6)' : 'rgba(255,196,110,0.22)'}" stroke-width="2"/>
          <text x="40" y="150" font-family="Geist" font-weight="900" font-size="128" letter-spacing="-4" fill="url(#fire)">${n}</text>
          ${text(42, 250, 52, 700, '#fbf3ea', title)}
          ${text(42, 310, 28, 500, '#cdbfae', l1)}${text(42, 350, 28, 500, '#cdbfae', l2)}
        </g>${i < 2 ? `<path d="M${x + 434} 515l20 0m-8 -10l10 10l-10 10" fill="none" stroke="#ffc05a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}`;
      }).join('')}
      ${footer('night')}`);
  },

  // Où vont les fees : une barre, quatre parts.
  fees: (d, a) => {
    const t = `$${d.ticker || 'WICK'}`;
    const parts = [[60, 'Creator', 'the one who launched it', 'url(#gold)'], [20, 'Its agent', 'its AI, its posts', '#ff8a1c'], [10, `Burns ${t}`, `bought, then burned`, '#d9480f'], [10, 'Team', 'builds WICK', '#8a2f0c']];
    const width = R - L, gap = 8;
    let x = L;
    const bar = parts.map(([pct, , , fill]) => {
      const w = Math.round((width - gap * 3) * pct / 100);
      const g = `<rect x="${x}" y="330" width="${w}" height="150" rx="22" fill="${fill}"/>
        <text x="${x + w / 2}" y="${pct >= 20 ? 432 : 424}" text-anchor="middle" font-family="Geist" font-weight="900" font-size="${pct >= 20 ? 76 : 48}" fill="${pct === 60 ? '#1d1003' : '#fff4e6'}">${pct}%</text>`;
      x += w + gap;
      return g;
    }).join('');
    const legend = parts.map(([pct, label, sub, fill], i) => {
      const lx = L + i * 345;
      return `<g transform="translate(${lx} 560)"><rect width="22" height="22" rx="6" y="-19" fill="${fill}"/>
        ${text(36, 0, 32, 700, '#fbf3ea', `${pct}% ${label}`)}${text(36, 44, 25, 500, '#b6a797', sub)}</g>`;
    }).join('');
    return svg('night', `
      ${brand('night', a)}
      ${eyebrow('night', L, 160, 'WHERE THE FEES GO')}
      ${text(L - 3, 245, 66, 900, '#fbf3ea', 'Locked on-chain. Nobody can change it.', 'letter-spacing="-1.5"')}
      ${bar}${legend}
      ${footer('night', 'Shared with pump.fun fee sharing.')}`);
  },

  // Dix cerveaux, avec leurs logos.
  minds: (d, a) => {
    const minds = [['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['gemini', 'Google'], ['xai', 'xAI'], ['deepseek', 'DeepSeek'], ['qwen', 'Qwen'], ['mistral', 'Mistral'], ['moonshot', 'Moonshot'], ['minimax', 'MiniMax'], ['zai', 'Z.ai']];
    const tiles = minds.map(([key, name], i) => {
      const x = L + (i % 5) * 280, y = 330 + Math.floor(i / 5) * 200;
      const logo = a.ai?.[key];
      return `<g transform="translate(${x} ${y})"><rect width="260" height="180" rx="26" fill="rgba(255,220,180,0.045)" stroke="rgba(255,196,110,0.22)" stroke-width="2"/>
        ${logo ? `<image x="98" y="30" width="64" height="64" xlink:href="${logo}" href="${logo}"/>` : `<circle cx="130" cy="62" r="30" fill="url(#gold)"/>`}
        <text x="130" y="146" text-anchor="middle" font-family="Geist" font-weight="700" font-size="30" fill="#fbf3ea">${esc(name)}</text></g>`;
    }).join('');
    return svg('night', `
      ${brand('night', a)}
      ${eyebrow('night', L, 160, 'PICK ITS MIND')}
      <text x="${L - 3}" y="250" font-family="Geist" font-weight="900" font-size="84" letter-spacing="-2" fill="#fbf3ea">One agent. <tspan fill="url(#fire)">Any mind.</tspan></text>
      ${tiles}
      ${footer('night', 'Hundreds of models. Paid by the coin.')}`);
  },

  // Avant le lancement : la braise, un mot énorme. Jamais l'heure (pas de cadeau aux snipers).
  lastcall: (d, a) => {
    const t = `$${d.ticker || 'WICK'}`;
    return svg('ember', `
      ${a.wordmark ? `<image x="${R - 250}" y="78" width="250" height="62" xlink:href="${a.wordmark}" href="${a.wordmark}"/>` : brand('ember', a)}
      ${eyebrow('ember', L, 200, 'FAIR LAUNCH')}
      ${text(L - 10, 455, 220, 900, '#1a0b03', 'GET READY.', 'letter-spacing="-7"')}
      ${text(L, 560, 56, 700, '#1a0b03', `${t} is coming to pump.fun.`)}
      ${text(L, 630, 36, 500, 'rgba(26,11,3,0.78)', 'No presale. One CA, posted here, pinned on Telegram.')}
      ${footer('ember', 'Every coin gets an agent.')}`);
  },

  // Lance le tien : le site, en vrai.
  open: (d, a) => {
    const t = `$${d.ticker || 'WICK'}`;
    const chip = (x, y, label, on) => `<g transform="translate(${x} ${y})"><rect width="${label.length * 15 + 48}" height="50" rx="25" fill="${on ? 'url(#gold)' : 'rgba(255,220,180,0.06)'}" stroke="${on ? 'none' : 'rgba(255,196,110,0.3)'}" stroke-width="2"/>
      <text x="24" y="33" font-family="Geist" font-weight="${on ? 700 : 500}" font-size="24" fill="${on ? '#1d1003' : '#e9dccb'}">${esc(label)}</text></g>`;
    return svg('night', `
      <g transform="translate(${L + 2} 238)"><circle r="10" fill="#3ddc84"/><circle r="19" fill="none" stroke="rgba(61,220,132,0.4)" stroke-width="3"/></g>
      ${eyebrow('night', L + 38, 248, 'NOW OPEN')}
      ${text(L - 5, 400, 128, 900, 'url(#fire)', 'Launch', 'letter-spacing="-4"')}
      ${text(L - 5, 520, 128, 900, '#fbf3ea', 'yours.', 'letter-spacing="-4"')}
      ${text(L, 590, 32, 500, '#e9dccb', 'Your coin, its own AI agent.')}
      ${text(L, 634, 32, 500, '#e9dccb', `Every launch burns ${t}.`)}
      <g transform="translate(830 130)">
        <rect width="660" height="600" rx="34" fill="#120a06" stroke="rgba(255,196,110,0.3)" stroke-width="2"/>
        <circle cx="36" cy="36" r="8" fill="#ff5f57"/><circle cx="62" cy="36" r="8" fill="#febc2e"/><circle cx="88" cy="36" r="8" fill="#28c840"/>
        <text x="330" y="44" text-anchor="middle" font-family="Geist Mono" font-weight="500" font-size="20" fill="#8c7d6e">trywick.fun</text>
        <line x1="0" y1="72" x2="660" y2="72" stroke="rgba(255,196,110,0.16)" stroke-width="2"/>
        <g transform="translate(40 116)">
          ${check(16, 0, 16)}${text(44, 9, 24, 600, '#b6a797', 'Identity')}
          <line x1="164" y1="0" x2="214" y2="0" stroke="rgba(255,196,110,0.4)" stroke-width="2"/>
          <circle cx="240" cy="0" r="16" fill="#ff8a1c"/><text x="240" y="8" text-anchor="middle" font-family="Geist" font-weight="700" font-size="20" fill="#1d1003">2</text>${text(268, 9, 24, 700, '#fbf3ea', 'Its agent')}
          <line x1="400" y1="0" x2="450" y2="0" stroke="rgba(255,196,110,0.25)" stroke-width="2"/>
          <circle cx="476" cy="0" r="16" fill="none" stroke="rgba(255,196,110,0.4)" stroke-width="2"/><text x="476" y="8" text-anchor="middle" font-family="Geist" font-weight="700" font-size="20" fill="#8c7d6e">3</text>${text(504, 9, 24, 500, '#8c7d6e', 'Launch')}
        </g>
        ${text(40, 200, 22, 500, '#b6a797', 'CHARACTER', 'letter-spacing="3"')}
        ${chip(40, 220, 'Analyst', true)}${chip(200, 220, 'Degen', false)}${chip(338, 220, 'Stoic', false)}${chip(470, 220, 'Builder', false)}
        ${text(40, 326, 22, 500, '#b6a797', 'MIND', 'letter-spacing="3"')}
        ${chip(40, 346, 'gpt-oss', false)}${chip(203, 346, 'Claude', true)}${chip(350, 346, 'Kimi K2', false)}
        ${text(40, 452, 22, 500, '#b6a797', 'OBJECTIVE', 'letter-spacing="3"')}
        <rect x="40" y="470" width="580" height="54" rx="14" fill="rgba(255,220,180,0.05)" stroke="rgba(255,196,110,0.25)" stroke-width="2"/>
        ${text(60, 505, 24, 500, '#e9dccb', 'Grow holders, burn on every pump.')}
      </g>
      ${footer('night')}`);
  },

  // Le circuit : un lancement → la fee → le rachat → le burn.
  burn: (d, a) => {
    const t = `$${d.ticker || 'WICK'}`;
    const nodes = [['Launch', 'a coin on WICK'], ['Ignition Fee', '0.01 SOL'], [`Buys ${t}`, 'half of the fee'], ['Burned', 'forever, on Solscan']];
    return svg('night', `
      ${brand('night', a)}
      ${eyebrow('night', L, 160, 'EVERY LAUNCH')}
      <text x="${L - 3}" y="250" font-family="Geist" font-weight="900" font-size="84" letter-spacing="-2" fill="#fbf3ea">Every launch burns <tspan fill="url(#fire)">${esc(t)}.</tspan></text>
      ${nodes.map(([title, sub], i) => {
        const x = L + i * 360, last = i === nodes.length - 1; // 4 × 300 + 3 × 60 = 1380
        return `<g transform="translate(${x} 340)"><rect width="300" height="230" rx="30" fill="${last ? 'url(#fire)' : 'rgba(255,220,180,0.045)'}" stroke="${last ? 'none' : 'rgba(255,196,110,0.25)'}" stroke-width="2"/>
          <text x="34" y="78" font-family="Geist Mono" font-weight="500" font-size="26" fill="${last ? '#3a1503' : '#ffc05a'}">0${i + 1}</text>
          ${text(34, 150, 38, 800, last ? '#1d1003' : '#fbf3ea', title)}${text(34, 196, 25, 500, last ? '#3a1503' : '#b6a797', sub)}</g>
          ${last ? '' : `<path d="M${x + 312} 455h38m-12 -12l12 12l-12 12" fill="none" stroke="#ffc05a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`}`;
      }).join('')}
      ${text(L, 668, 38, 500, '#e9dccb', `More launches, less ${t}.`)}
      ${footer('night', 'Every receipt: trywick.fun/#proof')}`);
  },

  // Proof : un ticket de caisse.
  proof: () => {
    const rows = ['Wallets', 'Fee rules', 'Every SOL', 'Every burn + tx', 'Open source', 'CSV export'];
    return svg('paper', `
      ${eyebrow('paper', L, 250, 'PROOF')}
      ${text(L - 4, 385, 120, 900, '#1b0f07', 'Don’t trust.', 'letter-spacing="-3"')}
      ${text(L - 4, 510, 120, 900, 'url(#firedark)', 'Verify.', 'letter-spacing="-3"')}
      ${text(L, 590, 34, 500, '#5b4636', 'Every wallet, every fee, every burn,')}
      ${text(L, 638, 34, 500, '#5b4636', 'with its transaction on Solana.')}
      <g transform="translate(940 92)">
        <rect x="10" y="14" width="520" height="640" rx="6" fill="rgba(27,15,7,0.12)"/>
        <path d="M0 0h520v620${Array.from({ length: 13 }, () => 'l-20 16-20-16').join('')}Z" fill="#fffaf3"/>
        <text x="260" y="78" text-anchor="middle" font-family="Geist Mono" font-weight="500" font-size="32" letter-spacing="6" fill="#1b0f07">WICK · PROOF</text>
        <line x1="40" y1="112" x2="480" y2="112" stroke="#1b0f07" stroke-width="2" stroke-dasharray="8 8" opacity="0.4"/>
        ${rows.map((r, i) => `<text x="44" y="${172 + i * 64}" font-family="Geist Mono" font-weight="500" font-size="28" fill="#3a2617">${esc(r)}</text>${check(462, 162 + i * 64, 15, '#1f9d55', '#ffffff')}`).join('')}
        <line x1="40" y1="548" x2="480" y2="548" stroke="#1b0f07" stroke-width="2" stroke-dasharray="8 8" opacity="0.4"/>
        <text x="44" y="598" font-family="Geist Mono" font-weight="500" font-size="28" fill="#1b0f07">TRUST NEEDED</text>
        <text x="476" y="598" text-anchor="end" font-family="Geist Mono" font-weight="500" font-size="28" fill="#d4600b">0</text>
      </g>
      ${footer('paper', 'trywick.fun/#proof')}`);
  },
};

export const hasPostLayout = (id) => Boolean(LAYOUTS[id]);
export function postSvg(id, data = {}, assets = {}) {
  return LAYOUTS[id](data, assets);
}
