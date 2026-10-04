# WICK — the launchpad that burns itself 🕯️

**[trywick.fun](https://trywick.fun)** · [@trywickdotfun](https://x.com/trywickdotfun) · [Telegram](https://t.me/trywickdotfun)

**Every coin is a candle.** Launch a coin on pump.fun through WICK and it can burn itself, forever: a share of its
creator fees buys it back and burns it. Every launch and every candle also burns $WICK, the big candle in the middle.
Launch a coin → it burns itself → it feeds $WICK → burn $WICK.

- **One candle = 0.5% of the $WICK supply.** When it's fully consumed, that slice of $WICK is gone forever:
  the candle joins the **candle hall** (with its story: launches, hottest coin) and the next one is lit.
- **Strike a match = launch a coin.** Pick a name, a ticker and an image: the coin is created on
  [pump.fun](https://pump.fun), signed by your own wallet. You are its creator (and you get its creator fees).
- **Every launch burns $WICK.** The **WICK Ignition Fee** (0.02 SOL, WICK's own fee, not a pump.fun fee), signed
  together with the launch: **50% burns $WICK, 50% funds the team**. Both transfers are in the same transaction; the
  burn half buys $WICK and burns it within a minute.
- **Make it burn (optional).** At launch, the creator picks **10, 20, 30 or 50% of the coin's pump.fun creator fees**
  to buy the coin itself back and burn it, forever: the coin becomes a **candle**, with its own page (`/#coin/<mint>`),
  every burn on Solscan, and its place in the forest (`/#candles`). On top of that, 5% burns $WICK and 5% funds the
  team; the rest is the creator's. The Ignition Fee drops to **0.01 SOL** (also 50/50). The split is set with pump.fun's
  own fee sharing and locked on-chain: nobody can change it, not even WICK. See "Make it burn" below.
  (Without a candle, a creator can still share 10%: 90% creator · 5% burn · 5% team.)
- **The breath: a buyback every 30 minutes at most.** Everything waiting in the burn wallet buys back and burns
  $WICK. Every launch brings the next buyback 1 minute closer. The countdown is on screen.
- **$WICK's own creator fees** are not part of the burn: they go to the dev wallet that launched $WICK, like any
  pump.fun coin's creator, and the site never touches them.
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
- **Telegram bot** (launch and burn bot style): every new coin with its picture, contract address, creator, dev buy,
  Ignition Fee and socials, updated with the burn transaction once its fee is burned; every buyback & burn (SOL
  spent with its dollar value, $WICK burned, supply left, Buy/Burn TX); every fully melted candle with its season
  stats; and a daily report (launches, burns, hottest coins, pyromaniac of the day).
- **The $WICK launch announcement**: the cron watches the dev wallet; within a minute of it creating the coin with the
  $WICK ticker on pump.fun, the official message ("$WICK is live. the only CA: …") is posted in the channel and pinned,
  once (`lib/announce.js`).

**Demo mode**: add `?demo` to the address for a simulated, sped-up world (90-second breaths, tiny candles, fake
burns, a fake launch with no wallet), running entirely in your browser, with a permanent "Demo" banner.

---

## How a launch works

The site never sees a private key and never asks for a seed phrase.

1. **Prepare** (`POST /api/launch/prepare`): the browser generates the new coin's mint keypair and
   sends the form (name, ticker, image, links, dev buy) with the *public* mint address and the creator's
   wallet address. The Worker pins the image, then the metadata JSON (name, symbol, description, image,
   links) to IPFS through [Pinata](https://pinata.cloud) (`PINATA_JWT`; pump.fun no longer accepts direct
   uploads for API launches), then asks [PumpPortal](https://pumpportal.fun/local-trading-api/trading-api)
   to build the unsigned `create` transaction with that metadata URI.
   When the buyback is live, it also builds the **Ignition Fee** transaction (two transfers from the creator:
   the burn half to the burn wallet, the team half to the dev wallet).
2. **Sign** (in the browser): the wallet is connected with the Wallet Standard (Phantom, Solflare, Backpack… are
   detected with their icon, `src/client/connect.js`). One transaction per approval, as Phantom recommends for
   multi-signer transactions: the wallet signs the launch first, then the mint keypair signs it; then the wallet signs
   the Ignition Fee (with fee sharing, if chosen). The server checks the fee transaction by its content, so the
   safety instructions a wallet may add when signing (Phantom's Lighthouse) are accepted.
3. **Submit** (`POST /api/launch/submit`): the Worker checks that it's a pump.fun transaction, paid and
   signed by that creator, creating that mint, and that the fee holds exactly the right transfers. It sends
   the launch and **holds the fee**: the fee only goes out once the launch is confirmed, so a failed launch
   costs no fee.
4. **Confirm** (`GET /api/launch/status`): once the transaction is confirmed on-chain (success, right
   creator, right mint, pump.fun program called, tokens minted), the match is lit and gets its number.
   The creator's $WICK balance is checked then (gold flame for holders). Once the fee is confirmed, its
   burn joins the queue. The cron re-checks every minute, in case the browser was closed before confirmation.

Only matches confirmed on-chain count. A coin launched elsewhere (directly on pump.fun) is not a match.

## The burns

Every burn goes through one queue (`burns` table), run by the cron every minute, one step at a time
(`lib/buyback.js`): **buy** $WICK, then **burn** exactly the $WICK that buy brought (SPL `Burn`). Any other
$WICK in the wallet (a dev buy, for example) is never touched. Two kinds:

- **Buyback** (end of each breath): buy with everything in the burn wallet above a 0.02 SOL reserve, minus the
  launch fees still waiting for their own burn. Below 0.005 SOL, no buyback this time: the pot carries over.
  (`BUYBACK_COLLECT_FEES=on` would also claim the $WICK creator fees first; off by default, since they belong to
  the dev wallet.)
- **Launch burn**: the burn half of the Ignition Fee (minus 0.0005 SOL kept for network fees), bought back and
  burned within a minute, with a smaller priority fee.

Each step is claimed by an atomic database write, so two overlapping crons never buy twice. A failed buy
leaves the SOL in the wallet. Without `TOKEN_MINT` and `BUYBACK_SECRET_KEY`, the breath still runs, nothing is
bought ("no buyback yet"), and launching costs nothing extra.

## Make it burn

A coin's candle is fed by its own creator fees (`lib/candles.js`, `lib/sharing.js`, `lib/buyback.js`):

1. **Launch**: the creator picks the share (`burn` = 10, 20, 30 or 50). The locked split gives the burn wallet that
   share plus the 5% for $WICK (one shareholder), the team wallet 5%, the creator the rest.
2. **Distribution** (cron, every 6 hours at most per coin): what the burn wallet receives from a coin is split. The
   coin's part (its share over the burn wallet's whole share) is set aside for that coin (`matches.self_pending`); the
   rest joins the $WICK pot.
3. **Queue**: once a coin has at least 0.01 SOL set aside, a burn of kind `coin` joins the burn queue
   (`ref` = `mint:distribution id`), minus 0.0005 SOL kept for network fees. The coin's SOL never counts in the $WICK pot;
   a failed buy gives it back to the coin.
4. **Buy and burn**: the same safe state machine as the $WICK burns, but the bought token is the coin itself. Once
   burned, the coin's candle melts (`self_burned`, `self_sol`, `self_burns`), and the burn shows on the site, in the
   feed and on the coin's page. $WICK's own numbers (supply burned, candles, Hall of Flames) never count coin burns.

`GET /api/candles` returns the forest (coins that burn themselves, most burned first), their latest burns and totals;
`GET /api/coin?mint=…` returns one coin, its candle and every burn.

## Keepers

Every coin that burns itself gets a **Keeper**: an AI agent that tends its candle (`lib/keepers.js`). The creator picks
its personality (Stoic, Degen, Poet, Pyromaniac) and its mind (Llama, gpt-oss, Qwen, Mistral, Gemma, DeepSeek) in the
launch form. The models run on [Workers AI](https://developers.cloudflare.com/workers-ai/), inside its free daily quota.

- **What it decides**: only *when* to burn. Once a coin has at least 0.01 SOL set aside, the Keeper is asked at most
  once an hour: `burn` or `wait`, with one short line for the holders. It never picks how much, nor where the SOL goes:
  the SOL set aside can only buy back that coin and burn it, through the same burn queue as above.
- **Guardrails**: past 0.25 SOL waiting, or 24 hours since its last burn, it burns anyway. At most 3 Keepers a minute
  and 150 AI calls a day (`keepers` in `lib/config.js`). If the chosen model fails, Llama answers; if the AI is out
  (no binding, quota spent), the coin burns as it would without a Keeper, with a written line.
- **Its voice**: each burn carries the Keeper's line (`burns.voice`), shown in the feed, the burn pop-up and the coin's
  page. A Keeper introduces itself once its coin is live, and The Wick speaks for the $WICK buybacks.

Coins launched without a Keeper (or before Keepers) burn as soon as 0.01 SOL is set aside.

## Creator fee sharing

pump.fun lets a coin's creator split its creator fees between up to 10 wallets, once and for all
([pump.fun docs](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md)).
WICK uses it, as an option chosen by the creator at launch (`lib/sharing.js`):

1. **Prepare**: with sharing, the Worker builds a second transaction, paid and signed by the creator, that holds the
   reduced Ignition Fee (burn half and team half), `create_fee_sharing_config` and `update_fee_shares_v2` (creator
   90%, burn wallet 5%, team wallet 5%; this last instruction locks the split forever). The wallet signs it right
   after the launch (a second approval).
2. **Submit**: the launch is sent; the sharing transaction is checked (byte for byte the one prepared) and **held**: it
   can only work once the coin exists.
3. **Confirmed**: as soon as the launch is confirmed, the held transaction is sent. It is atomic: if it fails or
   expires, neither the fee nor the split happen (the coin stays launched, without sharing).
4. **Distribution** (cron, `runShares`): every 6 hours at most per coin, once at least 0.01 SOL of fees has piled up,
   the burn wallet calls the permissionless `distribute_creator_fees_v2` (after `transfer_creator_fees_to_pump_v2`
   for a coin that graduated to PumpSwap). Each shareholder is paid by pump.fun directly. The burn and team parts
   (read from the confirmed transaction) are shown on the dashboard and the admin page; the burn part burns at the
   next buyback, with the rest of the pot.

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

**Two wallets.**

- **The burn wallet** (`5siQ…M69Z`, `buyback.wallet` in `lib/config.js`) is a dedicated Solana wallet whose private
  key is stored as the `BUYBACK_SECRET_KEY` secret. It receives the burn half of the Ignition Fees and the 5% burn
  share of shared creator fees, and only ever buys and burns $WICK: everything it holds above the reserve is spent
  on buybacks, so never use it for anything else. The Worker refuses any other key (`wrong_burn_wallet`), and
  always refuses the dev wallet's (`dev_wallet_key`).
- **The dev wallet** (`7ZMM…eLANN`, `launch.deployer`) launches $WICK and receives the team half of the Ignition
  Fees, the 5% team share of shared creator fees, and 100% of $WICK's own creator fees. The site never holds its key.

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
| Coins that burn themselves (Candles page, coin pages) | `lib/candles.js`, `src/client/candles.js` |
| Keepers (the AI agent of each candle) | `lib/keepers.js` |
| Living matches (DexScreener market caps) | `lib/markets.js` |
| Pyromaniacs leaderboard | `lib/leaderboard.js`, `src/api/leaderboard.js` |
| Telegram bot | `lib/telegram.js` |
| Admin page (status, pause, run) | `public/admin.html`, `src/api/admin.js`, `lib/settings.js` |

The database tables (`matches`, `cycles`, `burns`, `hall`, `settings`) are created on the first request. Tables from the previous version of
the site are left untouched (they can be dropped by hand).

**Fair play**: at most 12 launches prepared per IP per hour. IPs are never stored, only salted hashes.

**Balance check** (`lib/funds.js`): before a launch or a $WICK trade is prepared, the server reads the wallet's SOL
balance. If it can't pay (dev buy and its fees, Ignition Fee, coin creation, network fees), nothing is uploaded or
signed and the site says how much is needed. An unreadable balance never blocks: the wallet shows its own warning.

---

## Run it locally

```
npm install
cp .dev.vars.example .dev.vars
npm run dev      # http://localhost:8787  (and /?demo for the demo)
npm test
```

Workers AI has no local version: `wrangler dev` asks for `npx wrangler login` because of the `[ai]` binding
(without the binding, the Keepers fall back to written lines). The tests never call the AI.

Locally, `CYCLE_MINUTES=1` in `.dev.vars` makes the breath (buyback countdown) 1 minute long.
`npx wrangler dev --test-scheduled` then `curl "localhost:8787/__scheduled?cron=*+*+*+*+*"` runs the cron by hand.

## Deploy (Cloudflare)

1. The D1 database id is in `wrangler.toml`. The table is created on the first request. The Workers AI binding (`AI`,
   for the Keepers) is in `wrangler.toml` too: nothing to set up, and the admin page shows the AI calls of the day.
2. Workers & Pages → Import a repository. Build command: empty. Deploy command: `npx wrangler deploy`.
   Every push to `main` then redeploys the site.
3. Variables (Worker → Settings → **Runtime variables and secrets**, not the Build ones):

   | Variable | Purpose |
   |---|---|
   | `IP_SALT` (secret) | random string used to hash IPs |
   | `SOLANA_RPC` (secret, recommended) | a Solana RPC URL (Helius, Triton…). Defaults to the public one, which is rate-limited |
   | `TOKEN_MINT` | the $WICK mint address. Optional: when the dev wallet launches $WICK, the address is detected and used by itself (this variable, if set, wins) |
   | `PINATA_JWT` (secret) | the JWT of a [Pinata](https://pinata.cloud) API key (free plan, Admin): coin images and metadata go to IPFS through it. Without it, launching from the site is off |
   | `IPFS_GATEWAY` | the IPFS gateway used in metadata links (default `https://ipfs.io`) |
   | `UPLOADS_PER_HOUR` | launches prepared per hour, all visitors together (default `200`, on top of 12 per IP) |
   | `BUYBACK_SECRET_KEY` (secret) | the burn wallet's private key (Phantom → Show Private Key, base58, or a Solana CLI `[…]` array). Not the recovery phrase, never the dev wallet's |
   | `BURN_WALLET` | the only burn wallet address accepted for that key (default: the one in `lib/config.js`) |
   | `ADMIN_KEY` (secret) | long random password (16+ characters) for `/admin`. Without it, the admin page is off |
   | `BUYBACK_COLLECT_FEES` | `on` makes the burn wallet claim $WICK's creator fees before each buyback (default: off, they stay the dev wallet's) |
   | `CYCLE_MINUTES`, `MATCH_MINUTES` | breath length (default `30`) and how much closer each launch brings the buyback (default `1`) |
   | `CANDLE_PCT` | share of the $WICK supply per candle, in % (default `0.5`) |
   | `LAUNCH_FEE_SOL` | Ignition Fee (default `0.02`, `0` to turn it off). Only charged while the buyback is live |
   | `LAUNCH_FEE_SHARED_SOL` | Ignition Fee when the creator shares its creator fees (default `0.01`) |
   | `TEAM_FEE_BPS` | team share of the Ignition Fee, in basis points (default `5000` = 50%) |
   | `TEAM_WALLET` | where the team share goes (default: the dev wallet) |
   | `SHARE_BURN_BPS`, `SHARE_TEAM_BPS` | burn and team parts of shared creator fees, in basis points (default `500` + `500`: 90/5/5) |
   | `HOLDER_MIN` | minimum $WICK held for a golden flame (default: any amount) |
   | `TELEGRAM_BOT_TOKEN` (secret), `TELEGRAM_CHAT_ID` | the bot (from @BotFather) and the channel (`@yourchannel` or its numeric id); the bot must be an admin of the channel |
   | `SITE_URL` | the link in Telegram posts (default `https://trywick.fun`) |
   | `DEPLOYER_WALLET` | the dev wallet that launches $WICK (default: the one in `lib/config.js`). The bot announces the launch in the channel within a minute and pins it |
   | `TELEGRAM_DAILY_HOUR` | hour (UTC) of the daily report in the channel (default `18`, `off` to turn it off) |
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
