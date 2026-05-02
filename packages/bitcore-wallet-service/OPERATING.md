# Operating bitcore-wallet-service

A practical guide for running BWS in a self-hosted deployment, focused
on the ops layer that `Installation.md` doesn't cover. If you've never
installed BWS before, read [`Installation.md`](./Installation.md) first
— this document picks up at "the package is built, now what."

This guide is written from the live experience of bringing the stack up
end-to-end against Reddcoin (`packages/bitcore-wallet-service`,
`packages/bitcore-node`, and a real `reddcoind` mainnet daemon). Every
section corresponds to something we hit in practice; if a step looks
obvious, it's because the corresponding failure was not.

---

## Contents

1. [Prerequisites](#prerequisites)
2. [Quickstart](#quickstart)
3. [Configuration reference](#configuration-reference)
4. [Auxiliary processes](#auxiliary-processes)
5. [Health checks](#health-checks)
6. [Log locations](#log-locations)
7. [Common errors](#common-errors)
8. [Restarts and graceful stop](#restarts-and-graceful-stop)

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 22** | `package.json#engines.node` enforces this. Earlier Node versions trip on the bundled `secp256k1@4`. |
| **MongoDB 3.4 – 4.4** | The bundled `mongodb` driver is `3.5.9`, which speaks wire-versions ≤7. Don't try to talk to a 5.0+ mongod. The compatibility window matters more than the install version. |
| **`mongosh` caveat** | The system `mongosh` (≥1.x, wire-version ≥8) **cannot** talk to the same mongod BWS uses. BWS itself is unaffected — but if you're debugging, use a `MongoClient` script via `node` rather than `mongosh`. See [Common errors](#common-errors). |
| **A running bitcore-node** | BWS proxies all blockchain queries through bitcore-node's REST API. See [`packages/bitcore-node/`](../bitcore-node/) — bitcore-node in turn talks to the chain daemon via JSON-RPC + P2P. |
| **A running chain daemon** | For Reddcoin: `reddcoind` listening on its standard `:45443` (RPC) / `:45444` (P2P), fully synced to tip. For BTC/BCH/etc you can use the public BitPay endpoints — only the Reddcoin chain has to be self-hosted. |

The whole dependency chain looks like this:

```
chain daemon (reddcoind) → bitcore-node → BWS bws.js + bcmonitor.js → BWC
                                         ↘ MongoDB ↙
```

`bcmonitor.js` also talks back to bitcore-node (over Socket.IO, for new-block events feeding the confirmation counter). Mongo is shared by bitcore-node and BWS but stores them in **different databases** by default — `bitcore` and `bws`.

---

## Quickstart

Copy the annotated example config and start the API:

```sh
cd packages/bitcore-wallet-service

# 1. Seed the per-host config
cp bws.example.config.js bws.config.js
$EDITOR bws.config.js   # at minimum, fill any field marked // REQUIRED

# 2. Build the package. `build:prod` excludes test/ from compilation,
#    which is the build mode `start.sh` actually wants.
npm run clean && npm run build:prod

# 3. Start just the HTTP API (we don't need the other 5 auxiliary
#    processes for a basic deploy — see "Auxiliary processes" below).
mkdir -p logs
node ./ts_build/src/bws.js > logs/bws.log 2>&1 &

# 4. Confirm it's serving
curl http://localhost:3232/bws/api/v1/version/
# → {"serviceVersion":"bws-11.8.1"}
```

The new `bws.config.js` ships with all of `bws.example.config.js`'s
inline comments preserved — the `// REQUIRED` markers are in there.

For confirmation tracking on incoming deposits, also start
`bcmonitor.js` once everything else is up:

```sh
node ./ts_build/src/bcmonitor/bcmonitor.js > logs/bcmonitor.log 2>&1 &
```

---

## Configuration reference

The single source of truth is the annotated [`bws.example.config.js`](./bws.example.config.js). After the BIT-15 cleanup, every option carries a `// REQUIRED` or `// OPTIONAL` marker and a one-line note on what triggers it. The header of that file also documents:

- USAGE (`cp` + edit)
- The config-resolution order from [`src/config.ts:485-517`](./src/config.ts) — first `$BITCORE_CONFIG_PATH/bitcore.config.json` (the `bitcoreWalletService` block, for monorepo setups), then `$BWS_CONFIG_PATH/bws.config.js` (for stand-alone setups). Most operators want only the second.
- A 30-line minimum-viable config you can copy in.
- A "Known footguns" section listing `socketApiKey`, `allowRegtest`, and the (benign) push-notifications `authorizationKey` placeholder.

Treat the example file as the authoritative reference; this document only adds **why** decisions matter.

### Why `socketApiKey` matters (and how to generate one)

`socketApiKey` is parsed via `Bitcore.PrivateKey()` the moment `bcmonitor.js` subscribes to a wallets-room socket on bitcore-node. The literal placeholder `'socketApiKey'` fails Base58Check decode with `Checksum mismatch` and the process dies. Generate a real WIF before starting bcmonitor:

```sh
node -e 'console.log(new (require("@bitpay-labs/bitcore-lib").PrivateKey)("livenet").toWIF())'
```

The wallets-room subscription will still be rejected by bitcore-node (the corresponding pubkey isn't in bitcore-node's allowlist), but block-events room is public and that's what feeds the confirmation counter. If you need full wallet-event push (per-address notifications), register the pubkey on the bitcore-node side — out of scope here.

### Why `allowRegtest` matters

If you're testing locally against `reddcoind -regtest`, `allowRegtest: false` (the default) silently rejects regtest wallet creation. Flip to `true` for local development; leave `false` for production deploys.

### blockchainExplorerOpts: which URL goes where

Each chain's `livenet` / `testnet` block points BWS at the bitcore-node URL serving that chain. For BitPay-hosted chains (BTC, BCH, ETH, DOGE, LTC, XRP), `https://api.bitcore.io` (and `api-eth.bitcore.io`, `api-xrp.bitcore.io`) work as-is. For Reddcoin, you must point at your own bitcore-node — e.g. `http://localhost:3000`.

The mainnet / livenet / regtest URL strings are passed through verbatim to bitcore-node's `V8` HTTP client at runtime; the only validation is at first connect. A wrong URL surfaces as "Error connecting to ..." in BWS's log when bcmonitor tries to attach.

---

## Auxiliary processes

`start.sh` launches **six** node processes. For a typical self-hosted wallet deploy, you only need the first two:

| Process | Required? | Role | Symptom if absent |
|---|---|---|---|
| `bws.js` | **REQUIRED** | The HTTP API on port 3232 | No service. |
| `bcmonitor.js` | **REQUIRED for confirmation tracking** | Subscribes to bitcore-node's socket and updates BWS's chain-tip cache | `getStatus()` reports `confirmations: 0` even on confirmed UTXOs. Wallets still work but UI shows "unconfirmed" forever. |
| `messagebroker.js` | Optional | Cross-process events bus between bws/bcmonitor/etc | "Error connecting to message broker server @ http://localhost:3380" warnings flood the log every 5s. Functionally non-blocking for single-process deployments. |
| `emailservice.js` | Optional | Outbound notifications via SMTP / SendGrid | No emails. |
| `pushnotificationsservice.js` | Optional | FCM push notifications | No pushes. |
| `fiatrateservice.js` | Optional | Polls a fiat-rate provider every `fetchInterval` minutes | `/v1/fiatrates/<currency>` returns stale or empty data. **And** any code path that calls `getFeeLevels()` for a chain whose fee history is empty crashes the BWS process — see [BIT-13](https://reddink.youtrack.cloud/issue/BIT-13). |

If you're running the full BitPay-style deploy and want all six, use `npm run start` — it runs `npm run clean && npm run build && ./start.sh` and pid-files each process under `pids/`. Stop with `./stop.sh`.

For a minimal RDD-only deploy: `bws.js` + `bcmonitor.js` is enough. `messagebroker.js` only matters if you have multiple bws workers needing to coordinate.

---

## Health checks

BWS doesn't expose a dedicated `/health` endpoint, but several anonymous reads are usable as smoke tests.

| Check | Command | Healthy response |
|---|---|---|
| API alive | `curl http://localhost:3232/bws/api/v1/version/` | `{"serviceVersion":"bws-11.8.1"}` |
| Mongo reachable | Look for the startup line `Connection established to db: mongodb://...` | (in stdout) |
| Wallet creation accepted | `curl -X POST http://localhost:3232/bws/api/v1/wallets/exist -H 'Content-Type: application/json' -d '{"copayers":[]}'` | `[]` (the empty result, served promptly) |
| bcmonitor alive | Look for `Blockchain monitor started` followed by `Connected to wallets V8 (rdd/mainnet) @ http://localhost:3000` | (in stdout) |

For a deeper check you can hit `/v3/wallets/?includeExtendedInfo=1` against a known wallet — that exercises the full mongo-read + V8-bridge + chain-state path.

### Log signatures of a healthy startup

When `node ./ts_build/src/bws.js` boots cleanly, expect roughly:

```
info :: Using JS config from /path/to/packages/bitcore-wallet-service/
info :: Listening on port: 3232
info :: Connection established to db: mongodb://0.0.0.0:27017/bws
info :: Creating DB indexes
info :: Using message broker server at http://localhost:3380
warn :: Moralis missing credentials       ← benign unless you use Moralis
info :: BWS running
warn :: Error connecting to message broker server @ http://localhost:3380   ← benign for single-process
```

For `bcmonitor.js`:

```
info :: Blockchain monitor started
info :: Connected to wallets V8 (rdd/mainnet) @ http://localhost:3000
info :: Connected to block V8 (rdd/mainnet) @ http://localhost:3000
error :: Error joining room Authentication failed /RDD/mainnet         ← see "Common errors"
info :: Connected to block V8 (rdd/regtest) @ http://localhost:3000
```

---

## Log locations

When started via `start.sh` (i.e. via `npm start`):

```
packages/bitcore-wallet-service/logs/bws.log
packages/bitcore-wallet-service/logs/bcmonitor.log
packages/bitcore-wallet-service/logs/messagebroker.log
packages/bitcore-wallet-service/logs/emailservice.log
packages/bitcore-wallet-service/logs/pushnotificationsservice.log
packages/bitcore-wallet-service/logs/fiatrateservice.log
packages/bitcore-wallet-service/pids/<service>.pid
```

When started by hand (`node ./ts_build/src/bws.js`), logs go wherever you redirect — the convention used by the smoke scripts in `packages/bitcore-wallet-client/scripts/` is `logs/bws-YYYYMMDD-HHMMSS.log`.

The log format is bitcore-logging's structured prefix:
`<level> :: <ISO-8601 timestamp> :: <message>`. Levels: `info`, `warn`, `error`, `debug`, `verbose`. Set `disableLogs: true` in `bws.config.js` to silence stdout entirely (useful in containerised deploys where you'd rather scrape the process via `docker logs`).

---

## Common errors

### `Cannot read properties of undefined (reading 'validateAddress')` from bitcore-node

**Cause**: bitcore-node was started **before** `crypto-wallet-core` was rebuilt with RDD support. Its require-cache holds the old `Validation` map without `'rdd'`.

**Fix**: stop bitcore-node, rebuild cwc (`cd packages/crypto-wallet-core && npm run compile`), restart bitcore-node. We hit this in the BIT-12 thread; the running indexer needed restarting before BWS's V8 calls would resolve.

### `Checksum mismatch` from `Bitcore.PrivateKey._transformWIF`, taking down `bcmonitor.js`

**Cause**: `socketApiKey` in `bws.config.js` is the literal placeholder string `'socketApiKey'` (or any other non-WIF value).

**Fix**: replace with a real livenet WIF — see the generator one-liner under [Configuration reference](#why-socketapikey-matters-and-how-to-generate-one).

### `Cannot read properties of undefined (reading 'map')` at `samplePoints` in `server.ts`

**Cause**: the `/v1/feelevels/?chain=…&network=…` endpoint, on a chain whose `feeStats` collection is empty (no historical fee samples). The function dereferences `.map` on the storage result without a guard, the unhandled rejection propagates, and the BWS process dies.

**Fix**: don't hit `/feelevels/` for chains without fee history yet. Long-term: filed as [BIT-13](https://reddink.youtrack.cloud/issue/BIT-13). To populate `feeStats`, run `bcmonitor.js` against a chain with at least 100 blocks of history, or see Phase 7.5 in `MIGRATION.md` for the per-chain backfill plan.

### `Error connecting to message broker server @ http://localhost:3380`

**Cause**: `messagebroker.js` isn't running.

**Fix**: ignore (single-process operators) or start it (`node ./ts_build/src/messagebroker/messagebroker.js`). Doesn't block any wallet operations.

### `Error joining room Authentication failed /<CHAIN>/<network>` from `bcmonitor.js`

**Cause**: the wallets-room socket on bitcore-node requires a registered pubkey signature; our `socketApiKey` WIF's pubkey isn't in bitcore-node's allowlist.

**Fix**: harmless for confirmation tracking (we only need block-events, which is a public room). For full per-address push notifications, register the pubkey on the bitcore-node side or run a permissive config there.

### MongoDB driver version mismatch

**Symptom**: `MongoServerSelectionError: Server at 127.0.0.1:27017 reports maximum wire version 5, but this version of the Node.js Driver requires at least 8 (MongoDB 4.2)` from `mongosh`.

**Cause**: a modern `mongosh` (wire-version ≥8) talking to a 3.6-era `mongod` (wire-version ≤6).

**Fix**: BWS itself is fine — its bundled driver speaks the older protocol. For ad-hoc mongo queries, use a node script with the same driver:

```sh
node -e "const {MongoClient} = require('@bitpay-labs/bitcore-wallet-service/node_modules/mongodb');
(async () => {
  const c = new MongoClient('mongodb://127.0.0.1:27017');
  await c.connect();
  const db = c.db('bws');
  console.log(await db.collection('wallets').countDocuments());
  await c.close();
})();"
```

### `BADREQUEST: Invalid extended public key` on wallet creation

**Cause**: BWS's chain-keyed `Bitcore_` map for the chain you're creating a wallet on is missing the entry. Specifically the one in `src/lib/server.ts`, `src/lib/model/wallet.ts`, or `src/lib/model/address.ts`.

**Fix**: this should not happen on a current build — BIT-7 + BIT-12 + the bbbf1a946 follow-up wired `rdd` into all of them. If you see this for a different chain you've added, replicate the same pattern: `import { BitcoreLib<Chain> }` from cwc, add a `<chain>: BitcoreLib<Chain>` row to every `Bitcore_` literal. There are five of these in `src/lib/`:
- `lib/server.ts:66`
- `lib/blockchainexplorers/v8.ts:21`
- `lib/common/utils.ts:17`
- `lib/model/address.ts:49` (`Address.Bitcore` static)
- `lib/model/wallet.ts:19`

Plus the chain registry at `src/lib/chain/index.ts:21`.

### `Failed state: fee-too-high at <getBitcoreTx()>` on `createTxProposal`

**Cause**: `Defaults.MAX_TX_FEE[<chain>]` in `src/lib/common/defaults.ts` is `undefined`. The cap check `totalInputs - totalOutputs <= undefined` evaluates `false` and the txp is rejected before signing.

**Fix**: this should not happen on a current build — fixed in 4d0d2e92b. For new chains, add a row to each of `MAX_FEE_PER_KB`, `MIN_TX_FEE`, and `MAX_TX_FEE` in `src/lib/common/defaults.ts`.

---

## Restarts and graceful stop

In **reverse-dependency order** so dependents don't see TCP errors mid-restart:

```sh
# 1. Stop BWS auxiliary processes first
./stop.sh
# or, if started by hand:
pkill -TERM -f "bcmonitor/bcmonitor.js"
pkill -TERM -f "ts_build/src/bws.js"

# 2. Stop bitcore-node (separate package)
pkill -TERM -f "bitcore-node/build/src/server.js"

# 3. Mongo and the chain daemon (reddcoind etc) usually keep running.
```

To start back up, **dependency order** (mongo → daemon → bitcore-node → bws/bcmonitor):

```sh
# Mongo and reddcoind already running.
cd packages/bitcore-node && node build/src/server.js > .logs/node.log 2>&1 &
cd ../bitcore-wallet-service && node ./ts_build/src/bws.js > logs/bws.log 2>&1 &
node ./ts_build/src/bcmonitor/bcmonitor.js > logs/bcmonitor.log 2>&1 &
```

Confirm each came up before starting the next — see [Health checks](#health-checks).

### Stale syncing-node lock (bitcore-node side)

If bitcore-node's master crashed without cleanup, the next start may sit on `Another node is the primary syncing node` for up to 5 minutes (split-brain guard). Clear the stale heartbeat:

```sh
node -e "
const {MongoClient} = require('mongodb');
(async () => {
  const c = new MongoClient('mongodb://127.0.0.1:27017');
  await c.connect();
  await c.db('bitcore').collection('state').updateOne({}, { \$unset: { 'syncingNode:RDD:mainnet': '' } });
  await c.close();
})();"
```

The new master will claim the lock on its next 500 ms poll.

---

## See also

- [`Installation.md`](./Installation.md) — first-time install & basic config (upstream)
- [`bws.example.config.js`](./bws.example.config.js) — annotated config template
- [`packages/bitcore-wallet-client/scripts/`](../bitcore-wallet-client/scripts/) — runnable end-to-end driver scripts (`smoke-redd.js`, `balance-redd.js`, `send-redd.js`)
- BIT-13, BIT-14, BIT-15, BIT-16, BIT-17 — the doc & footgun ticket family this guide closes out
