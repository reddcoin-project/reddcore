# Full Reddcoin stack — docker-compose example

Spin up MongoDB + `reddcoincore/bitcore-node` + `reddcoincore/bitcore-wallet-service` with one command. Assumes `reddcoind` is running on the host (see [Reddcoind setup](#reddcoind-setup) below).

## Quick start

```bash
# 1. Copy the example configs (they're gitignored once you uncomment
#    them so your edits don't get committed) and edit them:
cp config/bitcore.config.example.json config/bitcore.config.json   # set RPC username/password inside
cp config/bws.config.example.js       config/bws.config.js         # set socketApiKey (see comment in file)
cp .env.example .env                                                # optional — only if you want non-default ports

# 2. Bring up the stack
docker compose -f docker-compose.yml --env-file .env up -d         # if you copied .env
# OR (defaults are fine for most local-dev cases)
docker compose -f docker-compose.yml up -d

# 3. Wait for both APIs to report healthy (~60-90s)
docker compose ps                                                # STATUS column shows "healthy"

# 4. Smoke
curl http://localhost:3000/api/status/enabled-chains             # should list RDD/mainnet
curl http://localhost:3232/bws/api/v1/version/                   # should return BWS serviceVersion JSON

# Tear down
docker compose down                                              # keeps mongo data + bws logs in named volumes
docker compose down -v                                           # ALSO drops the named volumes (full reset)
```

## Stack

| Service | Image | Host port | Purpose |
|---|---|---|---|
| `mongo` | `mongo:6` | _(not exposed)_ | Persistent storage for both indexer and BWS |
| `bitcore-node` | `reddcoincore/bitcore-node:latest` | `3000` (`$BITCORE_NODE_PORT`) | Indexer. P2P + RPC to reddcoind, REST + Socket.IO to BWS |
| `bitcore-wallet-service` | `reddcoincore/bitcore-wallet-service:latest` | `3232` (`$BWS_PORT`) | Wallet API. Spawns 6 workers via `start-docker.sh` |

All three live on a private bridge network (`reddstack`). Inter-container DNS resolves by service name (`mongo`, `bitcore-node`).

`bitcore-wallet-service` waits for `bitcore-node`'s healthcheck to flip to healthy before it starts (via `depends_on: condition: service_healthy` — gated on the BIT-23 healthchecks baked into both images).

## Reddcoind setup

`reddcoin/core` on Docker Hub uses an obsolete manifest format that modern Docker can't pull, so this stack does **not** run reddcoind in a container. The indexer talks to reddcoind on the **host** via `host.docker.internal:host-gateway` (which resolves to the docker bridge gateway on Linux).

For this to work, your host's `reddcoin.conf` needs to:

1. Bind RPC to all interfaces (or at least the docker bridge gateway), since the default `127.0.0.1`-only binding won't be reachable from inside containers:
   ```
   rpcbind=0.0.0.0
   rpcallowip=172.16.0.0/12          # docker default bridge subnets
   rpcallowip=127.0.0.1
   ```
2. Use a dedicated RPC user/password for the indexer:
   ```
   rpcuser=indexer
   rpcpassword=<long-random-string>
   ```
3. Match the username/password in `config/bitcore.config.json` (under `RDD.mainnet.rpc`).

P2P (45444) is normally already bound on `0.0.0.0` and needs no extra config. Verify with `ss -ltn | grep 4544`.

⚠ **Security**: opening RPC beyond `127.0.0.1` deserves a real password and a firewall. Don't expose 45443 to the public internet.

## Customizing

- **Other ports**: `cp .env.example .env`, edit `BITCORE_NODE_PORT` / `BWS_PORT`, restart.
- **Other chains** (BTC/BCH/ETH/etc.): add their entries to `config/bitcore.config.json` under `bitcoreNode.chains`. The indexer image already includes upstream's chain modules; just configure them.
- **Mongo persistence**: data lives in the `mongo-data` named volume. `docker volume inspect reddstack_mongo-data` to find the host path.
- **External Mongo**: drop the `mongo` service block, change `storageOpts.mongoDb.uri` in both configs to your Mongo URI, drop the `mongo` references from the two `depends_on` blocks.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `bitcore-node` exits with `MongoNetworkError ECONNREFUSED` | mongo wasn't ready — already gated by `depends_on: service_healthy`, but if you see it, mongo's healthcheck timed out. Check `docker compose logs mongo`. |
| `bitcore-node` logs `Not connected to peer: host.docker.internal:45444` | reddcoind isn't running, isn't listening on P2P 45444, or the host firewall blocks the bridge subnet. `nc -zv host.docker.internal 45444` from inside the container should succeed. |
| `bitcore-node` logs `Error: connect ECONNREFUSED ...:45443` | reddcoind RPC is bound to `127.0.0.1` only. Add `rpcbind=0.0.0.0` + `rpcallowip=...` to `reddcoin.conf` and restart reddcoind. |
| `bitcore-node` logs `... Unauthorized` against the RPC | RPC user/password mismatch between `reddcoin.conf` and `config/bitcore.config.json`. |
| `bws` logs `Checksum mismatch` from `Bitcore.PrivateKey()` | `socketApiKey` in `config/bws.config.js` is still the placeholder. Generate a real WIF — see the comment in `config/bws.config.js`. |
| `bws` logs `Error connecting to V8 (rdd/mainnet)` | bitcore-node isn't healthy yet, or BWS started before its healthcheck flipped (shouldn't happen with `depends_on: service_healthy` but worth checking `docker compose ps`). |

## See also

- `STACK.md` — wire-level walkthrough of the full Reddcoin stack
- `packages/bitcore-wallet-service/OPERATING.md` — operational deep-dive on BWS
- `packages/bitcore-node/README.md` — bitcore-node basics (no Docker section yet — tracked under BIT-26)
