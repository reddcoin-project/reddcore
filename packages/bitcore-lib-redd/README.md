# Bitcore JavaScript Library for Reddcoin

[![NPM Package](https://img.shields.io/npm/v/@reddcoinproject/bitcore-lib-redd.svg?style=flat-square)](https://www.npmjs.org/package/@reddcoinproject/bitcore-lib-redd)
[![CircleCI](https://dl.circleci.com/status-badge/img/gh/reddcoin-project/reddcore/tree/master.svg?style=shield&task=bitcore-lib-redd)](https://dl.circleci.com/status-badge/redirect/gh/reddcoin-project/reddcore/tree/master)
[![Coverage Status](https://img.shields.io/coveralls/reddcoin-project/reddcore.svg?style=flat-square)](https://coveralls.io/r/reddcoin-project/reddcore)

**A pure and powerful JavaScript library for Reddcoin.**

## Principles

Reddcoin is a peer-to-peer cryptocurrency built around social tipping and engagement, with a hybrid Proof-of-Work / Proof-of-Stake protocol. The decentralized nature of the Reddcoin network allows for highly resilient infrastructure, and the developer community needs reliable, open-source tools to implement Reddcoin apps and services. The Bitcore JavaScript Library (this Reddcoin fork) provides a reliable API for JavaScript apps that need to interface with Reddcoin.

## Get Started

Clone the Reddcore monorepo and `npm install`:
```sh
git clone https://github.com/reddcoin-project/reddcore.git
npm install
```
`cd` into bitcore-lib-redd:
```sh
cd packages/bitcore-lib-redd
```

## Building the Browser Bundle

To build a bitcore-lib-redd full bundle for the browser:

```sh
gulp browser
```

This will generate files named `bitcore-lib-redd.js` and `bitcore-lib-redd.min.js`.

## Running Tests

```sh
npm test
```

You can also run just the Node.js tests with `gulp test:node`, just the browser tests with `gulp test:browser` or create a test coverage report (you can open `coverage/lcov-report/index.html` to visualize it) with `gulp coverage`.

## Documentation 

### Addresses and Key Management

- [Addresses](docs/address.md)
- [Using Different Networks](docs/networks.md)
- [Private Keys](docs/privatekey.md) and [Public Keys](docs/publickey.md)
- [Hierarchically-derived Private and Public Keys](docs/hierarchical.md)

### Payment Handling

- [Using Different Units](docs/unit.md)
- [Acknowledging and Requesting Payments: Reddcoin URIs](docs/uri.md)
- [The Transaction Class](docs/transaction.md)
- [Unspent Transaction Output Class](docs/unspentoutput.md)

### Reddcoin Internals

- [Scripts](docs/script.md)
- [Block](docs/block.md)

### Extra

- [Crypto](docs/crypto.md)
- [Encoding](docs/encoding.md)

### Module Development

- [Browser Builds](docs/browser.md)

### Modules

Some functionality is implemented as a module that can be installed separately:

- [Peer to Peer Networking](https://github.com/reddcoin-project/reddcore/tree/master/packages/bitcore-p2p-redd)
- [Reddcoin Core JSON-RPC](https://github.com/bitpay/bitcoind-rpc)
- [Payment Channels](https://github.com/bitpay/bitcore-channel)
- [Mnemonics](https://github.com/reddcoin-project/reddcore/tree/master/packages/bitcore-mnemonic)
- [Elliptical Curve Integrated Encryption Scheme](https://github.com/bitpay/bitcore-ecies)
- [Blockchain Explorers](https://github.com/bitpay/bitcore-explorers)
- [Signed Messages](https://github.com/bitpay/bitcore-message)

## Examples

- [Generate a random address](docs/examples.md#generate-a-random-address)
- [Generate a address from a SHA256 hash](docs/examples.md#generate-a-address-from-a-sha256-hash)
- [Import an address via WIF](docs/examples.md#import-an-address-via-wif)
- [Create a Transaction](docs/examples.md#create-a-transaction)
- [Sign a Reddcoin message](docs/examples.md#sign-a-reddcoin-message)
- [Verify a Reddcoin message](docs/examples.md#verify-a-reddcoin-message)
- [Create an OP RETURN transaction](docs/examples.md#create-an-op-return-transaction)
- [Create a 2-of-3 multisig P2SH address](docs/examples.md#create-a-2-of-3-multisig-p2sh-address)
- [Spend from a 2-of-2 multisig P2SH address](docs/examples.md#spend-from-a-2-of-2-multisig-p2sh-address)

## Security

We're using the Bitcore JavaScript Library in production, as are many others, but please use common sense when doing anything related to finances! We take no responsibility for your implementation decisions.

If you find a security issue, please open a private security advisory on the [Reddcore repo](https://github.com/reddcoin-project/reddcore/security/advisories).

## Contributing

See [Contributing.md](https://github.com/reddcoin-project/reddcore/blob/master/Contributing.md) on the main Reddcore repo for information about how to contribute.

## License

Code released under [the MIT license](https://github.com/reddcoin-project/reddcore/blob/master/LICENSE).

Original work copyright 2013-2025 BitPay, Inc. Bitcore is a trademark maintained by BitPay, Inc. Reddcoin-specific changes copyright the Reddcoin Project contributors.
