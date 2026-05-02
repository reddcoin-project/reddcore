# Reddcore Monorepo

  <p align="center">
  <a href="https://opensource.org/licenses/MIT/" target="_blank"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-blue.svg" style="display: inherit;"/></a>
  <a href="https://github.com/reddcoin-project/reddcore/graphs/contributors">
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors/reddcoin-project/reddcore">
  </a>
</p>

**Reddcoin-focused fork of [bitpay/bitcore](https://github.com/bitpay/bitcore), pinned at upstream v11.8.1.**

This repository ships first-class [Reddcoin (REDD)](https://www.reddcoin.com) support — chain library, P2P protocol, indexing node, and wallet stack — alongside the upstream BTC, BCH, ETH, DOGE, LTC, MATIC, XRP, SOL, and other chains. Reddcoin packages are published to npm under the [`@reddcoinproject`](https://www.npmjs.com/org/reddcoinproject) scope.

## Reddcoin packages

- [`@reddcoinproject/bitcore-lib-redd`](packages/bitcore-lib-redd) — Pure JavaScript Reddcoin library (PoS-aware, `nTime`, scrypt-friendly)
- [`@reddcoinproject/bitcore-p2p-redd`](packages/bitcore-p2p-redd) — Reddcoin P2P networking
- [`@reddcoinproject/bitcore-node`](packages/bitcore-node) — Indexing node with REDD module
- [`@reddcoinproject/bitcore-wallet-service`](packages/bitcore-wallet-service) — Wallet service
- [`@reddcoinproject/bitcore-wallet-client`](packages/bitcore-wallet-client) — Wallet client SDK

## Upstream packages (kept as-is, not republished)

### Applications
- [Bitcore Node](packages/bitcore-node) - Standardized API across multiple blockchain networks
- [Bitcore Wallet Client](packages/bitcore-wallet-client) - Client for Bitcore Wallet Service
- [Bitcore Wallet Service](packages/bitcore-wallet-service) - Coordination service for multisig wallets
- [Bitcore CLI](packages/bitcore-cli) - Command-line interface for BWS and BWC
- [Insight](packages/insight) - Block explorer web UI (with Reddcoin support)

### Libraries
- [Bitcore Lib](packages/bitcore-lib) - JavaScript library for Bitcoin
- [Bitcore Lib Cash](packages/bitcore-lib-cash) - Bitcoin Cash
- [Bitcore Lib Doge](packages/bitcore-lib-doge) - Dogecoin
- [Bitcore Lib Litecoin](packages/bitcore-lib-ltc) - Litecoin
- [Bitcore Mnemonic](packages/bitcore-mnemonic) - BIP39 mnemonic codes
- [Bitcore P2P](packages/bitcore-p2p) - Bitcoin peer-to-peer protocol
- [Bitcore P2P Cash](packages/bitcore-p2p-cash) - Bitcoin Cash peer-to-peer protocol
- [Crypto Wallet Core](packages/crypto-wallet-core) - Coin-agnostic wallet primitives
- [Crypto RPC](packages/crypto-rpc) - Common interface to chain RPC endpoints

### Extras
- [Bitcore Build](packages/bitcore-build) - Gulp tasks helper
- [Bitcore Client](packages/bitcore-client) - Wallet helper using bitcore-node

## Quick start

```bash
npm install                 # Lerna bootstrap + compile (postinstall)
npm run node                # Start bitcore-node
npm run bws                 # Start bitcore-wallet-service
npm test:bitcore-lib-redd   # Run REDD lib tests
```

For the **whole stack** (reddcoind → bitcore-node → BWS → BWC) including
config-glue, smoke walkthrough, and a footgun atlas, see [STACK.md](STACK.md).
Per-package operator and developer guides:

- [`packages/bitcore-wallet-service/OPERATING.md`](packages/bitcore-wallet-service/OPERATING.md)
- [`packages/bitcore-wallet-client/USAGE.md`](packages/bitcore-wallet-client/USAGE.md)

See [MIGRATION.md](../MIGRATION.md) (in the parent directory) for the
phase-by-phase plan to keep this fork in sync with upstream.

## Versioning

We track upstream's version (currently `11.8.1`). Reddcoin-specific
patch releases append a `-redd.N` suffix. See [CONTRIBUTING.md](Contributing.md)
for the release process.

## Contributing

See [Contributing.md](Contributing.md) (inherited from upstream — Reddcoin-
specific contribution notes are forthcoming).

## License

Code released under [the MIT license](LICENSE).

Original work copyright 2013-2025 BitPay, Inc. Bitcore is a trademark
maintained by BitPay, Inc. Reddcoin-specific changes copyright the
Reddcoin Project contributors.
