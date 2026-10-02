# WICK — strike a match 🕯️

**[trywick.fun](https://trywick.fun)** · [@trywickdotfun](https://x.com/trywickdotfun)

One giant candle, burning live. Everyone sees the same one.

- **A candle lasts 30 minutes.** The countdown is on screen: it's the countdown to the next buyback.
- **Strike a match = launch a coin.** Pick a name, a ticker and an image: the coin is created on
  [pump.fun](https://pump.fun), signed by your own wallet. You are its creator (and you get its
  creator fees).
- **Every coin is a match that burns 1 minute off the candle.** It flies in and joins the orbit. The more
  launches, the more often the candle burns out.
- **When the flame dies, $WICK is bought back and burned** with the $WICK creator fees, automatically.
  Every buyback and every burn is on-chain, linked on the site. Then a new candle rises from the wax.
- **The more coins, the bigger the flame.** Launches from the last 10 minutes make it burn harder.

**Demo mode**: add `?demo` to the address for a simulated, sped-up world (2-minute candles, fake
buybacks, a fake launch with no wallet), running entirely in your browser, with a permanent "Demo" banner.

---

## How a launch works

The site never sees a private key and never asks for a seed phrase.

1. **Prepare** (`POST /api/launch/prepare`): the browser generates the new coin's mint keypair and
   sends the form (name, ticker, image, links, dev buy) with the *public* mint address and the creator's
   wallet address. The Worker uploads the image and metadata to pump.fun's IPFS, then asks
   [PumpPortal](https://pumpportal.fun/local-trading-api/trading-api) to build the unsigned `create`
   transaction.
2. **Sign** (in the browser): the wallet (Phantom, Solflare, Backpack…) signs first, then the mint keypair.
3. **Submit** (`POST /api/launch/submit`): the Worker checks that it's a pump.fun transaction, paid and
   signed by that creator, creating that mint, and sends it to Solana.
4. **Confirm** (`GET /api/launch/status`): once the transaction is confirmed on-chain (success, right
   creator, right mint, pump.fun program called, tokens minted), the match is lit and gets its number.
   A cron re-checks every 2 minutes, in case the browser was closed before confirmation.

Only matches confirmed on-chain count. A coin launched elsewhere (directly on pump.fun) is not a match.

## The buyback

When a candle burns out, the cron (every minute) runs its buyback, one step at a time
(`lib/buyback.js`):

1. **Collect** the $WICK creator fees into the buyback wallet (PumpPortal `collectCreatorFee`).
2. **Buy** $WICK with everything in the wallet above a 0.02 SOL reserve (kept for fees). Below
   0.005 SOL, no buyback this time: the pot carries over.
3. **Burn** exactly the $WICK this buyback just bought (SPL `Burn`). Any other $WICK in the wallet
   (a dev buy, for example) is never touched.

Each step is claimed by an atomic database write, so two overlapping crons never buy twice. A failed
buy leaves the SOL in the wallet for the next candle. Without `TOKEN_MINT` and `BUYBACK_SECRET_KEY`,
candles still burn out on time, but no buyback runs ("no buyback yet").

**The buyback wallet** is a dedicated Solana wallet whose secret key is stored as the
`BUYBACK_SECRET_KEY` secret. To receive the creator fees, it should be the wallet that launched $WICK on
pump.fun (or the fee recipient set on pump.fun). Everything it holds above the reserve is spent on
buybacks: never use it for anything else.

## How it's built

A single [Cloudflare Worker](https://developers.cloudflare.com/workers/) serves the static site and a
small JSON API, backed by a [D1](https://developers.cloudflare.com/d1/) database. The 3D is
[Three.js](https://threejs.org/), with all geometry generated in code.

| What | Where |
|---|---|
| Static site (HTML, CSS, self-hosted Geist fonts, brand assets) | `public/` |
| Page logic, feed, launch form | `src/client/app.js` |
| 3D scene (the candle, the orbiting matches, the burnout) | `src/client/scene.js` |
| Wallet + signing (loaded only when you strike) | `src/client/wallet.js` |
| Demo mode | `src/client/demo.js` |
| API routes, cron | `src/index.js`, `src/api/` |
| **Settings** (candle length, buyback, limits, pump.fun endpoints) | `lib/config.js` |
| Candle math (shared by the server, the demo and the tests) | `lib/candle.js` |
| Form checks | `lib/launch.js` |
| Solana without a library (base58, transaction reading, RPC) | `lib/solana.js` |
| pump.fun / PumpPortal calls | `lib/pump.js` |
| Matches in the database, cron sweep | `lib/matches.js`, `lib/schema.js` |
| Candles (30-minute cycles) | `lib/candle.js`, `lib/cycles.js` |
| Buyback and burn | `lib/buyback.js` |

The database tables (`matches`, `cycles`) are created on the first request. Tables from the previous version of
the site are left untouched (they can be dropped by hand).

**Fair play**: at most 12 launches prepared per IP per hour. IPs are never stored, only salted hashes.

---

## Run it locally

```
npm install
cp .dev.vars.example .dev.vars
npm run dev      # http://localhost:8787  (and /?demo for the demo)
npm test
```

Locally, `CYCLE_MINUTES=1` in `.dev.vars` lets you see a candle burn out quickly.
`npx wrangler dev --test-scheduled` then `curl "localhost:8787/__scheduled?cron=*+*+*+*+*"` runs the cron by hand.

## Deploy (Cloudflare)

1. The D1 database id is in `wrangler.toml`. The table is created on the first request.
2. Workers & Pages → Import a repository. Build command: empty. Deploy command: `npx wrangler deploy`.
   Every push to `main` then redeploys the site.
3. Variables (Worker → Settings → Variables and Secrets):

   | Variable | Purpose |
   |---|---|
   | `IP_SALT` (secret) | random string used to hash IPs |
   | `SOLANA_RPC` (secret, recommended) | a Solana RPC URL (Helius, Triton…). Defaults to the public one, which is rate-limited |
   | `TOKEN_MINT` | the $WICK mint address: turns the buyback on, and shows a `$WICK` link in the header |
   | `BUYBACK_SECRET_KEY` (secret) | the buyback wallet's secret key (Phantom export, base58, or a Solana CLI `[…]` array) |
   | `BUYBACK_COLLECT_FEES` | set to `off` to skip collecting creator fees before each buyback |
   | `CYCLE_MINUTES`, `MATCH_MINUTES` | candle length (default `30`) and time burned per match (default `1`) |
   | `TOKEN_TICKER` | defaults to `WICK` |
   | `X_URL` | the X link in the header |

---

## License

The code is released under the [MIT License](LICENSE).
The **WICK name, logo, wordmark and brand images** (`public/brand/`) are **not** covered by
it: please don't use them for your own project. The Geist fonts are under the SIL Open Font
License (`public/fonts/`).

WICK is a meme. Coins launched here are made by their creators, not by WICK. Nothing here is
financial advice.
