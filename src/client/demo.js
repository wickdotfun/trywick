// Le mode démo (?demo) : un monde entièrement simulé dans le navigateur, et accéléré,
// pour voir à quoi ressemble WICK avec des centaines de joueurs. Rien n'est envoyé au
// serveur. Les règles sont exactement celles du vrai jeu (lib/candles.js).
import { advance, applyAction, candleView, cooldownsFor, moodFor, newCandle, stageIndexFor } from '../../lib/candles.js';
import { CONFIG, DAY, HOUR, MINUTE } from '../../lib/config.js';
import { LINES, idleLine, langOf, pick } from '../../lib/lines.js';
import { COLORS, newName, newPhrase } from '../../lib/players.js';
import { WEEK, lastDeadline, nextDeadline, shortAddress } from '../../lib/rewards.js';
import { traitsFor } from '../../lib/traits.js';

export const SPEEDS = [60, 600, 3600];

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());

export function createDemo() {
  let speed = 600;
  let simNow = Date.now();
  let lastReal = Date.now();
  let nextId = 1;
  let birthAcc = 0;

  const candles = [];
  const feed = [];
  let me = null;
  let mine = null;

  // Le chart : une marche au hasard qui revient vers 0, avec de temps en temps un gros pump ou un dump.
  const market = { change1h: 1.2, change24h: 14, priceUsd: 0.000182, stepAt: simNow };

  function log(e) {
    feed.push(e);
      if (feed.length > 30) feed.length = 30;
  }

  // Chaque bougie simulée a un « joueur » qui passe plus ou moins souvent.
  // Ceux qui passent moins d'une fois tous les ~2 jours finissent par la perdre.
  function bot(now, ageMs, dead) {
    const seed = Math.floor(Math.random() * 2 ** 32);
    const c = newCandle({ id: nextId++, playerId: 'bot', name: newName(), color: COLORS[Math.floor(Math.random() * COLORS.length)], seed }, now - ageMs);
    c.visitEvery = Math.random() < 0.8 ? rnd(4, 30) * HOUR : rnd(40, 90) * HOUR;
    c.nextVisit = now + rnd(0, c.visitEvery);
    c.growth = ageMs * rnd(1, 1.3);
    c.stage = stageIndexFor(c.growth);
    c.wax = rnd(25, 100);
    c.updatedAt = now;
    c.feeds = Math.floor(ageMs / c.visitEvery);
    c.lastFed = now - rnd(0, CONFIG.cooldown.nourrir);
    // Environ 6 joueurs sur 10 ont donné une adresse pour la récompense.
    c.payout = Math.random() < 0.6;
    if (c.stage === CONFIG.stages.length - 1) c.torchAt = c.bornAt + (CONFIG.stages[c.stage].age / (c.growth / Math.max(1, ageMs)));
    // Une bougie oubliée tient au moins 35 h (70 de cire à 2 / h) : pas de mort plus rapide.
    const minLife = (CONFIG.waxAtBirth / CONFIG.waxDecayPerHour) * HOUR;
    if (dead && ageMs > minLife) {
      c.diedAt = now - rnd(0, Math.min(2 * DAY, ageMs - minLife));
      c.wax = 0;
    }
    return c;
  }

  // Un monde qui tourne déjà depuis quelques semaines.
  for (let i = 0; i < 1100; i++) {
    const age = Math.min(26 * DAY, -Math.log(Math.random()) * 3.2 * DAY);
    candles.push(bot(simNow, age, i % 4 === 0));
  }
  for (const c of [...candles].filter((x) => x.diedAt).sort((a, b) => b.diedAt - a.diedAt).slice(0, 8)) {
    log({ at: c.diedAt, kind: 'died', who: c.name, candle: c.id, detail: c.diedAt - c.bornAt });
  }

  // La récompense de la semaine, tirée « chaque dimanche » du monde simulé.
  let rewardAt = nextDeadline(simNow);
  let lastReward = null;
  function drawReward(at) {
    const eligible = candles.filter((c) => !c.diedAt && (c.payout || (c.playerId === 'me' && me?.payout)))
      .sort((a, b) => a.bornAt - b.bornAt).slice(0, CONFIG.reward.winners);
    lastReward = {
      week: at,
      winners: eligible.map((c, i) => ({
        rank: i + 1, id: c.id, name: c.name, color: look(c).flame.color, ageMs: at - c.bornAt,
        address: c.playerId === 'me' ? shortAddress(me.payout) : 'Demo…Addr', tx: null,
      })),
    };
    eligible.forEach((c, i) => log({ at, kind: 'reward', who: c.name, candle: c.id, detail: i + 1 }));
  }
  drawReward(lastDeadline(simNow));

  function stepMarket(now) {
    while (market.stepAt + MINUTE <= now) {
      market.stepAt += MINUTE;
      market.change1h += gauss() * 0.55 - market.change1h * 0.012;
      if (Math.random() < 0.002) market.change1h += (Math.random() < 0.5 ? -1 : 1) * rnd(9, 16);
      market.change1h = Math.max(-28, Math.min(32, market.change1h));
      market.change24h += (market.change1h / 60) * 0.6 - market.change24h * 0.0007;
      market.priceUsd *= 1 + market.change1h / 100 / 60;
    }
  }

  function step() {
    const real = Date.now();
    const dt = (real - lastReal) * speed;
    const now = simNow + dt;
    lastReal = real;
    simNow = now;
    stepMarket(now);
    const mood = moodFor(market.change1h);
    while (now >= rewardAt) { drawReward(rewardAt); rewardAt += WEEK; }

    // Des naissances : ~ 320 par jour.
    birthAcc += (dt * 320) / DAY;
    const births = Math.floor(birthAcc);
    birthAcc -= births;
    for (let i = 0; i < Math.min(births, 40); i++) {
      const c = bot(now, 0, false);
      c.wax = CONFIG.waxAtBirth;
      c.feeds = 0;
      c.lastFed = 0;
      candles.push(c);
      log({ at: now, kind: 'born', who: c.name, candle: c.id, detail: 1 });
    }

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.diedAt) continue;
      const r = advance(c, now, mood);
      let next = { ...r.candle, visitEvery: c.visitEvery, nextVisit: c.nextVisit };
      for (const e of r.events) {
        if (e.kind === 'died') log({ at: next.diedAt, kind: 'died', who: next.name, candle: next.id, detail: next.diedAt - next.bornAt });
        if (e.kind === 'evolved') log({ at: now, kind: 'evolved', who: next.name, candle: next.id, detail: e.detail });
      }
      if (c === mine || c.playerId === 'me') {
        // Ma bougie devient torche : mes prochaines bougies auront la flamme éternelle.
        if (r.events.some((e) => e.detail === 'torche')) me.torches += 1;
        candles[i] = next;
        mine = next;
        continue;
      }
      next.payout = c.payout;
      if (!next.diedAt && now >= next.nextVisit) {
        next.nextVisit = now + c.visitEvery * rnd(0.5, 1.5);
        const fed = applyAction(next, 'nourrir', now);
        if (fed.candle) { next = { ...fed.candle, visitEvery: c.visitEvery, nextVisit: next.nextVisit }; if (Math.random() < 0.06) log({ at: now, kind: 'nourrir', who: next.name, candle: next.id }); }
      }
      candles[i] = next;
    }
    // On oublie les très vieux morts pour garder la simulation légère.
    if (candles.length > 2600) {
      const cut = candles.findIndex((c) => c.diedAt && now - c.diedAt > 3 * DAY);
      if (cut >= 0) candles.splice(cut, 1);
    }
    return { now, mood };
  }

  function look(c) {
    return traitsFor(c.seed, Boolean(c.legacy));
  }

  function listItem(c, now) {
    const l = look(c);
    return {
      id: c.id, name: c.name, color: l.flame.color, gen: c.gen, alive: !c.diedAt,
      legacy: l.legacy, torchAt: c.torchAt ?? null,
      stage: CONFIG.stages[c.stage].key,
      ageMs: (c.diedAt || now) - c.bornAt, wax: Math.round(c.wax), diedAt: c.diedAt,
    };
  }

  function snapshot(now, mood) {
    const alive = candles.filter((c) => !c.diedAt);
    const byAge = [...alive].sort((a, b) => a.bornAt - b.bornAt);
    const dead = candles.filter((c) => c.diedAt).sort((a, b) => b.diedAt - a.diedAt);
    const record = [...candles].sort((a, b) => ((b.diedAt || now) - b.bornAt) - ((a.diedAt || now) - a.bornAt))[0];
    const eligible = byAge.filter((c) => c.payout || (c.playerId === 'me' && me?.payout));
    const myRank = mine && !mine.diedAt && me?.payout ? eligible.indexOf(eligible.find((c) => c.playerId === 'me')) + 1 : null;
    return {
      now,
      me: me ? { ...me, rewardRank: myRank || null } : null,
      candle: mine ? candleView(mine, now, mood) : null,
      cooldowns: cooldownsFor(mine, now),
      market: {
        tracking: 'token', symbol: 'WICK', mood,
        change1h: Math.round(market.change1h * 10) / 10,
        change24h: Math.round(market.change24h * 10) / 10,
        priceUsd: market.priceUsd, marketCap: market.priceUsd * 1e9, volume24h: 412_000, liquidity: 38_000, url: null,
      },
      token: { mint: null, ticker: 'WICK', x: null, telegram: null },
      feed: feed.slice(0, 20),
      stats: {
        alive: alive.length,
        total: candles.length,
        died24h: dead.filter((c) => now - c.diedAt < DAY).length,
        born24h: candles.filter((c) => now - c.bornAt < DAY).length,
        hungry: alive.filter((c) => c.wax < CONFIG.hungryBelow).length,
      },
      oldest: byAge.slice(0, 20).map((c) => listItem(c, now)),
      graveyard: dead.slice(0, 12).map((c) => listItem(c, now)),
      record: record ? listItem(record, now) : null,
      around: alive.slice(-60).map((c) => ({ id: String(c.id), color: look(c).flame.color, level: c.stage + 1 })),
      hallOfFame: candles.filter((c) => c.torchAt).sort((a, b) => a.torchAt - b.torchAt).slice(0, 30).map((c) => listItem(c, now)),
      reward: {
        share: '20%', pool: '4.2 SOL (demo)', nextAt: rewardAt,
        contenders: eligible.slice(0, CONFIG.reward.winners).map((c) => listItem(c, now)),
        last: lastReward,
      },
    };
  }

  const ok = (body) => ({ ok: true, status: 200, body });
  const fail = (status, body) => ({ ok: false, status, body });

  async function api(path, opts = {}) {
    const { now, mood } = step();
    const url = new URL(path, location.origin);
    const body = opts.body || {};
    const lang = langOf(body.lang || url.searchParams.get('lang'));

    if (url.pathname === '/api/state') return ok(snapshot(now, mood));
    if (url.pathname === '/api/thought') return ok({ text: idleLine(lang, { alive: true }, mood), ai: false, mood });
    if (url.pathname === '/api/recover') return fail(400, { error: 'unknown_phrase' });

    if (url.pathname === '/api/candle') {
      const c = candles.find((x) => x.id === Number(url.searchParams.get('id')));
      return c ? ok({ candle: candleView(c, now, mood) }) : fail(404, { error: 'not_found' });
    }

    if (url.pathname === '/api/light') {
      if (mine && !mine.diedAt) return fail(409, { error: 'already_lit' });
      let welcome = null;
      if (!me) {
        me = { id: 'me', name: newName(), color: COLORS[Math.floor(Math.random() * COLORS.length)], payout: null, torches: 0 };
        welcome = { token: 'demo', phrase: newPhrase() };
      }
      const gen = candles.filter((c) => c.playerId === 'me').length + 1;
      mine = { ...newCandle({ id: nextId++, playerId: 'me', name: me.name, color: me.color, gen, seed: Math.floor(Math.random() * 2 ** 32), legacy: me.torches > 0 }, now) };
      candles.push(mine);
      log({ at: now, kind: 'born', who: mine.name, candle: mine.id, detail: gen });
      return ok({ ...snapshot(now, mood), line: pick(LINES[lang].event[gen > 1 ? 'reborn' : 'born']), ...(welcome ? { welcome } : {}) });
    }

    if (url.pathname === '/api/act') {
      const r = applyAction(mine, body.action, now);
      if (r.error) return fail(r.error === 'cooldown' ? 429 : 409, { error: r.error, line: r.error === 'cooldown' ? pick(LINES[lang].cooldown) : null, ...snapshot(now, mood) });
      const i = candles.indexOf(mine);
      mine = r.candle;
      candles[i] = mine;
      log({ at: now, kind: body.action, who: mine.name, candle: mine.id });
      return ok({ ok: true, line: pick(LINES[lang].act[body.action]), ...snapshot(now, mood) });
    }
    if (url.pathname === '/api/payout') {
      if (!me) return fail(401, { error: 'no_player' });
      me.payout = body.address || null;
      return ok({ ok: true, ...snapshot(now, mood) });
    }
    return fail(404, { error: 'not_found' });
  }

  return {
    api,
    get speed() { return speed; },
    setSpeed(s) { step(); speed = s; },
  };
}
