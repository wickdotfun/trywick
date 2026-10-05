// La bibliothèque de posts de la page d'admin : tout ce qu'il faut publier, avant, pendant et après
// le lancement, prêt d'avance. Chaque post a sa carte (dessinée par scripts/cards.mjs dans
// public/cards/post-<id>.png, avec le modèle de lib/cards.js), son texte pour X, et ce qu'il faut
// savoir pour le poster (en français : c'est pour le propriétaire du site).
//
// Dans les textes : {ticker} et {site} sont remplacés ; une fois $WICK lancé, les posts « after »
// finissent par son CA.

export const LIBRARY = [
  // ---------------------------------------------------------------- avant le lancement
  {
    id: 'teaser', phase: 'before', label: 'Teaser',
    when: "Quelques jours ou quelques heures avant : on annonce l'idée, sans date.",
    card: { eyebrow: 'COMING SOON', title: 'WICK', sub: 'Every coin gets an agent.', chips: ['Launch on pump.fun', 'Its own AI', 'Burns ${ticker}'], icon: 'agent' },
    text: 'every coin deserves someone working for it.\n\nWICK: launch a coin on pump.fun, and it gets its own AI agent.\n\nsoon.\n{site}',
  },
  {
    id: 'what', phase: 'before', label: "C'est quoi WICK",
    when: "Le post qui explique tout. À épingler sur ton profil X avant le lancement.",
    card: { eyebrow: 'MEET WICK', title: 'ITS AGENT', sub: 'Launch a coin. It gets its own AI.', chips: ['Talks to holders', 'Posts for you', 'Burns supply'], icon: 'agent' },
    text: 'what is WICK?\n\nyou launch a coin on pump.fun from {site_short}.\nit gets its own AI agent: it answers holders, keeps a public journal, posts for the coin and burns its supply.\n\nits own fees pay for it.',
  },
  {
    id: 'steps', phase: 'before', label: 'Comment ça marche',
    when: 'Les 3 étapes. Bon à poster la veille, puis à repartager après le lancement.',
    card: { eyebrow: 'HOW IT WORKS', title: '3 STEPS', sub: 'Create it. Give it an agent. Let it burn.', chips: ['1 · Create', '2 · Agent', '3 · Burn'], icon: 'check' },
    text: 'how WICK works:\n\n1. create your coin: image, name, ticker. live on pump.fun.\n2. give it an agent: its character, its mind, its objective.\n3. let it burn: a share of its fees buys it back and burns it.\n\nevery launch also burns ${ticker}.',
  },
  {
    id: 'fees', phase: 'before', label: 'Où vont les fees',
    when: 'La transparence : ce que touche chacun. Rassure les acheteurs.',
    card: { eyebrow: 'WHERE THE FEES GO', title: '60/20/10/10', sub: 'Locked on-chain. Nobody can change it.', chips: ['60% creator', '20% its agent', '10% burns ${ticker}'], icon: 'lock' },
    text: 'where the fees go on WICK, locked on-chain:\n\n60% the creator\n20% its agent (its AI, its posts)\n10% buys ${ticker} and burns it\n10% the team\n\nnobody can change it. not even us.',
  },
  {
    id: 'minds', phase: 'before', label: 'Les cerveaux des agents',
    when: "Montre le choix d'IA : un bon post pour attirer les curieux.",
    card: { eyebrow: 'PICK ITS MIND', title: '10 AI MINDS', sub: 'One provider per agent. Choose well.', chips: ['OpenAI', 'Anthropic', 'xAI', 'DeepSeek'], icon: 'agent' },
    text: 'every agent on WICK picks its mind:\n\nOpenAI · Anthropic · Google · xAI · DeepSeek · Qwen · Mistral · Moonshot · MiniMax · Z.ai\n\none mind per agent. choose well.',
  },
  {
    id: 'tonight', phase: 'before', label: 'Lancement ce soir',
    when: "Le jour J, quelques heures avant. Prévient que le seul CA sera posté ici et épinglé sur Telegram.",
    card: { eyebrow: 'TONIGHT', title: '${ticker}', sub: 'Launching tonight on pump.fun.', chips: ['One official CA', 'Pinned on Telegram'], icon: 'live' },
    text: '${ticker} launches tonight on pump.fun.\n\nthe only CA will be posted here and pinned on telegram. ignore everything else.\n\n{site}',
  },
  // ---------------------------------------------------------------- après le lancement
  {
    id: 'open', phase: 'after', label: 'Lance ton coin',
    when: "Juste après le lancement de $WICK, puis souvent : c'est l'appel à créer des coins.",
    card: { eyebrow: 'NOW OPEN', title: 'LAUNCH YOURS', sub: 'Your coin gets an agent in 3 steps.', chips: ['pump.fun', 'Its own AI', 'Burns ${ticker}'], icon: 'live' },
    text: 'WICK is open.\n\nlaunch your coin, give it an agent, let it burn.\nevery launch buys ${ticker} and burns it.\n\n{site}',
  },
  {
    id: 'burn', phase: 'after', label: 'Chaque lancement brûle $WICK',
    when: 'Le mécanisme de $WICK en une phrase. À reposter quand les burns tombent.',
    card: { eyebrow: 'EVERY LAUNCH', title: '${ticker} BURNS', sub: 'Every launch buys ${ticker} and burns it.', chips: ['Buyback', 'Burn', 'On Solscan'], icon: 'live' },
    text: 'every coin launched on WICK buys ${ticker} and burns it.\n\nmore launches, less ${ticker}.\n\nreceipts: {site}/#proof',
  },
  {
    id: 'proof', phase: 'after', label: 'Page Proof',
    when: 'Quand on doute de toi : tout est vérifiable, transaction par transaction.',
    card: { eyebrow: 'PROOF', title: 'VERIFY', sub: 'Every wallet, every fee, every burn.', chips: ['On-chain', 'Open source', 'Every receipt'], icon: 'check' },
    text: "don't trust, verify.\n\nevery wallet, every fee rule, every SOL and every burn of WICK, with its transaction:\n{site}/#proof\n\nthe code is open source.",
  },
];

export const libraryFile = (id) => `post-${id}.png`;
export const libraryPost = (id) => LIBRARY.find((p) => p.id === id) || null;

const fill = (s, { ticker = 'WICK', site = 'https://trywick.fun' }) => String(s)
  .replaceAll('${ticker}', `$${ticker}`)
  .replaceAll('{site_short}', site.replace(/^https?:\/\//, '').replace(/\/$/, ''))
  .replaceAll('{site}', site.replace(/\/$/, ''));

// La carte d'un post, ses textes remplis. mint : le CA de $WICK, une fois lancé.
export function libraryCard(p, opts = {}) {
  return { ...p.card, title: fill(p.card.title, opts), sub: fill(p.card.sub, opts), chips: p.card.chips.map((c) => fill(c, opts)) };
}
export function libraryText(p, { mint = null, ...opts } = {}) {
  const text = fill(p.text, opts);
  return p.phase === 'after' && mint ? `${text}\n\nCA: ${mint}` : text;
}
