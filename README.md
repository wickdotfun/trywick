# WICK — strike a match 🕯️

**[trywick.fun](https://trywick.fun)** · [@trywickdotfun](https://x.com/trywickdotfun)

One giant candle, burning live. Everyone sees the same one.

- **Strike a match = launch a coin.** Pick a name, a ticker and an image: the coin is created on
  [pump.fun](https://pump.fun), signed by your own wallet. You are its creator (and you get its
  creator fees).
- **Every coin is a match.** It flies in, joins the orbit around the candle, and the candle melts a little.
- **1,000 matches and it's gone.** The coin that finishes a candle is engraved as its *final match*,
  then a new candle rises from the wax.
- **The more coins, the bigger the flame.** Launches from the last 10 minutes make it burn harder.

**Demo mode**: add `?demo` to the address for a simulated, sped-up world (150 matches per candle,
a fake launch with no wallet), running entirely in your browser, with a permanent "Demo" banner.

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
| **Settings** (matches per candle, limits, pump.fun endpoints) | `lib/config.js` |
| Candle math (shared by the server, the demo and the tests) | `lib/candle.js` |
| Form checks | `lib/launch.js` |
| Solana without a library (base58, transaction reading, RPC) | `lib/solana.js` |
| pump.fun / PumpPortal calls | `lib/pump.js` |
| Matches in the database, cron sweep | `lib/matches.js`, `lib/schema.js` |

The database table (`matches`) is created on the first request. Tables from the previous version of
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

Locally, `MATCHES_PER_CANDLE=5` in `.dev.vars` lets you see a candle burn out quickly.

## Deploy (Cloudflare)

1. The D1 database id is in `wrangler.toml`. The table is created on the first request.
2. Workers & Pages → Import a repository. Build command: empty. Deploy command: `npx wrangler deploy`.
   Every push to `main` then redeploys the site.
3. Variables (Worker → Settings → Variables and Secrets):

   | Variable | Purpose |
   |---|---|
   | `IP_SALT` (secret) | random string used to hash IPs |
   | `SOLANA_RPC` (secret, recommended) | a Solana RPC URL (Helius, Triton…). Defaults to the public one, which is rate-limited |
   | `MATCHES_PER_CANDLE` | defaults to `1000` |
   | `TOKEN_MINT`, `TOKEN_TICKER` | shows a `$WICK` link to pump.fun in the header |
   | `X_URL` | the X link in the header |

---

## License

The code is released under the [MIT License](LICENSE).
The **WICK name, logo, wordmark and brand images** (`public/brand/`) are **not** covered by
it: please don't use them for your own project. The Geist fonts are under the SIL Open Font
License (`public/fonts/`).

WICK is a meme. Coins launched here are made by their creators, not by WICK. Nothing here is
financial advice.
