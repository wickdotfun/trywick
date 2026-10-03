# WICK — the launchpad that burns itself 🕯️

**[trywick.fun](https://trywick.fun)** · [@trywickdotfun](https://x.com/trywickdotfun) · [Telegram](https://t.me/trywickdotfun)

**The candle is $WICK. Every coin melts it.** Every token launched through WICK becomes a match. Every match
feeds the flame. Every flame burns $WICK: launch a coin → Ignition Fee → buy $WICK → burn $WICK.

- **One candle = 0.5% of the $WICK supply.** When it's fully consumed, that slice of $WICK is gone forever:
  the candle joins the **candle hall** (with its story: launches, hottest coin) and the next one is lit.
- **Strike a match = launch a coin.** Pick a name, a ticker and an image: the coin is created on
  [pump.fun](https://pump.fun), signed by your own wallet. You are its creator (and you get its creator fees).
- **Every launch burns $WICK.** The **WICK Ignition Fee** (0.02 SOL, WICK's own fee, not a pump.fun fee), signed
  together with the launch, buys $WICK and burns it within a minute.
- **Share the fire (optional).** At launch, the creator can share **10% of the coin's pump.fun creator fees** with
  WICK, forever, and pays a reduced **0.01 SOL** Ignition Fee instead of 0.02. The split (90% creator, 10% WICK) is set
  with pump.fun's own fee sharing and locked on-chain: nobody can change it, not even WICK. WICK's part buys $WICK and
  burns it at the next buyback. See "Creator fee sharing" below.
- **The breath: a buyback every 30 minutes at most.** The $WICK creator fees buy back and burn $WICK. Every
  launch brings the next buyback 1 minute closer. The countdown is on screen.
- **Living matches.** Each coin orbits the candle; coins that pump (DexScreener market cap) grow and move closer
  to the flame, dead ones fade. Coins launched by a $WICK holder burn in gold.
- **The fire** (live feed): every launch and its Ignition Fee, every burn with its transaction. Each burn also pops a
  receipt above the candle (`🔥 124,820 $WICK burned · 0.014 SOL used · View TX ↗`).
- **$WICK page** (`/#wick`): the live chart (DexScreener), price, market cap, volume, the pump.fun bonding curve, the
  top holders read on-chain, and **buy / sell right on the site** (PumpPortal builds the trade, your wallet signs it).
  Before `TOKEN_MINT` is set, a "launching soon" page.
- **Dashboard** (`/#dashboard`): $WICK burned, % of the supply, current supply, SOL spent on buybacks, coins launched,
  Ignition Fees paid, 24h volume of WICK coins, last burn, last launch, the burn chart and every burn. Real data only.
- **Explore** (`/#explore`): every WICK coin (logo, market cap, 24h volume, age, creator, $WICK burned, Trade), sorted by
  Trending / New / Top volume / Biggest burner.
- **Your flames** (`/#flames`): any wallet's profile: coins launched, $WICK burned thanks to them, volume, Ignition Fees,
  rank and achievements (First Match, Burned 100K $WICK, Golden Flame, Viral Flame…).
- **Leaderboard and Hall of Flames** (`/#leaderboard`, `/#hall`): the Pyromaniacs, and every fully melted candle with
  its $WICK burned, SOL spent, coins launched, burns and last transaction.
- **Telegram bot**: every new coin is posted in the channel with its picture, then updated once its launch fee
  is burned; every buyback and every consumed candle is announced.

**Demo mode**: add `?demo` to the address for a simulated, sped-up world (90-second breaths, tiny candles, fake
burns, a fake launch with no wallet), running entirely in your browser, with a permanent "Demo" banner.

---

## How a launch works

The site never sees a private key and never asks for a seed phrase.

1. **Prepare** (`POST /api/launch/prepare`): the browser generates the new coin's mint keypair and
   sends the form (name, ticker, image, links, dev buy) with the *public* mint address and the creator's
   wallet address. The Worker uploads the image and metadata to pump.fun's IPFS, then asks
   [PumpPortal](https://pumpportal.fun/local-trading-api/trading-api) to build the unsigned `create`
   transaction.
   When the buyback is live, it also builds the **launch fee** transfer (0.02 SOL from the creator to the
   buyback wallet).
2. **Sign** (in the browser): the wallet (Phantom, Solflare, Backpack…) signs first (the launch and the fee
   together, one approval), then the mint keypair.
3. **Submit** (`POST /api/launch/submit`): the Worker checks that it's a pump.fun transaction, paid and
   signed by that creator, creating that mint, and that the fee is a real transfer of the right amount to
   the buyback wallet. It sends the launch, then the fee.
4. **Confirm** (`GET /api/launch/status`): once the transaction is confirmed on-chain (success, right
   creator, right mint, pump.fun program called, tokens minted), the match is lit and gets its number.
   The creator's $WICK balance is checked then (gold flame for holders). Once the fee is confirmed, its
   burn joins the queue. The cron re-checks every minute, in case the browser was closed before confirmation.

Only matches confirmed on-chain count. A coin launched elsewhere (directly on pump.fun) is not a match.

## The burns

Every burn goes through one queue (`burns` table), run by the cron every minute, one step at a time
(`lib/buyback.js`): **buy** $WICK, then **burn** exactly the $WICK that buy brought (SPL `Burn`). Any other
$WICK in the wallet (a dev buy, for example) is never touched. Two kinds:

- **Buyback** (end of each breath): first **collect** the $WICK creator fees (PumpPortal `collectCreatorFee`),
  then buy with everything above a 0.02 SOL reserve, minus the launch fees still waiting for their own burn.
  Below 0.005 SOL, no buyback this time: the pot carries over.
- **Launch burn**: the 0.02 SOL launch fee (minus 0.0005 SOL kept for network fees), bought back and burned
  within a minute, with a smaller priority fee.

Each step is claimed by an atomic database write, so two overlapping crons never buy twice. A failed buy
leaves the SOL in the wallet. Without `TOKEN_MINT` and `BUYBACK_SECRET_KEY`, the breath still runs, nothing is
bought ("no buyback yet"), and launching costs nothing extra.

## Creator fee sharing

pump.fun lets a coin's creator split its creator fees between up to 10 wallets, once and for all
([pump.fun docs](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md)).
WICK uses it, as an option chosen by the creator at launch (`lib/sharing.js`):

1. **Prepare**: with sharing, the Worker builds a second transaction, paid and signed by the creator, that holds the
   reduced Ignition Fee, `create_fee_sharing_config` and `update_fee_shares_v2` (creator 90%, WICK 10%; this last
   instruction locks the split forever). The wallet signs it together with the launch: still one approval.
2. **Submit**: the launch is sent; the sharing transaction is checked (byte for byte the one prepared) and **held**: it
   can only work once the coin exists.
3. **Confirmed**: as soon as the launch is confirmed, the held transaction is sent. It is atomic: if it fails or
   expires, neither the fee nor the split happen (the coin stays launched, without sharing).
4. **Distribution** (cron, `runShares`): every 6 hours at most per coin, once at least 0.01 SOL of fees has piled up,
   the buyback wallet calls the permissionless `distribute_creator_fees_v2` (after `transfer_creator_fees_to_pump_v2`
   for a coin that graduated to PumpSwap). Each shareholder is paid by pump.fun directly. WICK's part (read from the
   confirmed transaction) is shown on the dashboard and burns at the next buyback, with the rest of the pot.

The instructions are built by hand (no SDK in the Worker) and `test/sharing.test.js` checks they are byte for byte
those of the official `@pump-fun/pump-sdk` (`test/fixtures/pump-sdk-sharing.json`).

**The candle** is computed from the burns: % burned = $WICK burned by WICK ÷ the original supply (current
supply read on-chain + what WICK burned). Each 0.5% crossed is a consumed candle, recorded once in the `hall`
table.

**The admin page** (`/admin`, needs `ADMIN_KEY`) shows the configuration checklist (including the launch fee and
the Telegram bot), the buyback wallet (SOL, pot, $WICK held), the burn queue, the last 20 breaths with their
buy and burn transactions, and the last cron step and error. It has two buttons:

- **Pause buyback**: the emergency switch. No new buy starts (queued burns are marked "paused", the SOL
  waits in the wallet), launching costs nothing extra while paused, and a buy already sent still goes on to
  its burn. The site shows "Buybacks are paused".
- **Run buyback now**: moves the buyback forward right away instead of waiting for the next cron.

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
| Page logic, feed, launch form, routes (`#wick`, `#explore`…) | `src/client/app.js` |
| Explore, Your flames, dashboard, leaderboard, Hall of Flames, How it works | `src/client/pages.js`, `lib/explore.js`, `src/api/explore.js` |
| The $WICK page (chart, curve, holders, buy / sell) | `src/client/token.js`, `lib/token.js`, `src/api/token.js` |
| 3D scene (the candle, the orbiting matches, the burnout) | `src/client/scene.js` |
| Wallet + signing (loaded only when you strike) | `src/client/wallet.js` |
| Demo mode | `src/client/demo.js` |
| API routes, cron | `src/index.js`, `src/api/` |
| **Settings** (candle length, buyback, limits, pump.fun endpoints) | `lib/config.js` |
| Candle math (shared by the server, the demo and the tests) | `lib/candle.js` |
| Form checks | `lib/launch.js` |
| Solana without a library (base58, transaction reading, RPC) | `lib/solana.js` |
| pump.fun / PumpPortal calls | `lib/pump.js` |
| Matches in the database, cron sweep, world state | `lib/matches.js`, `lib/schema.js` |
| The candle (% of supply) and the candle hall | `lib/candle.js`, `lib/supply.js`, `lib/hall.js` |
| The breath (30-minute buyback countdown) | `lib/cycles.js` |
| Burn queue: buybacks and launch burns | `lib/buyback.js` |
| Creator fee sharing (pump.fun fee sharing, distributions) | `lib/sharing.js` |
| Living matches (DexScreener market caps) | `lib/markets.js` |
| Pyromaniacs leaderboard | `lib/leaderboard.js`, `src/api/leaderboard.js` |
| Telegram bot | `lib/telegram.js` |
| Admin page (status, pause, run) | `public/admin.html`, `src/api/admin.js`, `lib/settings.js` |

The database tables (`matches`, `cycles`, `burns`, `hall`, `settings`) are created on the first request. Tables from the previous version of
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

Locally, `CYCLE_MINUTES=1` in `.dev.vars` makes the breath (buyback countdown) 1 minute long.
`npx wrangler dev --test-scheduled` then `curl "localhost:8787/__scheduled?cron=*+*+*+*+*"` runs the cron by hand.

## Deploy (Cloudflare)

1. The D1 database id is in `wrangler.toml`. The table is created on the first request.
2. Workers & Pages → Import a repository. Build command: empty. Deploy command: `npx wrangler deploy`.
   Every push to `main` then redeploys the site.
3. Variables (Worker → Settings → **Runtime variables and secrets**, not the Build ones):

   | Variable | Purpose |
   |---|---|
   | `IP_SALT` (secret) | random string used to hash IPs |
   | `SOLANA_RPC` (secret, recommended) | a Solana RPC URL (Helius, Triton…). Defaults to the public one, which is rate-limited |
   | `TOKEN_MINT` | the $WICK mint address: turns the buyback on, and shows a `$WICK` link in the header |
   | `BUYBACK_SECRET_KEY` (secret) | the buyback wallet's secret key (Phantom export, base58, or a Solana CLI `[…]` array) |
   | `ADMIN_KEY` (secret) | long random password (16+ characters) for `/admin`. Without it, the admin page is off |
   | `BUYBACK_COLLECT_FEES` | set to `off` to skip collecting creator fees before each buyback |
   | `CYCLE_MINUTES`, `MATCH_MINUTES` | breath length (default `30`) and how much closer each launch brings the buyback (default `1`) |
   | `CANDLE_PCT` | share of the $WICK supply per candle, in % (default `0.5`) |
   | `LAUNCH_FEE_SOL` | Ignition Fee burned as $WICK (default `0.02`, `0` to turn it off). Only charged while the buyback is live |
   | `LAUNCH_FEE_SHARED_SOL` | Ignition Fee when the creator shares its creator fees (default `0.01`) |
   | `SHARE_BPS` | WICK's part of shared creator fees, in basis points (default `1000` = 10%, `0` turns the option off) |
   | `HOLDER_MIN` | minimum $WICK held for a golden flame (default: any amount) |
   | `TELEGRAM_BOT_TOKEN` (secret), `TELEGRAM_CHAT_ID` | the bot (from @BotFather) and the channel (`@yourchannel` or its numeric id); the bot must be an admin of the channel |
   | `SITE_URL` | the link in Telegram posts (default `https://trywick.fun`) |
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
