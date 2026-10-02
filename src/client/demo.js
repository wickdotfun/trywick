// Mode démo (?demo) : un monde simulé et accéléré, entièrement dans le navigateur.
// Une bougie de 2 minutes (chaque allumette lui enlève 6 secondes), des coins qui arrivent
// toutes les deux ou trois secondes, de faux buybacks, et un lancement factice (pas de wallet).
import { cycleProgress } from '../../lib/candle.js';

const WORDS = ['Moon', 'Wax', 'Ember', 'Pepe', 'Wick', 'Cat', 'Dog', 'Frog', 'Spark', 'Flare', 'Torch', 'Smoke',
  'Ash', 'Burn', 'Lit', 'Glow', 'Fuse', 'Blaze', 'Melt', 'Drip', 'Sol', 'Bonk', 'Goblin', 'Chad', 'Based', 'Tiny'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const key = () => Array.from({ length: 44 }, () => pick(B58)).join('');

export function createDemo() {
  const timing = { durationMs: 120_000, matchMs: 6_000 };
  const all = [];
  const history = [];
  let seq = 0;
  let pot = 0.37;
  let cycle = { number: 7, startedAt: Date.now() - 55_000, matches: 0 };

  for (let n = 6; n >= 1; n--) {
    const sol = Math.round((0.3 + Math.random() * 1.2) * 100) / 100;
    history.push({
      number: n, endedAt: Date.now() - (7 - n) * 140_000, matches: 3 + Math.floor(Math.random() * 12),
      status: 'burned', buySol: sol, buySig: null, burnSig: null, burned: Math.round(sol * 2_800_000),
    });
  }

  function make(at, extra = {}) {
    const a = pick(WORDS), b = pick(WORDS.filter((w) => w !== a));
    const symbol = (Math.random() < 0.5 ? a + b : a).toUpperCase().slice(0, 8);
    const m = {
      seq: ++seq, mint: key(), creator: key(), name: `${a} ${b}`, symbol, image: null,
      devBuy: Math.random() < 0.5 ? 0 : Math.round(Math.random() * 20) / 10, at, cycle: cycle.number, ...extra,
    };
    all.push(m);
    cycle.matches++;
    pot += 0.01 + Math.random() * 0.03;     // les creator fees qui coulent
    return m;
  }

  for (let i = 0; i < 4; i++) make(Date.now() - (4 - i) * 9_000);

  // La bougie s'éteint : faux buyback, puis une nouvelle bougie.
  function tick() {
    const now = Date.now();
    if (!cycleProgress(cycle, now, timing).done) return;
    const ended = { number: cycle.number, endedAt: now, matches: cycle.matches, status: 'buying', buySol: Math.round(pot * 100) / 100 };
    history.unshift(ended);
    setTimeout(() => {
      ended.status = 'burned';
      ended.burned = Math.round(ended.buySol * 2_800_000);
    }, 6_000);
    pot = 0.05;
    cycle = { number: cycle.number + 1, startedAt: now, matches: 0 };
  }
  setInterval(tick, 500);

  (function arrive() {
    tick();
    make(Date.now());
    setTimeout(arrive, 1800 + Math.random() * 3200);
  })();

  return {
    demo: true,
    async state(since = 0) {
      tick();
      const now = Date.now();
      const totals = history.filter((h) => h.status === 'burned').reduce(
        (t, h) => ({ burned: t.burned + h.burned, sol: t.sol + h.buySol, buybacks: t.buybacks + 1 }),
        { burned: 0, sol: 0, buybacks: 0 },
      );
      const p = cycleProgress(cycle, now, timing);
      return {
        now,
        total: seq,
        heat: all.filter((m) => m.at > now - 20_000).length * 3,
        candle: { ...cycle, ...timing, melted: p.melted, endsAt: p.endsAt },
        matches: all.filter((m) => m.cycle === cycle.number && m.seq > since),
        history: history.slice(0, 12).map((h) => ({ ...h })),
        totals,
        buyback: { live: true, potSol: pot, wallet: null },
        token: { mint: null, ticker: 'WICK', x: null, telegram: null },
        launch: { maxDevBuy: 5 },
      };
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
        image: image ? URL.createObjectURL(image) : null, devBuy: Number(fields.devBuy) || 0,
      });
      return { match: m, signature: null };
    },
  };
}
