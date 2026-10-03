// Mode démo (?demo) : un monde simulé et accéléré, entièrement dans le navigateur.
// Un souffle (buyback) toutes les 90 secondes, chaque allumette l'avance de 6 secondes et brûle
// un peu de $WICK, une bougie = 0,05 % de la supply (pour la voir fondre en quelques minutes),
// et un lancement factice (pas de wallet).
import { cycleProgress, supplyCandle } from '../../lib/candle.js';

const WORDS = ['Moon', 'Wax', 'Ember', 'Pepe', 'Wick', 'Cat', 'Dog', 'Frog', 'Spark', 'Flare', 'Torch', 'Smoke',
  'Ash', 'Burn', 'Lit', 'Glow', 'Fuse', 'Blaze', 'Melt', 'Drip', 'Sol', 'Bonk', 'Goblin', 'Chad', 'Based', 'Tiny'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const key = () => Array.from({ length: 44 }, () => pick(B58)).join('');
const SUPPLY = 1_000_000_000;
const STEP = 0.05;
const FEE = 0.02;
const WICK_PER_SOL = 400_000;

export function createDemo() {
  const timing = { durationMs: 90_000, matchMs: 6_000 };
  const creators = Array.from({ length: 9 }, key);
  const all = [];
  const burns = [];
  const history = [];
  const hall = [];
  let seq = 0;
  let pot = 0.42;
  let burned = 0;
  let breath = { number: 18, startedAt: Date.now() - 40_000, matches: 0 };

  function burn(kind, ref, sol, symbol) {
    const amount = Math.round(sol * WICK_PER_SOL * (0.85 + Math.random() * 0.3));
    burned += amount;
    const b = { kind, ref: String(ref), at: Date.now(), burned: amount, sol, sig: null, symbol };
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
      });
    }
    return b;
  }

  function make(at, extra = {}) {
    const a = pick(WORDS), b = pick(WORDS.filter((w) => w !== a));
    const symbol = (Math.random() < 0.5 ? a + b : a).toUpperCase().slice(0, 8);
    const mcap = Math.random() < 0.15 ? null : Math.round(4000 * Math.exp(Math.random() * 5.5));
    const m = {
      seq: ++seq, mint: key(), creator: pick(creators), name: `${a} ${b}`, symbol, image: null,
      devBuy: Math.random() < 0.5 ? 0 : Math.round(Math.random() * 20) / 10, at,
      holder: Math.random() < 0.18, mcap, change: mcap ? Math.round((Math.random() - 0.35) * 160) : null, burned: null,
      ...extra,
    };
    all.push(m);
    breath.matches++;
    pot += 0.01 + Math.random() * 0.02;     // les creator fees qui coulent
    // Son frais de lancement est brûlé quelques secondes plus tard.
    setTimeout(() => { m.burned = burn('match', m.mint, FEE - 0.0005, m.symbol).burned; }, 2500 + Math.random() * 3000);
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
    m.burned = burn('match', m.mint, FEE - 0.0005, m.symbol).burned;
    burns[0].at = m.at + 3000;
  }
  burns.sort((a, b) => b.at - a.at);
  breath.matches = 3;

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
        },
        burns: { full, list: (full ? burns : burns.slice(0, 20)).map((b) => ({ ...b })) },
        hall: full ? hall.map((h) => ({ ...h })) : null,
        hot: all.filter((m) => m.mcap && m.at > now - 86_400_000).sort((a, b) => b.mcap - a.mcap).slice(0, 5).map(pub),
        markets: full || markets ? inOrbit.filter((m) => m.mcap).map((m) => ({ mint: m.mint, mcap: m.mcap, change: m.change })) : null,
        buyback: { live: true, paused: false, potSol: pot, wallet: null },
        token: { mint: null, ticker: 'WICK', x: null, telegram: null },
        launch: { maxDevBuy: 5, feeSol: FEE },
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
      });
      return { match: pub(m), signature: null };
    },
  };
}
