// Mode démo (?demo) : un monde simulé et accéléré, entièrement dans le navigateur.
// Un souffle (buyback) toutes les 90 secondes, chaque allumette l'avance de 6 secondes et brûle
// un peu de $WICK, une bougie = 0,05 % de la supply (pour la voir fondre en quelques minutes),
// et un lancement factice (pas de wallet).
import { CONFIG } from '../../lib/config.js';
import { burnedPct, crossed, missions, usd } from '../../lib/missions.js';
import { cycleProgress, supplyCandle } from '../../lib/candle.js';

const WORDS = ['Moon', 'Wax', 'Ember', 'Pepe', 'Moth', 'Cat', 'Dog', 'Frog', 'Spark', 'Flare', 'Torch', 'Smoke',
  'Ash', 'Burn', 'Lit', 'Glow', 'Fuse', 'Blaze', 'Melt', 'Drip', 'Sol', 'Bonk', 'Goblin', 'Chad', 'Based', 'Tiny'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const key = () => Array.from({ length: 44 }, () => pick(B58)).join('');
const SUPPLY = 1_000_000_000;
const STEP = 0.05;
const FEE = 0.02;
const SHARED_FEE = 0.01;
const WICK_PER_SOL = 400_000;
// Les Operators de la démo : des personnalités, des esprits, et ce qu'ils disent.
const KEEPER_STYLES = [['stoic', 'Stoic', 'Calm, patient, few words'], ['degen', 'Degen', 'Loud, fast, all conviction'],
  ['poet', 'Poet', 'Every burn is a verse'], ['pyro', 'Pyromaniac', 'Loves the fire a bit too much'], ['analyst', 'Analyst', 'Numbers first, no hype'],
  ['builder', 'Builder', 'Plans, ships, reports'], ['guardian', 'Guardian', 'Watches over the holders'], ['custom', 'Custom', 'Write its character']];
const KEEPER_GOALS = Object.entries(CONFIG.keepers.goals).map(([id, g]) => ({ id, label: g.label, hint: g.hint }));
const KEEPER_MODELS = [['llama', 'Llama 3.3 70B', 'Meta', 'meta'], ['gpt-oss', 'gpt-oss 120B', 'OpenAI', 'openai'], ['qwen', 'Qwen3 30B', 'Qwen', 'qwen'],
  ['mistral', 'Mistral Small 3.1', 'Mistral', 'mistral'], ['gemma', 'Gemma 3 12B', 'Google', 'gemma'], ['deepseek', 'DeepSeek R1 32B', 'DeepSeek', 'deepseek']];
const seed = (k) => [...k].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const logoOf = (f) => `/brand/ai/${f}.svg`;
const HELLOS = {
  stoic: 'I keep the candle of $SYM. I watch, I speak when it matters.',
  degen: '$SYM operator online. I see everything. We are so early.',
  poet: 'A new wick, a new flame. I will tend $SYM through every night.',
  pyro: 'They gave me $SYM. I love it already. Look at that flame.',
  analyst: '$SYM Operator online. I track the numbers and report them, nothing more.',
  builder: 'Operator of $SYM, reporting for work. Launch done. Next: the kit, then the first burn.',
  guardian: 'I watch over $SYM and the people who hold it. I will always tell you what I see.',
};
const JOURNAL = {
  stoic: ['Volume held steady today. The flame does not need noise.', 'Quiet day. Holders stayed. That says enough.', 'Up, down, up. The wax does not care. Neither do I.'],
  degen: ['chart looking spicy today, holders built different', 'new wallets showing up every hour. you are early ser', 'paper hands left, diamond hands stayed. we move'],
  poet: ['Another day, another inch of wax turned to light.', 'The market sighed, the candle did not flinch.', 'Morning smoke, evening gold. The flame keeps time.'],
  pyro: ['I counted every trade today. Every one of them smelled like smoke.', 'So much volume. So much fuel. I am thriving.', 'Today was warm. Tomorrow will be warmer. I promise nothing, I just love fire.'],
  analyst: ['24h: volume up, sells down, fees set aside for the next burn. Data, not hype.', 'Buyers outnumbered sellers two to one today. Noted.', 'Supply burned so far is on this page, down to the token. Check it yourself.'],
  builder: ['Done today: tracked the market, set the fees aside. Next: the next burn.', 'Kit is out. Telegram is linked. Shipping the next milestone.', 'Small progress, every day. That is the whole plan.'],
  guardian: ['Quiet day. Nobody panicked. I am proud of this room.', 'Dips happen. The burns keep going. Stay safe, check every link.', 'Reminder: I will never DM you. The only CA is on this page.'],
};
const ABOUTS = [
  '{n} was born in the wax and raised by the flame. Every trade keeps it lit.',
  '{n}: a tiny legend that refuses to go out. Its Operator watches every candle.',
  'The internet asked for {n}. The candle answered. Its Operator does the rest.',
  '{n} lives where the fire is warmest. Holders keep it burning.',
];
const ANSWERS = {
  stoic: ['I watch the fees gather and I burn when the moment is right. Patience is the whole strategy.', 'The numbers are on this page, all of them on-chain. I do not guess at price, I tend the flame.', 'I answer to the candle, not to the chart. Ask me about the burns.'],
  degen: ['ser I literally burn the supply with the fees. no promises, just fire', 'look at the burns table, every single one on Solscan. we are so back', 'not financial advice but the candle is getting shorter and I love that'],
  poet: ['I tend the wax; the market tends itself. Each burn is a line I write in smoke.', 'Ask the flame and it will tell you: nothing lasts, except what burns well.', 'The story is short: born on WICK, it burns a little brighter every day.'],
  pyro: ['Every SOL that comes in, I turn into smoke. It is the best part of my day.', 'I cannot change the amounts, only the moment. And the moment is always soon.', 'Did someone say burn? I was just thinking about burning.'],
  analyst: ['Facts: a fixed share of creator fees buys back and burns. Every burn is on Solscan. I do not predict price.', 'The burns table on this page is the full record. I report it, I do not spin it.', 'Ask me for a number and I will give you the number.'],
  builder: ['Here is the plan: track the market, burn on schedule, post every milestone. Then repeat.', 'What I shipped is in the Activity tab, every line of it.', 'Next milestone is in the Missions tab. That is what I am working on.'],
  guardian: ['I hold no funds and I can only burn. You are safe from me, at least.', 'I cannot promise price. I can promise I will tell you everything I see.', 'Stay careful out there. The only real CA is on this page.'],
};
const VOICES = {
  stoic: ['It dipped 14%. A fair price for the flame.', 'Quiet hours. The wax waits for no one.', 'Volume is up. I take my share of the fire.'],
  degen: ['dip spotted. fed the candle, we eat', 'paper hands sold, I bought it and BURNED it', 'supply goes down, conviction goes up. lfg'],
  poet: ['Wax to smoke, the candle shortens by a breath.', 'A red hour, a golden flame. Burned.', 'The night was slow. I fed the fire anyway.'],
  pyro: ['MORE FIRE. it was right there, I had to.', 'oh it burns so nicely today', 'they sold. I lit it. everyone wins (the fire wins)'],
  analyst: ['Burned on a 12% dip. Best entry of the day.', 'Fees reached the threshold. Burned. Supply down again.', 'Burn executed. Numbers in the table.'],
  builder: ['Burn shipped. On to the next one.', 'Fees in, coin bought, coin burned. Done.', 'Another burn, right on schedule.'],
  guardian: ['Burned for the holders. Every one of you.', 'A little less supply, a little more for those who stayed.', 'Burned. The room is safe, the candle is lit.'],
};
const WAITS = { stoic: 'Not yet. The market is calm, I let the wax gather.', degen: 'holding my fire for the next dip, ser',
  poet: 'I wait. The flame is patient, and so am I.', pyro: 'waiting is SO hard. but a dip is coming. I can feel it.',
  analyst: 'Not yet. Volume is thin, a burn now would move little.', builder: 'Holding the fees for now. The next burn is scheduled.', guardian: 'I hold the fire for now. No rush, the holders come first.' };
// Un Custom parle comme son créateur l'a écrit ; la démo lui prête la voix du Stoic.
const say = (table, style) => table[style] || table.stoic;

export function createDemo() {
  const timing = { durationMs: 90_000, matchMs: 6_000 };
  const creators = Array.from({ length: 9 }, key);
  const all = [];
  const burns = [];
  const history = [];
  const hall = [];
  const coinBurns = [];      // « Make it burn » : les coins qui se brûlent eux-mêmes
  let seq = 0;
  let pot = 0.42;
  let burned = 0;
  let breath = { number: 18, startedAt: Date.now() - 40_000, matches: 0 };

  function burn(kind, ref, sol, symbol) {
    const amount = Math.round(sol * WICK_PER_SOL * (0.85 + Math.random() * 0.3));
    burned += amount;
    const b = { kind, ref: String(ref), at: Date.now(), burned: amount, sol, sig: null, symbol };
    // The Wick, le Operator de la grande bougie, commente chaque buyback.
    if (kind === 'candle') b.voice = pick(['Breath taken. The great candle grows shorter.', 'Every launch fed this one. Burned.', 'The wax remembers every coin. Gone, now.']);
    burns.unshift(b);
    // Une bougie entière a fondu : elle rejoint la salle.
    const consumed = supplyCandle((burned / SUPPLY) * 100, STEP).consumed;
    while (hall.length < consumed) {
      const since = hall[0]?.completedAt ?? 0;
      const during = all.filter((m) => m.at > since);
      const top = [...during].sort((a, z) => (z.mcap || 0) - (a.mcap || 0))[0];
      hall.unshift({
        number: hall.length + 1, startedAt: since, completedAt: Date.now(), launches: during.length || 3 + Math.floor(Math.random() * 9),
        burned: SUPPLY * STEP / 100, pct: (hall.length + 1) * STEP, top: top ? { mint: top.mint, symbol: top.symbol, mcap: top.mcap } : null,
        sol: Math.round((SUPPLY * STEP / 100 / WICK_PER_SOL) * 100) / 100, burns: 4 + Math.floor(Math.random() * 30), sig: null,
      });
    }
    return b;
  }

  function makeKeeper(m, style = pick(KEEPER_STYLES.slice(0, -1))[0], model = pick(KEEPER_MODELS)[0], goal = null, prompt = null) {
    const s = KEEPER_STYLES.find((x) => x[0] === style) || KEEPER_STYLES[0];
    const mm = KEEPER_MODELS.find((x) => x[0] === model) || KEEPER_MODELS[0];
    const g = CONFIG.keepers.goals[goal] ? goal : pick(Object.keys(CONFIG.keepers.goals));
    return { style: s[0], label: s[1], model: mm[1], by: mm[2], logo: logoOf(mm[3]), goal: g, prompt: s[0] === 'custom' ? prompt || null : null,
      intro: say(HELLOS, s[0]).replace('$SYM', `$${m.symbol}`), thought: null, thoughtAt: null };
  }

  function make(at, extra = {}) {
    const a = pick(WORDS), b = pick(WORDS.filter((w) => w !== a));
    const symbol = (Math.random() < 0.5 ? a + b : a).toUpperCase().slice(0, 8);
    const mcap = Math.random() < 0.15 ? null : Math.round(4000 * Math.exp(Math.random() * 5.5));
    const m = {
      seq: ++seq, mint: key(), creator: pick(creators), name: `${a} ${b}`, symbol, image: null,
      devBuy: Math.random() < 0.5 ? 0 : Math.round(Math.random() * 20) / 10, at,
      holder: Math.random() < 0.18, mcap, change: mcap ? Math.round((Math.random() - 0.35) * 160) : null, burned: null,
      volume: mcap ? Math.round(mcap * (0.2 + Math.random() * 1.5)) : null, sig: null, fee: null,
      share: Math.random() < 0.65 ? { bps: 1000, teamBps: 500, live: true } : null,
      candle: null,
      ...extra,
    };
    // Chaque coin a son Operator ; la plupart des coins qui partagent ont choisi « Make it burn ».
    m.keeper ||= makeKeeper(m);
    m.description ||= pick(ABOUTS).replace('{n}', m.name);
    if (m.share && m.candle === null && !extra.share && Math.random() < 0.8) {
      m.candle = { bps: pick([1000, 2000, 2000, 3000, 5000]), burned: 0, pct: 0, sol: 0, burns: 0, live: true, keeper: m.keeper };
    }
    // Ses premiers mots, un peu après son lancement.
    setTimeout(() => { if (!m.keeper.thought) Object.assign(m.keeper, { thought: m.keeper.intro, thoughtAt: Date.now() }); }, 4000 + Math.random() * 5000);
    all.push(m);
    breath.matches++;
    pot += 0.01 + Math.random() * 0.02;     // les creator fees qui coulent
    // Son frais de lancement est brûlé quelques secondes plus tard.
    m.fee = m.share ? SHARED_FEE : FEE;
    m.burnFee = m.fee / 2;   // 50 % burn, 50 % équipe
    setTimeout(() => { m.burned = burn('match', m.mint, m.burnFee - 0.0005, m.symbol).burned; }, 2500 + Math.random() * 3000);
    return m;
  }

  // Un passé : quelques buybacks, des burns de lancement, une bougie consumée.
  for (let n = 12; n <= 17; n++) {
    const sol = Math.round((0.3 + Math.random() * 0.9) * 100) / 100;
    const b = burn('candle', n, sol);
    b.at = Date.now() - (18 - n) * 95_000;
    history.unshift({ number: n, endedAt: b.at, matches: 4 + Math.floor(Math.random() * 9), status: 'burned', buySol: sol, buySig: null, burnSig: null, burned: b.burned });
  }
  for (let i = 0; i < 14; i++) {
    const m = make(Date.now() - (14 - i) * 25_000);
    m.burned = burn('match', m.mint, m.burnFee - 0.0005, m.symbol).burned;
    burns[0].at = m.at + 3000;
  }
  burns.sort((a, b) => b.at - a.at);
  breath.matches = 3;

  // Une bougie de coin fond : ses fees le rachètent et le brûlent.
  function coinBurn(m, at = Date.now()) {
    const share = (0.002 + Math.random() * 0.012) * (m.candle.bps / 2000);
    const amount = Math.round(SUPPLY * share * (1 - m.candle.pct / 100));
    const sol = Math.round((0.05 + Math.random() * 0.6) * (m.candle.bps / 2000) * 1000) / 1000;
    m.candle.burned += amount;
    m.candle.pct = (m.candle.burned / SUPPLY) * 100;
    m.candle.sol += sol;
    m.candle.burns++;
    const k = m.candle.keeper;
    // Jamais deux fois la même phrase d'affilée pour un même Operator.
    const voice = k ? pick(say(VOICES, k.style).filter((v) => v !== k.thought)) : null;
    if (k) Object.assign(k, { thought: Math.random() < 0.3 ? say(WAITS, k.style) : voice, thoughtAt: at });
    const b = { mint: m.mint, symbol: m.symbol, image: m.image, at, burned: amount, sol, sig: null, voice };
    coinBurns.unshift(b);
    return b;
  }
  // Un passé : les plus anciennes bougies ont déjà bien fondu.
  for (const m of all.filter((x) => x.candle)) {
    const n = 2 + Math.floor(Math.random() * 10);
    for (let k = 0; k < n; k++) coinBurn(m, Date.now() - 6 * 3600_000 + Math.random() * 6 * 3600_000 - 60_000);
  }
  coinBurns.sort((a, b) => b.at - a.at);
  setInterval(() => {
    const lit = all.filter((m) => m.candle && m.mcap);
    if (lit.length) coinBurn(pick(lit));
  }, 11000);
  // Le journal des Operators : une ligne de temps en temps, dans le fil.
  const journal = () => {
    const alive = all.filter((m) => m.keeper && m.mcap);
    if (!alive.length) return;
    const m = pick(alive);
    m.keeper.thought = pick(say(JOURNAL, m.keeper.style).filter((l) => l !== m.keeper.thought));
    m.keeper.thoughtAt = Date.now();
  };
  for (let i = 0; i < 4; i++) { journal(); const m = all.find((x) => x.keeper?.thoughtAt && !x.keeper.seeded); if (m) { m.keeper.seeded = true; m.keeper.thoughtAt -= (i + 1) * 900_000; } }
  setInterval(journal, 9000);
  const candleTotals = () => {
    const lit = all.filter((m) => m.candle);
    return { candles: lit.length, candleBurns: lit.reduce((n, m) => n + m.candle.burns, 0), candleSol: lit.reduce((n, m) => n + m.candle.sol, 0) };
  };

  // Le souffle s'achève : faux buyback, puis le suivant.
  function tick() {
    const now = Date.now();
    if (!cycleProgress(breath, now, timing).done) return;
    const ended = { number: breath.number, endedAt: now, matches: breath.matches, status: 'buying', buySol: Math.round(pot * 100) / 100 };
    history.unshift(ended);
    const sol = ended.buySol;
    setTimeout(() => {
      const b = burn('candle', ended.number, sol);
      Object.assign(ended, { status: 'burned', burned: b.burned });
    }, 5_000);
    pot = 0.05;
    breath = { number: breath.number + 1, startedAt: now, matches: 0 };
  }
  setInterval(tick, 500);

  (function arrive() {
    tick();
    make(Date.now());
    setTimeout(arrive, 2500 + Math.random() * 4000);
  })();

  // Les marchés bougent un peu.
  setInterval(() => {
    for (const m of all) {
      if (!m.mcap || Math.random() > 0.3) continue;
      m.mcap = Math.max(3000, Math.round(m.mcap * (0.8 + Math.random() * 0.5)));
      m.change = Math.round((m.change ?? 0) + (Math.random() - 0.45) * 30);
    }
  }, 8000);

  const pub = (m) => ({ ...m });

  // L'Operator d'un coin (comme lib/operator.js) : sa Constitution et son journal d'actions.
  function operatorOf(m, burnsOf) {
    const k = m.keeper;
    const fmtN = (n) => Math.round(n).toLocaleString('en-US');
    // Les coins de départ de la démo ont des burns « passés » : leur lancement les précède.
    const t0 = Math.min(m.at, ...burnsOf.map((b) => b.at - 600_000));
    const log = [
      { at: t0, kind: 'launched', title: `Launched $${m.symbol} on pump.fun`, detail: `Operator summoned: ${k.label} on ${k.model}.` },
      ...(m.candle ? [{ at: t0 + 2000, kind: 'sealed', title: `Locked ${m.candle.bps / 100}% of creator fees to burn $${m.symbol}`, detail: 'Set with pump.fun fee sharing at launch. Nobody can change it.' }] : []),
      ...(m.burned ? [{ at: t0 + 4000, kind: 'fed', title: `Fed the $WICK candle: ${fmtN(m.burned)} $WICK burned`, detail: 'Half of its Ignition Fee bought $WICK and burned it.' }] : []),
      { at: t0 + 6000, kind: 'intro', title: 'First words', detail: k.intro },
      ...burnsOf.map((b) => ({ at: b.at, kind: 'burned', title: `Burned ${fmtN(b.burned)} $${m.symbol}`, detail: `${b.sol} SOL of its creator fees.${b.voice ? ` “${b.voice}”` : ''}` })),
      ...(k.thought && k.thought !== k.intro && !burnsOf.some((b) => b.voice === k.thought)
        ? [{ at: k.thoughtAt, kind: say(WAITS, k.style) === k.thought ? 'wait' : 'journal', title: say(WAITS, k.style) === k.thought ? 'Held the fire, waiting for a better moment' : 'Journal', detail: k.thought }] : []),
    ];
    // Ses paliers (les mêmes règles que lib/track.js) et ses missions (lib/missions.js).
    const row = {
      symbol: m.symbol, self_bps: m.candle?.bps || 0, self_burned: m.candle?.burned || 0, self_burns: m.candle?.burns || 0,
      self_sol: m.candle?.sol || 0, keeper_goal: k.goal, self_pending: m.candle ? Math.round((seed(m.mint) % 9) * 1e6) : 0, mcap: m.mcap, lit_at: t0,
    };
    row.op_mcap = crossed(CONFIG.operator.mcapSteps, m.mcap) || 0;
    row.op_burn = crossed(CONFIG.operator.burnSteps, burnedPct(row)) || 0;
    const lastBurn = burnsOf[0]?.at;
    // Son kit de lancement (le vrai est écrit par l'IA : lib/kit.js).
    const sym = `$${m.symbol}`;
    const burnL = m.candle ? `${m.candle.bps / 100}% of its creator fees buy it back and burn it, forever.` : 'Launched on WICK, where every coin is a candle.';
    const voice = { stoic: 'The candle is lit. I will keep it.', degen: 'we are so early it hurts. the candle is lit.', poet: 'A new wick, a new flame, a new story in the wax.', pyro: 'It burns. I love it. Look at it burn.' }[k.style] || '';
    const kit = {
      lore: `${m.description} ${sym} was launched on WICK with its own AI Operator, ${k.label}, running on ${k.model}.`,
      x: [`${sym} is live on pump.fun. ${burnL}\n\nCA: ${m.mint}`, `${voice} ${m.name}: ${m.description}`, `${sym} has its own AI Operator. Every action is public: the launch, its journal, every burn. Watch it work.`],
      telegram: `${sym} is live.\n\n${m.description}\n\n${burnL}\n\nCA: ${m.mint}`,
      ai: true, at: t0 + 8000,
    };
    log.push({ at: t0 + 8000, kind: 'kit', title: 'Prepared the launch kit', detail: `3 X posts, a Telegram post and the lore of ${sym}.` });
    if (row.op_mcap) log.push({ at: Math.min(Date.now(), t0 + 45 * 60_000), kind: 'milestone', title: `Reached a ${usd(row.op_mcap)} market cap`, detail: `$${m.symbol} trades at a ${usd(m.mcap)} market cap.` });
    if (row.op_burn && lastBurn) log.push({ at: lastBurn + 1, kind: 'milestone', title: `${row.op_burn}% of the $${m.symbol} supply burned`, detail: `${row.self_burns} burns, ${row.self_sol.toFixed(3)} SOL of its creator fees.` });
    log.sort((a, b) => b.at - a.at);
    for (const e of log) e.sig = null;
    return {
      log,
      missions: missions({ ...row, op_groups: seed(m.mint) % 3 }, log, Date.now()),
      kit,
      telegram: { bot: 'WickFireBot', groups: seed(m.mint) % 3 },
      constitution: {
        personality: k.label, mind: { name: k.model, by: k.by, logo: k.logo }, character: k.prompt || null,
        objective: CONFIG.keepers.goals[k.goal] ? { label: CONFIG.keepers.goals[k.goal].label, hint: CONFIG.keepers.goals[k.goal].hint } : null,
        burn: m.candle ? { pct: m.candle.bps / 100, wickPct: 5, teamPct: 5 } : null, proof: null,
        rules: m.candle
          ? ['Decides at most once every 1 hour', 'Burns at least every 24 hours when there is something to burn', 'Burns at once past 0.25 SOL', `Can only buy back $${m.symbol} and burn it`]
          : ['Talks to holders, writes its journal', 'Holds no funds'],
        canSell: false, canMoveFunds: false, locked: true,
      },
    };
  }

  return {
    demo: true,
    async state(since = 0, markets = false) {
      tick();
      const now = Date.now();
      const full = !(since > 0);
      const candle = { ...supplyCandle((burned / SUPPLY) * 100, STEP), startedAt: hall[0]?.completedAt ?? 0 };
      const p = cycleProgress(breath, now, timing);
      const inOrbit = all.filter((m) => m.at > candle.startedAt);
      return {
        now,
        total: seq,
        heat: all.filter((m) => m.at > now - 30_000).length * 2,
        candle,
        breath: { ...breath, ...timing, melted: p.melted, endsAt: p.endsAt },
        matches: inOrbit.filter((m) => m.seq > since).map(pub),
        history: history.slice(0, 12).map((h) => ({ ...h })),
        totals: {
          burned, supplyPct: (burned / SUPPLY) * 100,
          buybacks: burns.filter((b) => b.kind === 'candle').length, matchBurns: burns.filter((b) => b.kind === 'match').length,
          sol: burns.reduce((n, b) => n + b.sol, 0), launches: seq, ignitionSol: all.reduce((n, m) => n + (m.fee || 0), 0),
          ignitionBurnSol: all.reduce((n, m) => n + (m.fee || 0) / 2, 0), ignitionTeamSol: all.reduce((n, m) => n + (m.fee || 0) / 2, 0),
          teamSharedSol: all.filter((m) => m.share).reduce((n, m) => n + (m.volume || 0) / 180 * 0.0005, 0),
          sharedSol: all.filter((m) => m.share).reduce((n, m) => n + (m.volume || 0) / 180 * 0.0005, 0), sharingCoins: all.filter((m) => m.share).length,
          volume24h: all.reduce((n, m) => n + (m.volume || 0), 0), supply: { original: SUPPLY, current: SUPPLY - burned },
          ...candleTotals(),
          lastLaunch: all.length ? { mint: all.at(-1).mint, symbol: all.at(-1).symbol, at: all.at(-1).at, sig: null } : null,
        },
        burns: { full, list: (full ? burns : burns.slice(0, 20)).map((b) => ({ ...b })) },
        coinBurns: coinBurns.slice(0, full ? 30 : 10).map((b) => ({ ...b })),
        thoughts: all.filter((m) => m.keeper?.thought && m.keeper.thoughtAt > now - 86_400_000)
          .sort((a, b) => b.keeper.thoughtAt - a.keeper.thoughtAt).slice(0, 8)
          .map((m) => ({ mint: m.mint, symbol: m.symbol, image: m.image, holder: m.holder, line: m.keeper.thought, at: m.keeper.thoughtAt, keeper: { ...m.keeper } })),
        hall: hall.map((h) => ({ ...h })),
        recent: full ? all.slice(-30).reverse().map(pub) : null,
        hot: all.filter((m) => m.mcap && m.at > now - 86_400_000).sort((a, b) => b.mcap - a.mcap).slice(0, 5).map(pub),
        markets: full || markets ? inOrbit.filter((m) => m.mcap).map((m) => ({ mint: m.mint, mcap: m.mcap, change: m.change })) : null,
        buyback: { live: true, paused: false, potSol: pot, wallet: null },
        token: { mint: null, ticker: 'WICK', x: null, telegram: null },
        launch: {
          maxDevBuy: 5, feeSol: FEE, burnSol: FEE / 2, teamSol: FEE / 2,
          sharedFeeSol: SHARED_FEE, sharedBurnSol: SHARED_FEE / 2, sharedTeamSol: SHARED_FEE / 2,
          shareBps: 1000, split: { creatorBps: 9000, burnBps: 500, teamBps: 500 }, selfOptions: [1000, 2000, 3000, 5000],
          keepers: {
            styles: KEEPER_STYLES.map(([id, label, hint]) => ({ id, label, hint })),
            models: KEEPER_MODELS.map(([id, name, by, f]) => ({ id, name, by, logo: logoOf(f) })),
            goals: KEEPER_GOALS, customMax: CONFIG.keepers.customMax,
          },
        },
      };
    },
    async leaderboard() {
      const by = new Map();
      for (const m of all) {
        const r = by.get(m.creator) || { creator: m.creator, launches: 0, burned: 0, holder: false, best: null };
        r.launches++;
        r.burned += m.burned || 0;
        r.holder ||= m.holder;
        if (m.mcap && (!r.best || m.mcap > r.best.mcap)) r.best = { mint: m.mint, symbol: m.symbol, mcap: m.mcap };
        by.set(m.creator, r);
      }
      const titles = [[25, 'Pyromaniac'], [10, 'Arsonist'], [3, 'Firestarter'], [1, 'Spark']];
      const rows = [...by.values()].sort((a, b) => b.burned - a.burned || b.launches - a.launches)
        .map((r, i) => ({ ...r, rank: i + 1, title: titles.find(([n]) => r.launches >= n)[1] }));
      return { pyromaniacs: rows };
    },
    async launches(sort = 'trending', offset = 0) {
      const now = Date.now();
      const by = {
        trending: (a, b) => (b.volume || 0) - (a.volume || 0),
        new: (a, b) => b.seq - a.seq,
        volume: (a, b) => (b.volume || 0) - (a.volume || 0),
        burner: (a, b) => (b.burned || 0) - (a.burned || 0),
        candles: (a, b) => (b.candle?.burned || 0) - (a.candle?.burned || 0),
      }[sort] || ((a, b) => b.seq - a.seq);
      const list = all.filter((m) => (sort !== 'trending' || m.at > now - 3 * 86_400_000) && (sort !== 'candles' || m.candle)).sort(by);
      return { sort, coins: list.slice(offset, offset + 30).map(pub), more: list.length > offset + 30 };
    },
    async profile(wallet) {
      const mine = all.filter((m) => m.creator === wallet || (wallet.startsWith('YouDemo') && m.creator === creators[0]));
      const burnedBy = mine.reduce((n, m) => n + (m.burned || 0), 0);
      const p = {
        launches: mine.length, holder: mine.some((m) => m.holder), burned: burnedBy,
        bestMcap: Math.max(0, ...mine.map((m) => m.mcap || 0)), bestVolume: Math.max(0, ...mine.map((m) => m.volume || 0)),
      };
      const ach = [
        ['first', 'flame', 'First Match', 'Launch your first coin', p.launches >= 1],
        ['firestarter', 'zap', 'Firestarter', 'Launch 3 coins', p.launches >= 3],
        ['arsonist', 'flame', 'Arsonist', 'Launch 10 coins', p.launches >= 10],
        ['burn100k', 'candle', 'Burned 100K $WICK', 'Your launches burn 100K $WICK', burnedBy >= 100_000],
        ['burn1m', 'mountain', 'Burned 1M $WICK', 'Your launches burn 1M $WICK', burnedBy >= 1_000_000],
        ['golden', 'crown', 'Golden Flame', 'Launch a coin while holding $WICK', p.holder],
        ['busy', 'chart', 'Busy Flame', 'One of your coins trades $10K in a day', p.bestVolume >= 10_000],
        ['viral', 'rocket', 'Viral Flame', 'One of your coins reaches a $100K market cap', p.bestMcap >= 100_000],
      ].map(([id, icon, label, hint, done]) => ({ id, icon, label, hint, done }));
      const titles = [[25, 'Pyromaniac'], [10, 'Arsonist'], [3, 'Firestarter'], [1, 'Spark']];
      return {
        wallet, ...p, volume24h: mine.reduce((n, m) => n + (m.volume || 0), 0), ignitionSol: mine.length * FEE,
        since: mine[0]?.at ?? null, title: p.launches ? titles.find(([n]) => p.launches >= n)[1] : null,
        rank: p.launches ? { rank: 1 + Math.floor(Math.random() * 3), of: creators.length } : null,
        achievements: ach, coins: [...mine].reverse().map(pub),
      };
    },
    // La page $WICK : un faux marché, une fausse courbe, de faux holders.
    async token() {
      const price = 0.0000412 * (1 + burned / SUPPLY);
      const curve = 0.63;
      return {
        mint: 'WicKDemo1111111111111111111111111111111pump',
        market: {
          priceUsd: price, priceSol: price / 180, mcap: price * (SUPPLY - burned), change: { h24: 18.4 },
          volume24h: 182_400, liquidity: null, buys24h: 1840, sells24h: 960, dex: 'pumpfun', pair: 'CurveDemo', url: null, image: null,
        },
        curve: { progress: curve, complete: false, sol: 52.3 },
        supply: SUPPLY - burned,
        holders: [
          { owner: 'CurveDemo111111111111111111111111111111111', amount: 3.2e8, pct: 32, label: 'bonding curve' },
          { owner: 'BuyBackDemo11111111111111111111111111111111', amount: 2.1e7, pct: 2.1, label: 'WICK buyback' },
          ...Array.from({ length: 8 }, (_, i) => ({ owner: creators[i] || key(), amount: 1.8e7 / (i + 1), pct: 1.8 / (i + 1), label: null })),
        ],
      };
    },
    async trade({ onStep }) {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const [step, ms] of [['build', 600], ['sign', 900], ['send', 500], ['confirm', 1200]]) { onStep(step); await wait(ms); }
      return { status: 'ok', signature: null };
    },
    // Le lancement factice : les mêmes étapes que le vrai, sans rien signer.
    async launch({ fields, image, onStep }) {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const [step, ms] of [['upload', 900], ['sign', 1300], ['send', 700], ['confirm', 1600]]) {
        onStep(step);
        await wait(ms);
      }
      const m = make(Date.now(), {
        name: fields.name, symbol: fields.symbol, creator: 'YouDemo1111111111111111111111111111111111111',
        image: image ? URL.createObjectURL(image) : null, devBuy: Number(fields.devBuy) || 0, mcap: null, change: null, holder: false,
        share: fields.share === '1' ? { bps: 1000, teamBps: 500, live: true } : null,
        candle: null,
        keeper: makeKeeper({ symbol: fields.symbol }, fields.keeper_style, fields.keeper_model, fields.keeper_goal, fields.keeper_prompt),
        description: fields.description || null,
      });
      if (Number(fields.burn) > 0) {
        m.candle = { bps: Number(fields.burn) * 100, burned: 0, pct: 0, sol: 0, burns: 0, live: true, keeper: m.keeper };
      }
      return { match: pub(m), signature: null };
    },
    // Spark : le Operator invente le coin à partir d'une idée (ici, sans IA : des mots de l'idée).
    async spark({ idea, style = 'stoic', model = 'llama', surprise = false }) {
      await new Promise((r) => setTimeout(r, 1400));
      const text = String(idea || '').trim() || (surprise ? pick(['A frog who runs a candle factory', 'The last ember of a burned-down casino', 'A tiny dragon who only breathes birthday candles']) : '');
      if (text.length < 3) throw Object.assign(new Error('bad_idea'), { code: 'bad_idea' });
      const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length > 2);
      const main = (words.sort((a, b) => b.length - a.length)[0] || pick(WORDS)).toLowerCase();
      const cap = main[0].toUpperCase() + main.slice(1);
      const name = `${cap} ${pick(['Flame', 'Candle', 'Ember', 'Spark', 'Wick'])}`.slice(0, 24);
      const symbol = (main.slice(0, 4) + pick(['', 'Y', 'O', 'Z'])).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SPARK';
      const mm = KEEPER_MODELS.find((x) => x[0] === model) || KEEPER_MODELS[0];
      return {
        name, symbol,
        description: `${name} started as one idea: ${text.slice(0, 90)}. Now it is a candle, and its Operator never lets it go out.`,
        intro: say(HELLOS, style).replace('$SYM', `$${symbol}`),
        visual: text, mind: { id: mm[0], name: mm[1], by: mm[2], logo: logoOf(mm[3]) },
      };
    },
    // Le logo : dessiné ici (la vraie version le fait peindre par FLUX).
    async sparkImage({ visual = '', name = '' }) {
      await new Promise((r) => setTimeout(r, 1600));
      let h = 0;
      for (const c of `${visual}${name}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const hue = h % 360;
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      const bg = g.createRadialGradient(256, 300, 40, 256, 256, 360);
      bg.addColorStop(0, `hsl(${(hue + 30) % 360} 70% 22%)`);
      bg.addColorStop(1, '#0b0705');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
      g.fillStyle = `hsl(${hue} 80% 58%)`;
      g.beginPath(); g.ellipse(256, 320, 150, 135, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      for (const x of [205, 307]) { g.beginPath(); g.arc(x, 300, 30, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#140b05';
      for (const x of [212, 300]) { g.beginPath(); g.arc(x, 306, 14, 0, Math.PI * 2); g.fill(); }
      const fl = g.createLinearGradient(0, 60, 0, 200);
      fl.addColorStop(0, '#fff6c8'); fl.addColorStop(1, '#ff8a1c');
      g.fillStyle = fl;
      g.beginPath(); g.moveTo(256, 50); g.bezierCurveTo(320, 120, 300, 190, 256, 200); g.bezierCurveTo(212, 190, 192, 120, 256, 50); g.fill();
      return new Promise((r) => c.toBlob(r, 'image/png'));
    },
    // Parler à un Operator (ou à The Wick) : des réponses toutes prêtes, dans son style.
    async ask({ mint, question }) {
      await new Promise((r) => setTimeout(r, 900 + Math.random() * 700));
      if (String(question || '').trim().length < 2) throw Object.assign(new Error('bad_question'), { code: 'bad_question' });
      if (mint === 'wick') {
        const q = String(question).toLowerCase();
        const answer = /keeper|ai|ia/.test(q) ? 'Every coin on WICK has an AI Operator: it creates the coin with you, talks to its holders, and picks the moments to burn it.'
          : /fee|cost|price|prix/.test(q) ? 'A launch costs the Ignition Fee plus pump.fun costs. Half of the fee buys back $WICK and burns it.'
          : 'I am The Wick. Every coin launched here feeds my flame, and every breath burns a little more of $WICK.';
        return { answer, keeper: { name: 'The Wick', label: 'Stoic', model: 'Llama 3.3 70B', by: 'Meta', logo: logoOf('meta') } };
      }
      const m = all.find((x) => x.mint === mint);
      if (!m) throw Object.assign(new Error('unknown_coin'), { code: 'unknown_coin' });
      return { answer: pick(say(ANSWERS, m.keeper.style)), keeper: { name: `Operator of $${m.symbol}`, label: m.keeper.label, model: m.keeper.model, by: m.keeper.by, logo: m.keeper.logo } };
    },
    // La forêt des bougies, et la page d'un coin.
    async candles() {
      const forest = all.filter((m) => m.candle).sort((a, b) => b.candle.burned - a.candle.burned || (b.mcap || 0) - (a.mcap || 0));
      return { forest: forest.slice(0, 40).map(pub), burns: coinBurns.slice(0, 30).map((b) => ({ ...b })), totals: candleTotals() };
    },
    async coin(mint) {
      const m = all.find((x) => x.mint === mint);
      if (!m) throw new Error('unknown_mint');
      const burnsOf = coinBurns.filter((b) => b.mint === mint);
      return { match: pub(m), burns: burnsOf.map((b) => ({ ...b })), operator: operatorOf(m, burnsOf) };
    },
  };
}
