# Reddcore stack guide

How to bring the **whole** Reddcoin wallet stack up — daemon to wallet
client — on one host, with a working flow proven all the way from
"create a wallet" to "broadcast a confirmed transaction."

This is the single integration document the per-package guides assume:

- [`packages/bitcore-wallet-service/OPERATING.md`](packages/bitcore-wallet-service/OPERATING.md) — runs the BWS layer
- [`packages/bitcore-wallet-client/USAGE.md`](packages/bitcore-wallet-client/USAGE.md) — drives BWS programmatically
- [`MIGRATION.md`](../MIGRATION.md) (parent dir of the repo) — the historical record of how RDD got wired in

If you're starting from a clean checkout against a synced `reddcoind`,
follow this guide top to bottom and you should have a working stack in
roughly an hour. Most of that time is `npm install` and the first
build; the actual configuration is small.

---

## Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Bring-up order](#bring-up-order)
4. [Config-file glue](#config-file-glue)
5. [Smoke walkthrough](#smoke-walkthrough)
6. [Operational concerns](#operational-concerns)
7. [Footgun atlas](#footgun-atlas)

---

## Architecture

```
                ┌─────────────────────────────────────────────────────────┐
                │                     Mongo (host:27017)                  │
                │   db: bitcore  ←—— bitcore-node    db: bws  ←—— BWS     │
                └─────────────────────────────────────────────────────────┘
                          ▲                                ▲
                          │ writes blocks/txs/coins         │ writes wallets/
                          │                                 │ addresses/txproposals
                          │                                 │
                  ┌───────┴────────┐                ┌───────┴────────┐
                  │  bitcore-node  │ ◀── REST ─────│  bws.js (3232) │
                  │  (host:3000)   │                │                │
                  │                │ ◀── Socket.IO ─│  bcmonitor.js  │
                  │  REDD module   │                └────────────────┘
                  └───────┬────────┘                        ▲
                          │                                 │
                          │ JSON-RPC                        │ HTTP
                          │   :45443                        │
                          │                                 │
                          │ P2P                       ┌─────┴──────┐
                          │   :45444                  │   BWC      │
                          ▼                           │ (your code) │
                 ┌────────────────┐                   └─────────────┘
                 │   reddcoind    │
                 │  (livenet/     │
                 │  testnet/      │
                 │  regtest)      │
                 └────────────────┘
```

**What each piece does:**

- **`reddcoind`** — the canonical Reddcoin node. Source of truth for chain state. Runs unmodified upstream.
- **`bitcore-node`** — indexer. Subscribes to `reddcoind` over P2P, queries it via JSON-RPC for fill-ins, persists blocks / txs / coin records into Mongo (`bitcore` db), and exposes a REST API + Socket.IO at `:3000`. Includes the REDD module (`packages/bitcore-node/src/modules/reddcoin/`) that wires Reddcoin's PoSV semantics in.
- **`bws.js`** — the wallet-service HTTP API at `:3232/bws/api`. Owns wallet records, addresses, txproposals; persists in Mongo (`bws` db). Reaches into `bitcore-node` for chain state via REST.
- **`bcmonitor.js`** — sibling of `bws.js`. Subscribes to `bitcore-node`'s Socket.IO `block` events for each chain and feeds them into BWS's confirmation counter. Without it, BWS reports `confirmations: 0` even on confirmed UTXOs.
- **BWC** — the wallet client (this is your code, or one of the smoke scripts under `packages/bitcore-wallet-client/scripts/`). Talks HTTP to BWS.

Mongo is shared between `bitcore-node` and BWS but they use different databases. There's no conceptual reason to split them onto separate mongos for a single-host deploy; if you scale out, the natural break is to give each its own.

---

## Prerequisites

| Component | Required version | Notes |
|---|---|---|
| `reddcoind` | Any current release | Configured for RPC + P2P, **fully synced** to tip. RPC creds on file. |
| Mongo | 3.4 – 4.4 | The `mongodb` driver bundled in BWS (`3.5.9`) speaks wire-versions ≤7. A 5.x mongod won't work; bitcore-node's needs are similar. |
| Node.js | ≥ 22 | Both bitcore-node and BWS pin this in `package.json#engines.node`. |
| Linux / macOS | any | The smoke scripts have been exercised on Linux; macOS should work but isn't routinely tested. |

If you're operating against the public BitPay endpoints for non-RDD chains, no separate daemon is needed for those — the `blockchainExplorerOpts` in `bws.config.js` points at `https://api.bitcore.io` and `bitcore-node` is bypassed. RDD specifically has no public endpoint so it must be self-hosted.

---

## Bring-up order

The chain is **mongo → reddcoind → bitcore-node → BWS** (`bws.js`, then `bcmonitor.js`). Each layer needs the one below it healthy before it can come up. Bring them up in order; if a step fails, fix it before moving on.

### 1. Mongo

Either system mongod (init.d / systemd / brew services) or a docker-compose service. Confirm:

```sh
$ mongod --version | head -1
db version v3.6.x   # 3.4 – 4.4 acceptable
$ ss -tnlp | grep 27017
LISTEN 0  *:27017  ...
```

Fast smoke (without the wire-version-incompatible `mongosh`):

```sh
node -e "const {MongoClient}=require('mongodb');(async()=>{
  const c=new MongoClient('mongodb://127.0.0.1:27017');
  await c.connect();
  console.log('mongo ok');
  await c.close();
})()"
```

### 2. reddcoind

Confirm RPC works and the node is at tip:

```sh
$ reddcoin-cli getblockchaininfo | head -8
{
  "chain": "main",
  "blocks": 6414327,
  "headers": 6414327,
  "verificationprogress": 0.99999,
  ...
```

If `verificationprogress` is < 1.0 the daemon is still syncing; bitcore-node will follow along but you won't see the tip until reddcoind catches up.

### 3. bitcore-node

```sh
cd packages/bitcore-node

# First-time only: build
npm run clean && npm run build

# Run
node build/src/server.js > .logs/node.log 2>&1 &
```

`bitcore-node` reads its config from `~/Projects/bitpay/reddcore/bitcore.config.json` (gitignored). The **RDD chain block** must point at your reddcoind:

```jsonc
{
  "bitcoreNode": {
    "chains": {
      "RDD": {
        "mainnet": {
          "module": "./reddcoin",
          "chainSource": "p2p",
          "trustedPeers": [{ "host": "localhost", "port": 45444 }],
          "rpc": {
            "host": "localhost",
            "port": 45443,
            "username": "<your-rpc-user>",
            "password": "<your-rpc-password>"
          }
        }
      }
    }
  }
}
```

Healthy startup signature in the log:

```
info :: Registering module for RDD:mainnet: ./reddcoin
info :: Connected to peer: localhost:45444 | Chain: RDD | Network: mainnet
info :: This worker is now the syncing node for RDD mainnet
info :: MT Syncing... | Chain: RDD | ...
info :: Started API Service on port 3000
```

Smoke:

```sh
$ curl http://localhost:3000/api/RDD/mainnet/block/tip
{"hash":"...","height":6414327,...}
```

If the master sits on `Another node is the primary syncing node` for more than ~5 minutes, you have a stale heartbeat in mongo. Clear it (see [`OPERATING.md`'s restart section](packages/bitcore-wallet-service/OPERATING.md#restarts-and-graceful-stop)).

### 4. BWS

Two processes, in this order:

```sh
cd packages/bitcore-wallet-service

# First-time only: copy and edit config
cp bws.example.config.js bws.config.js
$EDITOR bws.config.js  # fill any field marked // REQUIRED

# Build (prod mode skips test files; the default `build` includes them
# and may fail compilation on stale tests)
npm run clean && npm run build:prod

# Start the API
node ./ts_build/src/bws.js > logs/bws.log 2>&1 &

# Start the confirmation tracker
node ./ts_build/src/bcmonitor/bcmonitor.js > logs/bcmonitor.log 2>&1 &
```

Healthy log signatures:

```
# bws.log:
info :: Listening on port: 3232
info :: Connection established to db: mongodb://0.0.0.0:27017/bws
info :: BWS running

# bcmonitor.log:
info :: Blockchain monitor started
info :: Connected to wallets V8 (rdd/mainnet) @ http://localhost:3000
info :: Connected to block V8 (rdd/mainnet) @ http://localhost:3000
```

Smoke:

```sh
$ curl http://localhost:3232/bws/api/v1/version/
{"serviceVersion":"bws-11.8.1"}
```

Per-service detail and the full common-errors troubleshooting table is in [`packages/bitcore-wallet-service/OPERATING.md`](packages/bitcore-wallet-service/OPERATING.md).

---

## Config-file glue

The whole stack is configured by **three** files. Each links one layer to the next.

| File | Owned by | Tells which layer about which |
|---|---|---|
| `~/Projects/bitpay/reddcore/bitcore.config.json` | bitcore-node | reddcoind RPC creds + P2P trusted peers (per-chain `chains.<CHAIN>.<network>` block) |
| `packages/bitcore-wallet-service/bws.config.js` | BWS (both `bws.js` and `bcmonitor.js`) | bitcore-node URL (per-chain `blockchainExplorerOpts.<chain>.<network>.url`) + Mongo URI + the `socketApiKey` WIF used by bcmonitor |
| `packages/bitcore-wallet-client/.smoke-state/redd-livenet.creds.json` | BWC scripts | The wallet's persisted credentials JSON (BWS URL + xPub + walletId + walletPrivKey + requestPrivKey). Per-wallet, per-host. Mode 0600. Gitignored. |

**Key wiring fact:** the URL from `bws.config.js`'s `blockchainExplorerOpts.rdd.livenet.url` is *the same* URL bitcore-node serves on. If they're on the same host, that's `http://localhost:3000`. The chain string `"rdd"` is lowercase here even though bitcore-node's API path is `/api/RDD/mainnet/...` (uppercase) — BWS uppercases internally.

The `socketApiKey` WIF in `blockchainExplorerOpts.socketApiKey` is consumed *only* by bcmonitor.js when it tries to subscribe to bitcore-node's authenticated `wallets-room`. The block-events room is public; without a registered pubkey on the bitcore-node side, the wallets-room subscription fails (auth-rejected) but the block-events subscription succeeds and that's what feeds the confirmation counter. The placeholder `'socketApiKey'` literal in the upstream example fails Base58Check decode and crashes bcmonitor at startup — see the [Footgun atlas](#footgun-atlas).

---

## Smoke walkthrough

Once all four daemons are up and serving, the round-trip we proved out
in this codebase:

```sh
cd packages/bitcore-wallet-client

# 1. Create a fresh wallet on BWS, persist credentials to disk.
node scripts/smoke-redd.js
#  → mnemonic: photo cram room imitate recipe fresh shadow ball tide local among pig
#  → Receive address: Ro9wrxbHyJZXhmGTGi9tiT4QMiUrxrd8A5
#  → persisted credentials to .smoke-state/redd-livenet.creds.json

# 2. Send some RDD to the receive address (from any other Reddcoin
#    wallet you control — reddcoind's debug console, a desktop wallet,
#    an exchange withdrawal).

# 3. Confirm bitcore-node sees it.
curl http://localhost:3000/api/RDD/mainnet/address/Ro9wrxbHyJZXhmGTGi9tiT4QMiUrxrd8A5/balance
#  → {"confirmed":1000000000,"unconfirmed":0,"balance":1000000000}

# 4. Confirm BWS sees it (via the V8 → bitcore-node bridge).
node scripts/balance-redd.js
#  → totalAmount: 1000000000 sats
#  → UTXOs (1): ...:0 1000000000 sats Ro9wr... confirmations=N

# 5. Spend it back out — exercises the createTxProposal → publishTxProposal
#    → key.sign → pushSignatures → broadcastTxProposal flow.
node scripts/send-redd.js R<destination-address> 999000000
#  → Broadcast: txid ...

# 6. Confirm the broadcast tx on the chain.
curl http://localhost:3000/api/RDD/mainnet/tx/<txid>
#  → confirmations: 0 → 1 once it makes it into a block (60s)
```

Live txid from this codebase's bring-up:
[`7f434367d078baee0103729fcc81ec0f69f5689e1bf644f094c81159bbb72dfa`](http://localhost:3000/api/RDD/mainnet/tx/7f434367d078baee0103729fcc81ec0f69f5689e1bf644f094c81159bbb72dfa) (mined into block 6,414,327).

Each script is documented inline; [USAGE.md](packages/bitcore-wallet-client/USAGE.md) walks through what they're doing in prose.

---

## Operational concerns

### Logs

Each process writes to its own log:

```
packages/bitcore-node/.logs/node-YYYYMMDD-HHMMSS.log
packages/bitcore-wallet-service/logs/bws.log
packages/bitcore-wallet-service/logs/bcmonitor.log
```

If you start via `npm run start` in BWS, `start.sh` populates `packages/bitcore-wallet-service/logs/<service>.log` for each of the six auxiliary services and pid-files in `pids/`.

### Stateful surfaces

| Surface | Stateful? | Recovery |
|---|---|---|
| `reddcoind` block storage | Yes, but reproducible | Delete + re-sync from network |
| Mongo `bitcore` db (bitcore-node index) | Yes, but reproducible | Drop the db, restart bitcore-node, it will re-index from reddcoind. Slow (hours for a fully-synced mainnet). |
| Mongo `bws` db (wallet records) | **Yes, irreplaceable** | Wallet records linked to user keys live here. Back this up. Losing it means all clients have to recreate via `serverAssistedImport`, which works only if their xPubs are still derivable from their mnemonics. |
| `bws.config.js` | Per-host config | Reproducible from `bws.example.config.js` + your local secrets |
| `bitcore.config.json` | Per-host config | Reproducible from `bitcore.config.json.bak` (we ship a sanitised version) + your local RPC creds |
| BWC `.smoke-state/redd-*.creds.json` | **Yes, irreplaceable** | The wallet creator's request key lives only here. See [USAGE.md's persistence section](packages/bitcore-wallet-client/USAGE.md#persist-credentials--and-never-lose-a-mnemonic) — losing the creds JSON without the mnemonic = lost wallet. |

### Restart in dependency order

To stop:

```sh
# stop in reverse-dependency order so dependents don't see TCP errors
pkill -TERM -f "bcmonitor/bcmonitor.js"
pkill -TERM -f "ts_build/src/bws.js"
pkill -TERM -f "bitcore-node/build/src/server.js"
# reddcoind and mongo usually keep running
```

To start:

```sh
# (mongo + reddcoind already running)
cd packages/bitcore-node           && node build/src/server.js              > .logs/node.log 2>&1 &
cd ../bitcore-wallet-service       && node ./ts_build/src/bws.js            > logs/bws.log 2>&1 &
                                      node ./ts_build/src/bcmonitor/bcmonitor.js > logs/bcmonitor.log 2>&1 &
```

Confirm each layer is healthy before starting the next — see the smoke commands in [Bring-up order](#bring-up-order).

### Backups

Minimum-viable backup for a self-hosted wallet operator:

1. **The Mongo `bws` db**, daily. `mongodump --db bws` → encrypted offsite. This is the only thing that's not reproducible.
2. **Each user's BWC creds JSON + mnemonic** — operator's responsibility to communicate; the persisted files under `.smoke-state/` are individual users' problem, not yours, but if you build a hosted UI you're inheriting that responsibility.
3. **`bitcore.config.json` + `bws.config.js`** — just because losing them is annoying. Both are reproducible if you remember what was in them.

Bitcore-node's index can always be rebuilt from a synced reddcoind; its Mongo `bitcore` db is not a backup target.

---

## Footgun atlas

Things we hit live during the BIT-7 → BIT-15 thread that future operators will likely hit too. Each entry has a one-line "if you see this, check that" pointer to the canonical fix or doc.

| Symptom | Where to look |
|---|---|
| `BADREQUEST: Invalid extended public key` on wallet create | One of five `Bitcore_` maps in BWS doesn't have your chain. See [`OPERATING.md` "Common errors"](packages/bitcore-wallet-service/OPERATING.md#common-errors). |
| `Failed state: fee-too-high at <getBitcoreTx()>` on `createTxProposal` | `Defaults.MAX_TX_FEE[<chain>]` undefined in `bws/src/lib/common/defaults.ts`. Fixed for RDD in `4d0d2e92b`. |
| `Cannot read properties of undefined (reading 'validateAddress')` from bitcore-node | bitcore-node started before the cwc rebuild. Stop bitcore-node, `cd packages/crypto-wallet-core && npm run compile`, restart. |
| `Cannot read properties of undefined (reading 'map')` at `samplePoints` | The `/v1/feelevels/` crash on chains with empty `feeStats`. [BIT-13](https://reddink.youtrack.cloud/issue/BIT-13). Don't hit `/feelevels/` until `bcmonitor.js` has run for ≥100 blocks; or pass `feePerKb` explicitly. |
| `Checksum mismatch` from `Bitcore.PrivateKey._transformWIF` (kills bcmonitor at startup) | `socketApiKey: 'socketApiKey'` placeholder in `bws.config.js`. Replace with a real WIF: `node -e 'console.log(new (require("@bitpay-labs/bitcore-lib").PrivateKey)("livenet").toWIF())'` |
| `Error joining room Authentication failed /<CHAIN>/<network>` (bcmonitor) | Harmless. Block-events room (public) still works. Wallets-room rejection just means no per-address push notifications. |
| `Error connecting to message broker server @ http://localhost:3380` | Harmless for single-process deployments. Start `messagebroker.js` if you have multiple bws workers. |
| `Wallet does not exist` from `serverAssistedImport` | Either the chain isn't in `chainPermutations` at `bwc/src/lib/api.ts:3627`, or the mnemonic doesn't match any registered xPub. Use `scripts/check-mnemonic.js` to verify locally. |
| `Server response could not be verified` on `createTxProposal` with `sendMax: true` | Upstream verifier bug — the `args.outputs[0].amount` is undefined while server-computed isn't. Pass an explicit amount close to balance and let the change output absorb dust. |
| `MongoServerSelectionError` from `mongosh` | Wire-version mismatch — `mongosh` is too new for the older `mongod`. Use a node script via `MongoClient` for ad-hoc queries. BWS itself is fine. |
| BWS reports `confirmations: 0` on a confirmed UTXO | `bcmonitor.js` isn't running, or hasn't caught up. Compare against `curl http://localhost:3000/api/<chain>/<network>/address/<addr>/balance` for chain truth. |
| Lost mnemonic / lost funds | The cautionary tale. **Always persist `client.toString()` and the mnemonic to disk before printing or exiting** — see [USAGE.md](packages/bitcore-wallet-client/USAGE.md#persist-credentials--and-never-lose-a-mnemonic). 10 RDD locked permanently in this session because of `tail -25`. |

---

## See also

- [`packages/bitcore-wallet-service/OPERATING.md`](packages/bitcore-wallet-service/OPERATING.md) — BWS operator guide; full common-errors troubleshooting
- [`packages/bitcore-wallet-service/Installation.md`](packages/bitcore-wallet-service/Installation.md) — first-time install (upstream)
- [`packages/bitcore-wallet-service/bws.example.config.js`](packages/bitcore-wallet-service/bws.example.config.js) — annotated config template
- [`packages/bitcore-wallet-client/USAGE.md`](packages/bitcore-wallet-client/USAGE.md) — programmatic BWC usage
- [`packages/bitcore-wallet-client/scripts/`](packages/bitcore-wallet-client/scripts/) — runnable smoke scripts
- [`MIGRATION.md`](../MIGRATION.md) (parent dir) — Phase 7 acceptance and the full RDD-wiring history
- BIT-7 / BIT-8 / BIT-9 / BIT-12 / BIT-13 / BIT-14 / BIT-15 / BIT-16 — the wallet-stack RDD ticket family this guide closes out
