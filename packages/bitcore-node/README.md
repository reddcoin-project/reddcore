# Bitcore Node

**A standardized API to interact with multiple blockchain networks**

Currently supporting:
**[Bitcoin](https://bitcoin.org/), [Bitcoin Cash](https://bitcoincash.org/), [Litecoin](https://litecoin.com/), [Dogecoin](https://dogecoin.com/), [Reddcoin](https://www.reddcoin.com/), [Ripple](https://ripple.com/), [Ethereum](https://ethereum.org/) and [Polygon](https://polygon.technology/)**

## Run with Docker

The published Reddcoin-flavored image lives at `reddcoincore/bitcore-node` on Docker Hub.

```bash
docker pull reddcoincore/bitcore-node:latest
```

### Quick local run

The friction-free path on Linux: `--network host` so the container can reach a Mongo and `reddcoind` running on the host without port-mapping gymnastics.

```bash
docker run --rm -it --network host \
  -v /path/to/bitcore.config.json:/bitcore/bitcore.config.json:ro \
  reddcoincore/bitcore-node:latest
```

The image binds the API on **port 3000**, expects MongoDB at `127.0.0.1:27017` (override via `DB_HOST` / `DB_NAME` env vars), and reads its config from `/bitcore/bitcore.config.json` (override via `BITCORE_CONFIG_PATH`).

### Bridge networking (Docker Desktop, hardened hosts)

```bash
docker run --rm -it \
  --add-host=host.docker.internal:host-gateway \
  -p 3000:3000 \
  -e DB_HOST=host.docker.internal \
  -v /path/to/bitcore.config.json:/bitcore/bitcore.config.json:ro \
  reddcoincore/bitcore-node:latest
```

In this mode your `bitcore.config.json` should reference `host.docker.internal` (not `localhost`) for any host-running peers / RPC targets.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `BITCORE_CONFIG_PATH` | `/bitcore/bitcore.config.json` | Where the indexer reads its config from |
| `DB_HOST` | `127.0.0.1` | MongoDB hostname |
| `DB_NAME` | `bitcore` | MongoDB database name |
| `DB_PORT` | `27017` | MongoDB port |
| `DB_USER` / `DB_PASS` | _(empty)_ | MongoDB auth (optional) |

Full config schema lives in [`src/types/Config.ts`](src/types/Config.ts).

### Healthcheck

The image ships with a Docker `HEALTHCHECK` that probes `/api/status/enabled-chains` (no Mongo or P2P dependency — just confirms the API is bound and responding). Visible via `docker inspect --format '{{.State.Health.Status}}' <container>`. Intervals: 30s probe, 60s start-period grace.

### Full stack (mongo + indexer + BWS) in one command

For local-dev or production-shaped deployments, see [`examples/full-stack/`](../../examples/full-stack/) — a docker-compose example that wires mongo + bitcore-node + bitcore-wallet-service together with proper healthcheck-gated startup ordering. README in that directory documents the `reddcoind` host-side configuration prerequisites.

## Getting Started

### Requirements

- Trusted P2P Client with an open RPC endpoint
- MongoDB Server >= v3.4
- make g++ gcc 

### Checkout the repo


```sh
git clone git@github.com:bitpay/bitcore.git
git checkout master
npm install
```

## Setup Guide

### 1. Setup Bitcore config

The definition for all the chain configuration can be found in `src/types/Config.ts`

<details>
<summary>Example bitcore.config.json</summary>
<br>

```json
{
  "bitcoreNode": {
    "chains": {
      "BTC": {
        "mainnet": {
          "chainSource": "p2p",
          "trustedPeers": [
            {
              "host": "127.0.0.1",
              "port": 20008
            }
          ],
          "rpc": {
            "host": "127.0.0.1",
            "port": 20009,
            "username": "username",
            "password": "password"
          }
        },
        "regtest": {
          "chainSource": "p2p",
          "trustedPeers": [
            {
              "host": "127.0.0.1",
              "port": 20020
            }
          ],
          "rpc": {
            "host": "127.0.0.1",
            "port": 20021,
            "username": "username",
            "password": "password"
          }
        }
      },
      "BCH": {
        "mainnet": {
          "parentChain": "BTC",
          "forkHeight": 478558,
          "trustedPeers": [
            {
              "host": "127.0.0.1",
              "port": 30008
            }
          ],
          "rpc": {
            "host": "127.0.0.1",
            "port": 30009,
            "username": "username",
            "password": "password"
          }
        },
        "regtest": {
          "chainSource": "p2p",
          "trustedPeers": [
            {
              "host": "127.0.0.1",
              "port": 30020
            }
          ],
          "rpc": {
            "host": "127.0.0.1",
            "port": 30021,
            "username": "username",
            "password": "password"
          }
        }
      }
    }
  }
}
```

</details>

### 2. Setup Your Blockchain Nodes

<details>
<summary>Example Bitcoin Mainnet Config</summary>

```sh
whitelist=127.0.0.1
txindex=0
listen=1
server=1
irc=1
upnp=1

# Make sure port & rpcport matches the
# bitcore.config.json ports for BTC mainnet

# if using Bitcoin Core v0.17+ prefix
# [main]

port=20008
rpcport=20009
rpcallowip=127.0.0.1

rpcuser=username
rpcpassword=password
```

</details>

### 3. Run Your Blockchain Nodes

<details>
<summary>Example Starting a Bitcoin Node</summary>

```sh
# Path to your bitcoin application and path to the config above
/Applications/Bitcoin-Qt.app/Contents/MacOS/Bitcoin-Qt -datadir=/Users/username/blockchains/bitcoin-core/networks/mainnet/
```

</details>

### 4. Start Bitcore

```sh
npm run node
```

Bitcore will begin using your blockchain nodes to synchronize its own database so that you can use standardized queries to get data from each of your supported blockchains.

## API Documentation

- [REST API parameters and example responses](./docs/api-documentation.md)

- [Websockets API namespaces, event names and parameters](./docs/sockets-api.md)

- [Testing Bitcore-node in RegTest](./docs/wallet-guide.md)

## Contributing

See [CONTRIBUTING.md](https://github.com/bitpay/bitcore/blob/master/CONTRIBUTING.md) on the main bitcore repo for information about how to contribute.

## License

Code released under [the MIT license](https://github.com/bitpay/bitcore/blob/master/LICENSE).

Copyright 2013-2023 BitPay, Inc. Bitcore is a trademark maintained by BitPay, Inc.
