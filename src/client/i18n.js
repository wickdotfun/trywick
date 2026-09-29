// Tous les textes du site. Le site est uniquement en anglais.
export const T = {
  // Navigation
  tabHome: 'My candle', tabTop: 'Leaderboard', tabCoin: 'The coin', tabHow: 'How it works', tabHowShort: 'Info',
  soon: 'Soon on pump.fun', buy: 'Buy $WICK',
  live: 'live', offline: 'offline',
  disclaimer: 'WICK is a meme and a game. Not financial advice. No promises, just a flame.',
  footMeta: 'no wallet · no account · built in public',

  // Home
  heroEyebrow: 'A candle for everyone · wired to $WICK',
  heroTitle: 'Adopt your candle.',
  heroLead: 'Strike a match, get your own little candle. Feed it twice a day and watch it grow: when $WICK goes up, every candle grows faster. Forget it and it goes out for good.',
  hey: 'Hey,', introMine: 'Welcome back', introOut: 'Your candle went out',
  status: {
    hungry: 'Your candle is hungry. Feed it now, before it goes out.',
    ready: 'It can eat again. Feed it to keep it bright.',
    wait: (t) => `All good. Next meal in ${t}.`,
    boost: (b, t) => `$WICK is pumping: it grows ×${b} faster right now.${t ? ` Next meal in ${t}.` : ' Feed it!'}`,
    dead: (t) => `It burned for ${t}. Light a new one: new look, fresh start.`,
  },
  worldTitle: 'The world right now',
  kpiAlive: 'Candles lit', kpiDied: 'Went out · 24h', kpiBorn: 'Born · 24h', kpiRecord: 'Longest life',

  // The stage
  hudMine: 'Your candle', hudOther: 'Candle', hudMatch: 'Your match',
  notLit: 'Not lit yet',
  moods: { euphorie: 'euphoric', content: 'happy', calme: 'bored', stress: 'nervous', panique: 'scared' },
  mood: 'Mood', out: 'out', hungry: 'hungry', asleep: 'asleep',
  growthChip: (b) => `growth ×${b}`,
  actions: {
    light: ['Strike the match', 'your candle is born right away'],
    relight: ['Light a new candle', 'new look, starts from zero'],
    nourrir: ['Feed', '+30 wax'],
    photo: ['Photo', 'to share'],
    back: ['My candle', 'back to mine'],
    adopt: ['Light yours', 'free, no wallet'],
  },
  again: (t) => `in ${t}`,
  thoughtTag: 'thinking out loud',
  poke: ['Hey! That tickles!', 'Easy, I\'m made of wax!', 'Yes yes, I see you.', 'One more time and I melt.', 'Want a picture?', 'Hands off the wick!'],

  // Your candle
  pMine: 'Your candle', pVitals: 'Vitals',
  wax: 'wax', age: 'age', lived: 'lived', burnout: 'burnout', meltTitle: 'melt', growthTitle: 'growth', feedsTitle: 'meals', genTitle: 'generation',
  melt: (n) => `-${n} / h`,
  noneText: 'You don\'t have a candle yet. Strike the match: it\'s born with 70 wax and its own look, and keeping it alive is up to you.',
  haveOne: 'I already have a candle',
  miniSteps: [
    ['Strike the match', 'it\'s born with its own look'],
    ['Feed it', 'every 4h at most, twice a day'],
    ['Watch it grow', 'torch in 7 days, Hall of Fame forever'],
  ],
  hintLit: (h) => `It melts a little every hour. Without care, out in ~${h}.`,
  hintHungry: 'It\'s hungry! Feed it fast or it will go out.',
  hintBoost: (b) => `$WICK is going up: it grows ×${b} faster right now!`,
  hintScared: 'The chart is going down and it\'s a little scared… but that never makes it melt. Come say hi.',
  hintDead: 'It rests in the graveyard. You can light a new one: new look, starting from zero.',
  deadAfter: (t) => `Went out after ${t}`,

  // Look
  traits: {
    wax: 'Wax', flame: 'Flame',
    waxes: { ivoire: 'ivory', creme: 'cream', rose: 'pink', menthe: 'mint', lavande: 'lavender', ciel: 'sky', peche: 'peach', ardoise: 'slate', or: 'gold' },
    flames: { orange: 'orange', ambre: 'amber', rose: 'pink', bleue: 'blue', verte: 'green', violette: 'purple', blanche: 'white', eternelle: 'eternal' },
    accessories: { noeud: 'Bow tie', lunettes: 'Glasses', echarpe: 'Scarf', fleur: 'Flower' },
  },

  // Profile of a candle (#/b/12)
  pf: {
    eyebrow: (id) => `Candle #${id}`,
    alive: (t) => `Alive · ${t}`, out: (t) => `Went out after ${t}`,
    rank: (r) => `#${r} oldest flame`,
    age: 'Age', lived: 'Lived', meals: 'Meals', lit: 'Candles lit', torches: 'Torches', born: 'Born',
    story: 'Story', noStory: 'Nothing recorded yet. A quiet candle.',
    adopt: 'Adopt your own candle', back: 'Back to my candle',
    ev: {
      born: 'Was lit', nourrir: 'Got fed', evolved: (s) => `Became a ${s}`,
      died: (t) => `Went out after ${t}`, reward: (r) => `Won the weekly reward (#${r})`,
    },
    ago: (t) => `${t} ago`,
  },

  // Evolution
  pEvo: 'Evolution',
  stages: { allumette: 'Match', bougie: 'Candle', chandelle: 'Taper', chandelier: 'Candlestick', torche: 'Torch' },
  stageAge: { allumette: 'before', bougie: 'D0', chandelle: '≤ D1', chandelier: '≤ D3', torche: '≤ D7' },
  hallBadge: 'Hall of Fame', eternalBadge: 'Eternal flame',
  nextIn: (s, t) => `${s} in ${t}`, finalForm: 'final form',

  // Oldest flames
  pTop: 'Oldest flames', seeTop: 'See the full leaderboard',
  you: 'you', aliveNow: (n) => `${n} lit`, died24: (n) => `${n} went out in 24h`,
  emptyTop: 'No candles yet. Be the first.',

  // Live log
  feedTitle: 'Live log',
  feed: {
    born: (w, g) => (g > 1 ? `${w} lit a new candle (#${g})` : `${w} lit their candle`),
    nourrir: 'fed their candle',
    evolved: (w, s) => (s === 'Torch' ? `${w} became a Torch and entered the Hall of Fame` : `${w} became a ${s}`),
    reward: (w, r) => `${w} won this week's reward (#${r})`,
    died: (w, t) => `${w} went out after ${t}`,
  },
  empty: 'Nothing yet. Light the first candle.',

  // Weekly reward
  pReward: 'Weekly reward',
  rewardLine: (share) => `Every Sunday 20:00 UTC, ${share} of $WICK creator fees goes to the 3 oldest living candles.`,
  rewardPool: (p) => `This week's pool: ${p}`,
  rewardNext: (t) => `next draw in ${t}`,
  rewardEmpty: 'No eligible candle yet. Add your payout address to enter.',
  rewardYouRank: (r) => `You're #${r} in the running`,
  rewardNoAddress: 'Your candle isn\'t entered yet: add a payout address.',
  rewardAdd: 'Add payout address', rewardEdit: 'Change',
  rewardNeedCandle: 'Light a candle to enter.',
  lastWinners: 'Last winners', paid: 'paid', pending: 'payout pending',
  payoutTitle: 'Your payout address',
  payoutText: 'If your candle is one of the 3 oldest living candles at the Sunday draw, the reward is sent here. Paste a Solana wallet address.',
  payoutWarn: 'Public address ONLY. Never paste a private key or a seed phrase. WICK will never ask for them.',
  payoutSave: 'Save address', payoutRemove: 'Remove address', payoutSaved: 'Payout address saved',
  payoutBad: 'That doesn\'t look like a Solana address.',
  payoutTaken: 'This address is already used by another player. One address per player.',
  payoutTerms: 'Rewards are sent manually by the dev from creator fees. Amounts vary and the program may change or stop. No purchase needed. Not financial advice.',

  // Hall of Fame
  hallTitle: 'Hall of Fame', hallLead: 'Every candle that ever became a torch. Forever.', hallEmpty: 'No torch yet. Be the first legend.',

  // Leaderboard
  topEyebrow: 'Leaderboard', topTitle: 'The oldest flames',
  topLead: 'The candles that last the longest. A forgotten candle goes out and joins the graveyard.',
  recordTitle: 'Longest life', recordAlive: 'still burning', recordDead: 'went out',
  aliveTitle: 'Alive', graveTitle: 'The graveyard', graveEmpty: 'Nobody in the graveyard. Yet.',

  // Sharing
  shareAlive: (n, age, st) => `My candle "${n}" is ${age} old and already a ${st.toLowerCase()} 🕯️\nLight yours on WICK $WICK:`,
  shareDead: (n, age) => `RIP "${n}", my candle went out after ${age} 🕯️💀\nLight yours and do better:`,

  // Photo
  photoTitle: 'Your candle\'s photo', photoWait: 'Click-clack…',
  photoText: 'Your candle as it looks right now. Post it, show off its look.',
  photoShare: 'Share', photoX: 'Post on X', photoCopy: 'Copy image', photoSave: 'Download',
  photoTipMobile: 'Tip: "Share" sends the image straight to X, Telegram or Instagram.',
  photoTipDesktop: 'Tip: copy the image, click "Post on X", then paste it into your post (Ctrl+V).',
  cardTagline: 'adopt your candle · $WICK',

  // Flame phrase
  meTitle: 'Your candle', myPhrase: 'My flame phrase', otherDevice: 'Recover my candle',
  welcomeEyebrow: 'Your candle is born', welcomeText: 'Come back and feed it at least once a day: if its wax hits zero, it goes out for good. When $WICK goes up, it grows faster.',
  phraseTitle: 'Your flame phrase',
  phraseText: 'Write these 12 words down. It\'s the only way to get your candle back on another device or if your browser gets wiped.',
  notSeed: 'This is NOT a wallet seed. WICK will never ask for your wallet seed: never type it here.',
  copy: 'Copy', copied: 'Copied!', noted: 'Got it', show: 'Show', hide: 'Hide',
  noPhraseHere: 'Your phrase isn\'t stored on this device. If you wrote it down, keep it safe.',
  forget: 'Forget my candle on this device',
  forgetConfirm: 'Without your flame phrase you won\'t be able to get your candle back. Continue?',
  recoverTitle: 'Recover your candle', recoverText: 'Type or paste your 12 flame words, in order.',
  recoverBtn: 'Recover my candle', recoverCount: (n) => `${n} / 12 words`,
  recoverBad: (w) => `Unknown word: ${w}`, recoverOk: 'Valid phrase ✓',
  recoverErr: { unknown_phrase: 'No candle matches this phrase.', bad_phrase: 'Invalid phrase.', too_many: 'Too many tries, try again in 15 minutes.' },
  welcomeBack: (n) => `Welcome back, ${n}!`,
  error: 'Oops, try again.',
  notFound: 'This candle doesn\'t exist.',

  // Ticker
  tkAlive: 'lit', tkDied: 'out 24h', tkBorn: 'born 24h', tkOldest: 'oldest', tkMood: 'mood', tkSoon: 'soon on pump.fun', tkLast: 'last',

  // The coin
  coinEyebrow: 'The coin', coinSoonTitle: '$WICK is not live yet',
  coinSoonText: 'On launch day on pump.fun, its live chart will show up here, and every candle will grow faster when it goes up. Until then, candles follow SOL.',
  coinFollow: 'Follow WICK on X', coinSolTitle: 'Meanwhile: SOL',
  officialWarn: 'The only official $WICK address is the one shown on this site. Beware of copies.',
  price: 'Price', mcap: 'Market cap', vol: '24h volume', liq: 'Liquidity', ch1h: '1h', ch24h: '24h',
  ca: 'Contract address', buyPump: 'Buy on pump.fun', dexs: 'DexScreener', solscan: 'Solscan', birdeye: 'Birdeye',
  chartTitle: 'Live chart',

  // How it works
  howEyebrow: 'How it works', howTitle: 'A candle of your own.',
  howLead: 'Everyone adopts their own little candle. Keeping it alive and making it grow is up to you.',
  steps: [
    ['Strike the match', 'Your candle is born in one click, with a name and its own look: wax color, flame color, sometimes an accessory. Free, no wallet.'],
    ['Keep it alive', 'It melts a little every hour. Feed it (every 4h at most): come by at least twice a day. Left alone too long, it goes out for good and joins the graveyard.'],
    ['The chart makes it grow', 'When $WICK goes up, every candle grows faster (×1.5, then ×2). When it goes down they get a bit scared, but it never makes them melt.'],
    ['Win the week', 'Every Sunday, part of $WICK creator fees goes to the 3 oldest living candles. Reach the torch (7 days) and you enter the Hall of Fame forever, and your next candles get the eternal flame.'],
  ],
  stepHall: ['Become a legend', 'Reach the torch (7 days) and your candle enters the Hall of Fame forever, and your next candles are born with the eternal flame.'],
  evoTitle: 'It grows with time (and the chart)',
  faqTitle: 'Questions',
  faq: [
    ['Do I need to connect a wallet?', 'No, never. Everything is free and walletless. Your candle is tied to your browser, plus a 12-word phrase to get it back elsewhere.'],
    ['What is the flame phrase?', '12 words generated for you, to recover your candle on another device. None of them can appear in a wallet seed: it gives access to no money.'],
    ['What happens if it goes out?', 'It joins the graveyard with its lifetime. You can light a new one whenever you want, with a new look, but it starts from zero.'],
    ['What\'s the link with $WICK?', 'The site is the coin\'s showcase: when $WICK goes up, every candle grows faster. You can play without buying. It is not an investment and there are no promises.'],
    ['How does the weekly reward work?', 'Every Sunday at 20:00 UTC, the 3 oldest living candles whose owner added a Solana payout address win a share of $WICK creator fees, sent manually by the dev. The payment proof is shown on the leaderboard. No purchase needed; amounts vary and the program may change or stop.'],
    ['What do I get for a torch?', 'Your candle enters the Hall of Fame forever, even after it goes out, and all your next candles are born with the eternal flame (gold).'],
    ['Is my candle worth anything?', 'No. It is not an NFT and can\'t be bought or sold. Its look is just for style.'],
    ['Who\'s behind it?', 'A solo builder improving it in public, on X.'],
  ],

  // Demo
  demoTag: 'Demo', demoText: 'Simulated, sped-up world: nothing here is real.', demoExit: 'Exit demo', demoSpeed: 'speed',
};
