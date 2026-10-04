// Mode démo (?demo) : un monde simulé et accéléré, entièrement dans le navigateur.
// Un souffle (buyback) toutes les 90 secondes, chaque allumette l'avance de 6 secondes et brûle
// un peu de $WICK, une bougie = 0,05 % de la supply (pour la voir fondre en quelques minutes),
// et un lancement factice (pas de wallet).
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
// Les Keepers de la démo : des personnalités, des esprits, et ce qu'ils disent.
const KEEPER_STYLES = [['stoic', 'Stoic', 'Calm, patient, few words'], ['degen', 'Degen', 'Loud, fast, all conviction'],
  ['poet', 'Poet', 'Every burn is a verse'], ['pyro', 'Pyromaniac', 'Loves the fire a bit too much']];
const KEEPER_MODELS = [['llama', 'Llama 3.3 70B', 'Meta'], ['gpt-oss', 'gpt-oss 120B', 'OpenAI'], ['qwen', 'Qwen3 30B', 'Qwen'],
  ['mistral', 'Mistral Small 3.1', 'Mistral'], ['gemma', 'Gemma 3 12B', 'Google'], ['deepseek', 'DeepSeek R1 32B', 'DeepSeek']];
const VOICES = {
  stoic: ['It dipped 14%. A fair price for the flame.', 'Quiet hours. The wax waits for no one.', 'Volume is up. I take my share of the fire.'],
  degen: ['dip spotted. fed the candle, we eat', 'paper hands sold, I bought it and BURNED it', 'supply goes down, conviction goes up. lfg'],
  poet: ['Wax to smoke, the candle shortens by a breath.', 'A red hour, a golden flame. Burned.', 'The night was slow. I fed the fire anyway.'],
  pyro: ['MORE FIRE. it was right there, I had to.', 'oh it burns so nicely today', 'they sold. I lit it. everyone wins (the fire wins)'],
};
const WAITS = { stoic: 'Not yet. The market is calm, I let the wax gather.', degen: 'holding my fire for the next dip, ser',
  poet: 'I wait. The flame is patient, and so am I.', pyro: 'waiting is SO hard. but a dip is coming. I can feel it.' };

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
    // The Wick, le Keeper de la grande bougie, commente chaque buyback.
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

  function makeKeeper(m, style = pick(KEEPER_STYLES)[0], model = pick(KEEPER_MODELS)[0]) {
    const s = KEEPER_STYLES.find((x) => x[0] === style) || KEEPER_STYLES[0];
    const mm = KEEPER_MODELS.find((x) => x[0] === model) || KEEPER_MODELS[0];
    return { style: s[0], label: s[1], model: mm[1], by: mm[2], intro: `I keep the candle of $${m.symbol}. Every burn, I will tell you why.`, thought: null, thoughtAt: null };
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
    // La plupart des coins qui partagent ont choisi « Make it burn ».
    if (m.share && m.candle === null && !extra.share && Math.random() < 0.8) {
      m.candle = { bps: pick([1000, 2000, 2000, 3000, 5000]), burned: 0, pct: 0, sol: 0, burns: 0, live: true, keeper: makeKeeper(m) };
    }
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
    // Jamais deux fois la même phrase d'affilée pour un même Keeper.
    const voice = k ? pick(VOICES[k.style].filter((v) => v !== k.thought)) : null;
    if (k) Object.assign(k, { thought: Math.random() < 0.3 ? WAITS[k.style] : voice, thoughtAt: at });
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
            models: KEEPER_MODELS.map(([id, name, by]) => ({ id, name, by })),
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
      });
      if (Number(fields.burn) > 0) {
        m.candle = { bps: Number(fields.burn) * 100, burned: 0, pct: 0, sol: 0, burns: 0, live: true, keeper: makeKeeper(m, fields.keeper_style, fields.keeper_model) };
      }
      return { match: pub(m), signature: null };
    },
    // La forêt des bougies, et la page d'un coin.
    async candles() {
      const forest = all.filter((m) => m.candle).sort((a, b) => b.candle.burned - a.candle.burned || (b.mcap || 0) - (a.mcap || 0));
      return { forest: forest.slice(0, 40).map(pub), burns: coinBurns.slice(0, 30).map((b) => ({ ...b })), totals: candleTotals() };
    },
    async coin(mint) {
      const m = all.find((x) => x.mint === mint);
      if (!m) throw new Error('unknown_mint');
      return { match: pub(m), burns: coinBurns.filter((b) => b.mint === mint).map((b) => ({ ...b })) };
    },
  };
}
