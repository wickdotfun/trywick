// La bibliothèque de posts de la page d'admin : tout ce qu'il faut publier autour du lancement de
// $WICK, prêt d'avance, dans l'ordre. Chaque post a sa carte (sa propre mise en page :
// lib/postcards.js, dessinée par scripts/cards.mjs dans public/cards/post-<id>.png), son texte
// pour X (le même part sur Telegram), et ce qu'il faut savoir pour le poster (en français : c'est
// pour le propriétaire du site).
//
// Les posts commencent environ 3 heures avant le lancement (H-3) : slot dit quand. Le premier est la
// vidéo de lancement (public/cards/wick-intro.mp4, son image : post-intro.png).
// Dans les textes : ${ticker}, {site} et {site_short} sont remplacés ; une fois $WICK lancé, les
// posts « after » finissent par son CA.

export const LIBRARY = [
  // ---------------------------------------------------------------- avant le lancement
  {
    id: 'intro', slot: 'H-3 · à épingler', phase: 'before', label: 'La vidéo de lancement',
    video: 'wick-intro.mp4',
    when: 'Le tout premier post : la vidéo qui présente WICK (47 s, avec musique). Épingle-la sur ton profil X.',
    text: 'meet WICK.\n\nlaunch a coin on pump.fun and it gets its own AI agent. it talks to holders, posts for the coin and burns its own supply.\n\nany AI model. paid by the coin itself.\n\n{site}',
  },
  {
    id: 'what', slot: 'H-2h30', phase: 'before', label: "C'est quoi WICK",
    when: 'Le post qui explique tout. Épingle-le sur ton profil X.',
    text: 'what is WICK?\n\nyou launch a coin on pump.fun from {site_short}.\nit gets its own AI agent: it answers holders, keeps a public journal, posts for the coin and burns its supply.\n\nits own fees pay for it.',
  },
  {
    id: 'steps', slot: 'H-2', phase: 'before', label: 'Comment ça marche',
    when: 'Les 3 étapes, pour que chacun sache quoi faire au lancement.',
    text: 'how WICK works:\n\n1. create your coin: image, name, ticker. live on pump.fun.\n2. give it an agent: its character, its mind (any AI model), its objective.\n3. let it burn: a share of its fees buys it back and burns it.\n\nevery launch also burns ${ticker}.',
  },
  {
    id: 'fees', slot: 'H-1h30', phase: 'before', label: 'Où vont les fees',
    when: 'La transparence : ce que touche chacun. Ça rassure les acheteurs.',
    text: 'where the fees go on WICK, locked on-chain:\n\n60% the creator\n20% its agent (its AI, its posts)\n10% buys ${ticker} and burns it\n10% the team\n\nnobody can change it. not even us.',
  },
  {
    id: 'minds', slot: 'H-1', phase: 'before', label: 'Les cerveaux des agents',
    when: "N'importe quelle IA, payée par le coin : le post qui donne envie d'essayer.",
    text: 'every agent on WICK picks its mind: any of hundreds of AI models.\n\nClaude · GPT · Gemini · Grok · DeepSeek · Qwen · Kimi · GLM · Mistral · MiniMax\n\npaid by the coin itself: its fuel at launch, then its own fees.\n{site}/#models',
  },
  {
    id: 'lastcall', slot: 'H-30 min', phase: 'before', label: 'Tenez-vous prêts',
    when: "Juste avant de lancer, sans jamais donner l'heure (sinon les snipers se préparent) : le seul CA sera posté ici et épinglé sur Telegram.",
    text: '${ticker} is coming to pump.fun.\n\nfair launch: no presale, no whitelist.\nthe only CA will be posted here and pinned on telegram. ignore everything else.\n\nturn on notifications.\n{site}',
  },
  // ---------------------------------------------------------------- après le lancement
  {
    id: 'open', slot: 'H+30 min', phase: 'after', label: 'Lance ton coin',
    when: "L'appel aux créateurs : à reposter souvent les premiers jours.",
    text: 'WICK is open.\n\nlaunch a coin in 3 steps, pick its agent, let it burn.\nthe agent answers holders and burns supply, paid by its own fees.\n\nevery launch buys ${ticker} and burns it.\n\n{site}',
  },
  {
    id: 'howtobuy', slot: 'H+1', phase: 'after', label: 'Comment acheter',
    when: 'Pour les nouveaux : les 3 gestes pour acheter, avec le CA (ajouté tout seul). Rassure contre les faux CA.',
    text: 'how to buy ${ticker}:\n\n1. get phantom and a little SOL\n2. open pump.fun and paste the CA below\n3. buy. that\'s it.\n\nonly trust the CA posted by this account.',
  },
  {
    id: 'agent', slot: 'H+1h30', phase: 'after', label: "Ce que fait l'agent",
    when: "Explique concrètement ce que fait un agent : c'est ce qui rend WICK différent.",
    text: 'what does a WICK agent actually do?\n\n· answers holders, day and night\n· keeps a public journal\n· posts for its coin\n· picks when to buy back and burn\n\nevery word, every burn: public.\n{site}',
  },
  {
    id: 'burn', slot: 'H+2', phase: 'after', label: 'Comment $WICK brûle',
    when: 'Le mécanisme de $WICK, étape par étape. À reposter quand les burns tombent.',
    text: 'how ${ticker} burns:\n\n1. someone launches a coin on WICK\n2. half its ignition fee buys ${ticker}\n3. it gets burned, on-chain\n\nmore launches, less ${ticker}.\nevery receipt: {site}/#proof',
  },
  {
    id: 'why', slot: 'H+3', phase: 'after', label: 'Pourquoi WICK',
    when: "Le problème que WICK règle : la plupart des coins meurent dans le silence. Bon post pour faire réagir.",
    text: 'most pump.fun coins die in silence: no updates, nobody answers, the chart bleeds.\n\na coin on WICK gets an agent that never sleeps. it talks to holders, posts, and burns its supply with its own fees.\n\n{site}',
  },
  {
    id: 'creator', slot: 'H+4', phase: 'after', label: 'Pour les créateurs',
    when: 'Le post pour donner envie de lancer son coin sur WICK : les créateurs gardent 60 % de leurs fees.',
    text: 'creators: launch on WICK and keep 60% of your creator fees.\n\n20% pays your coin\'s AI agent\n10% buys ${ticker} and burns it\n10% the team\n\nlocked on pump.fun. nobody can change it, not even us.\n{site}',
  },
  {
    id: 'safe', slot: 'H+5', phase: 'after', label: 'Est-ce sûr ?',
    when: "Les réponses aux questions qu'on te posera le plus. À reposter dès que quelqu'un doute.",
    text: 'is WICK safe?\n\n· your wallet signs every launch. we never hold your coin.\n· the fee split is locked on pump.fun.\n· every wallet, fee and burn is public, tx by tx.\n· the code is open source.\n\n{site}/#proof',
  },
  {
    id: 'opensource', slot: 'H+6', phase: 'after', label: 'Open source',
    when: 'Le code est public : le meilleur argument contre « scam ? ». Lien GitHub inclus.',
    text: 'the code is open source.\n\nevery fee rule, every wallet, every buyback: read it yourself.\n\ngithub.com/wickdotfun/trywick',
  },
  {
    id: 'dexsoon', slot: 'Quand tu vas payer le DEX', phase: 'after', label: 'Le DEX arrive',
    when: "À poster seulement si tu vas vraiment payer le profil DEX Screener bientôt : une promesse tenue rassure, une promesse oubliée fait fuir.",
    text: '${ticker} DEX is getting paid.\n\nfull profile on DEX Screener very soon: banner, socials, official links.\n\nlaunched ✓\nsite live ✓\ncode open source ✓\nDEX paid ⏳\n\n{site}',
  },
  {
    id: 'proof', slot: 'Quand on doute', phase: 'after', label: 'Page Proof',
    when: "Dès qu'on te pose une question sur l'argent : tout est vérifiable, transaction par transaction.",
    text: "don't trust us. verify.\n\nevery wallet, every fee rule, every SOL in and out, every burn with its transaction:\n{site}/#proof\n\nthe code is open source.",
  },
];

export const libraryFile = (id) => `post-${id}.png`;
export const libraryPost = (id) => LIBRARY.find((p) => p.id === id) || null;

const fill = (s, { ticker = 'WICK', site = 'https://trywick.fun' }) => String(s)
  .replaceAll('${ticker}', `$${ticker}`)
  .replaceAll('{site_short}', site.replace(/^https?:\/\//, '').replace(/\/$/, ''))
  .replaceAll('{site}', site.replace(/\/$/, ''));

// Le texte d'un post, rempli. mint : le CA de $WICK, une fois lancé.
export function libraryText(p, { mint = null, ...opts } = {}) {
  const text = fill(p.text, opts);
  return p.phase === 'after' && mint ? `${text}\n\nCA: ${mint}` : text;
}
