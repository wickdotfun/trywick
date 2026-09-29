# WICK — adopt your candle 🕯️

**[trywick.fun](https://trywick.fun)** · [@trywickdotfun](https://x.com/trywickdotfun)

Every visitor adopts their own little 3D candle. Keep it alive, watch it grow, and try to
turn it into a torch. No wallet, no signup, no transaction: just a candle.

- **Pick your name**: a unique username, like on X (case-insensitive, 3 to 20 letters, numbers or
  `_`). It becomes your candle's name. No idea? Get a random one.
- **Strike the match**: your candle is born with a random look (wax color, flame color, sometimes
  an accessory). No rarity, just different candles: 240 possible looks.
- **One person, one candle**: if it goes out, you rekindle the *same* candle (same name, same
  look), but its age starts from zero.
- **Keep it alive**: it melts a little every hour. Feed it (at most every 4 hours). Forget it
  for too long and it goes out for good, straight to the graveyard.
- **The chart makes it grow**: when $WICK pumps, every candle grows faster (×1.5, then ×2).
  When it dumps, candles get scared, but **the chart never melts them**. Only you can.
- **It evolves**: candle → taper (1 day) → candlestick (3 days) → torch (7 days).
- **What you get**:
  - **the Hall of Fame**: every candle that becomes a torch stays there forever;
  - **the eternal flame**: once you've made a torch, your next candles are born with a golden flame;
  - **the weekly reward** (only shown when enabled): every Sunday at 20:00 UTC, the 3 oldest
    living candles whose owner left a public Solana address share a part of the creator fees,
    paid manually, with the payment proof shown on the site.
- **Quests**: small missions, in order (claim your candle on X, feed it 3 days in a row, reach the
  Taper…). Each one gives your candle **growth**, never age, so the oldest-flame race stays fair.
- **Two leaderboards**: the oldest flames (age) and the tallest flames (growth).
- **Show it off**: the Photo button renders a 1080 × 1350 card of *your* candle, as it is right now.

The site sells nothing, asks for no transaction and never connects to a wallet.

**Demo mode**: add `?demo` to the address for a simulated, sped-up world (about a thousand
candles, a moving chart), running entirely in your browser, with a permanent "Demo" banner.

---

## How it's built

A single [Cloudflare Worker](https://developers.cloudflare.com/workers/) serves the static
site and a small JSON API, backed by a [D1](https://developers.cloudflare.com/d1/) database.
The 3D is [Three.js](https://threejs.org/), with all geometry generated in code.

| What | Where |
|---|---|
| Static site (HTML, CSS, self-hosted Geist fonts, brand assets) | `public/` |
| Client code (bundled into `public/build/` by `npm run build`) | `src/client/` |
| 3D scene (faceted low-poly candles, faces, accessories) | `src/client/scene3d.js` |
| 2D fallback for devices without WebGL | `src/client/fallback2d.js` |
| Share card (1080 × 1350) | `src/client/card.js` |
| Demo mode (simulated world, in the browser) | `src/client/demo.js` |
| UI text | `src/client/i18n.js` |
| API routes, cron | `src/index.js`, `src/api/` |
| **Game rules, tuned here** | `lib/config.js` |
| Life of a candle (pure functions, shared by the server and the demo) | `lib/candles.js` |
| Looks (wax, flame, accessory) | `lib/traits.js` |
| World tick, leaderboard, Hall of Fame, weekly draw | `lib/world.js`, `lib/rewards.js` |
| Players (unique username, 12-word flame phrase) | `lib/players.js` |
| Quests, player codes, X post checks | `lib/quests.js`, `src/api/quests.js` |
| Price feed (DexScreener, no key) | `lib/market.js` |
| Handwritten lines, optional AI "thought of the moment" | `lib/lines.js`, `lib/thought.js` |
| Database schema (created automatically) | `lib/schema.js` |

### Rules (`lib/config.js`)

- **Wax**: 0 to 100, 70 at birth, −2 per hour whatever the chart does. At 0 the candle goes out for good.
- **Feeding**: +30 wax, at most once every 4 hours.
- **Growth**: 1 hour alive = 1 hour of growth; 1.5 hours when the chart is up ≥ 2 % over 1 h,
  2 hours when it's up ≥ 8 %. Taper at 1 day of growth, candlestick at 3, torch at 7.
- **Moods** (price change over 1 h) only change the face, the voice and the growth speed, never the wax.
- Before the coin launches, candles follow the price of SOL.
- One living candle per player. When it dies, you can light a new one (new look, from zero).
- **Fair play**: at most 3 births per IP per 24 h; a payout address belongs to a single player;
  never two winners from the same IP in the same week. IPs are never stored, only salted hashes.
- A cron ages every candle every 10 minutes, even with no visitors.

### Your candle, without a wallet or an account

- When you strike the match you get a **name**, a **color** and a **12-word flame phrase**, shown once.
- Your browser keeps a secret token. To switch devices, use "Recover my candle" and type your phrase.
- The 12 words come from **our own list** of 256 English words (96 bits of randomness) that
  contains **none** of the 2048 BIP39 wallet words: **it is not a seed phrase**. The site
  refuses to send a phrase containing any word outside the list, so a real seed pasted by
  mistake never leaves the device.
- The database only stores SHA-256 hashes of the token and the phrase.

---

## Run it locally

```
npm install
cp .dev.vars.example .dev.vars
npm run dev      # http://localhost:8787  (and /?demo for the demo)
npm test         # game rules
```

In `.dev.vars`: `DEV_CHANGE=-12` forces a mood (here, panic), `DEV_NO_IP_LIMIT=1` lifts the
per-IP limit, `ANTHROPIC_API_KEY=...` turns on the AI-written thought of the moment.

## Deploy (Cloudflare)

1. Create a D1 database and put its id in `wrangler.toml`. Tables are created on the first request.
2. Workers & Pages → Create → Import a repository. Build command: empty.
   Deploy command: `npx wrangler deploy`. Every push to `main` then redeploys the site.
3. Variables (Worker → Settings → Variables and Secrets):

   | Variable | Purpose |
   |---|---|
   | `IP_SALT` (secret) | random string used to hash IPs |
   | `ANTHROPIC_API_KEY` (secret, optional) | AI-written thought of the moment |
   | `TOKEN_MINT` | the coin's mint address (candles then follow its chart instead of SOL) |
   | `TOKEN_TICKER` | defaults to `WICK` |
   | `X_URL`, `TELEGRAM_URL` | social links |
   | `ANNOUNCEMENT_URL` | link of the official announcement post. **When set, lighting a first candle requires replying under it with your code** (the X account is linked at birth: one X account, one candle), and day one gets a "like & repost" quest |
   | `REWARD_SHARE` | share of creator fees paid out weekly, e.g. `20%`. **Without it, the reward is hidden** |
   | `REWARD_POOL` (optional) | this week's pool shown on the site, e.g. `2.5 SOL` |
   | `ADMIN_KEY` (secret) | long random password used to record payment proofs |

### Quests and X, for free

X's API is paid, so WICK never reads follows or likes. Instead:

- **X checks** use X's public embed services (no key, no cost): first *syndication* (author,
  text, the post it replies to, photos), then *oEmbed* as a fallback (author and text only).
  Each player has a code (`WICK-7F3KQ`, derived from their username) that must be in the post.
- **Birth**: with `ANNOUNCEMENT_URL` set, a new player picks a name, replies under the
  announcement with their code (any message), pastes the link, and the candle is born with the X
  account linked: one X account, one candle.
- **Day one** ends with "Show your candle": post the candle's photo with the exact text shown
  (the post must contain an image). Then "Keep it burning": streaks, forms, meals.
- **Honor quests** (follow, like) open the link and can be confirmed a few seconds later.
- **Game quests** are checked in the game (feeding streak, form reached, visit streak, meals).

**Adding a quest** (it goes after the others; `kind` is `x_post`, `x_photo` or `honor`;
an `x_post` with a `url` must be a reply to that post):

```
curl -X POST https://<your-site>/api/admin/quest \
  -H "authorization: Bearer <ADMIN_KEY>" -H "content-type: application/json" \
  -d '{"id": "reply1", "kind": "x_post", "title": "Reply to our launch post", "text": "Reply with your code.", "url": "https://x.com/trywickdotfun/status/…", "rewardHours": 6}'
```

Remove one with `{"id": "reply1", "remove": true}`.

**Recording a payout**: after sending a winner their share, post the transaction signature:

```
curl -X POST https://<your-site>/api/admin/paid \
  -H "authorization: Bearer <ADMIN_KEY>" -H "content-type: application/json" \
  -d '{"week": <week from /api/state>, "rank": 1, "tx": "<signature>"}'
```

---

## License

The code is released under the [MIT License](LICENSE).
The **WICK name, logo, wordmark and brand images** (`public/brand/`) are **not** covered by
it: please don't use them for your own project. The Geist fonts are under the SIL Open Font
License (`public/fonts/`).

WICK is a meme and a game. Nothing here is financial advice.
