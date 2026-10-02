// Mode démo (?demo) : un monde simulé et accéléré, entièrement dans le navigateur.
// Une bougie de 150 allumettes seulement, des coins qui arrivent toutes les secondes,
// et un lancement factice (pas de wallet, rien on-chain).
import { candleState } from '../../lib/candle.js';

const WORDS = ['Moon', 'Wax', 'Ember', 'Pepe', 'Wick', 'Cat', 'Dog', 'Frog', 'Spark', 'Flare', 'Torch', 'Smoke',
  'Ash', 'Burn', 'Lit', 'Glow', 'Fuse', 'Blaze', 'Melt', 'Drip', 'Sol', 'Bonk', 'Goblin', 'Chad', 'Based', 'Tiny'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const key = () => Array.from({ length: 44 }, () => pick(B58)).join('');

export function createDemo() {
  const per = 150;
  const all = [];
  let seq = 0;

  function make(at, extra = {}) {
    const a = pick(WORDS), b = pick(WORDS.filter((w) => w !== a));
    const symbol = (Math.random() < 0.5 ? a + b : a).toUpperCase().slice(0, 8);
    const m = {
      seq: ++seq, mint: key(), creator: key(), name: `${a} ${b}`, symbol, image: null,
      devBuy: Math.random() < 0.5 ? 0 : Math.round(Math.random() * 20) / 10, at, ...extra,
    };
    all.push(m);
    return m;
  }

  const start = Date.now();
  for (let i = 0; i < 118; i++) make(start - (118 - i) * 9_000);

  (function tick() {
    make(Date.now());
    setTimeout(tick, 600 + Math.random() * 2200);
  })();

  return {
    demo: true,
    async state(since = 0) {
      const now = Date.now();
      const candle = candleState(seq, per);
      const from = Math.max(since, candle.firstSeq - 1);
      const finals = [];
      for (let n = candle.burnedOut; n >= 1 && finals.length < 12; n--) finals.push({ candle: n, match: all[n * per - 1] });
      return {
        now,
        total: seq,
        heat: all.filter((m) => m.at > now - 40_000).length,
        candle,
        matches: all.filter((m) => m.seq > from),
        finals,
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
