# Bitcore P2P for Reddcoin

[![NPM Package](https://img.shields.io/npm/v/@reddcoinproject/bitcore-p2p-redd.svg?style=flat-square)](https://www.npmjs.org/package/@reddcoinproject/bitcore-p2p-redd)
[![Build Status](https://img.shields.io/travis/reddcoin-project/reddcore.svg?branch=master&style=flat-square)](https://travis-ci.org/reddcoin-project/reddcore)
[![Coverage Status](https://img.shields.io/coveralls/reddcoin-project/reddcore.svg?style=flat-square)](https://coveralls.io/r/reddcoin-project/reddcore?branch=master)

**The peer-to-peer networking protocol for RDD.**

`bitcore-p2p-redd` adds Reddcoin protocol support for Bitcore. The wire format is Bitcoin-derived, with reddcoin's network magic (`0xfbc0b6db`), default protocol version `80016`, the `/Reddcore:VERSION/` user-agent, and BIP155 `sendaddrv2` advertisement.

See [the main Reddcore repo](https://github.com/reddcoin-project/reddcore) for more information.

## Getting Started

```sh
npm install @reddcoinproject/bitcore-p2p-redd
```

In order to connect to the Reddcoin network, you'll need to know the IP address of at least one node of the network, or use [Pool](./docs/pool.md) to discover peers using a DNS seed.

```javascript
var Peer = require('@reddcoinproject/bitcore-p2p-redd').Peer;

var peer = new Peer({host: '127.0.0.1', port: 45444});

peer.on('ready', function() {
  // peer info
  console.log(peer.version, peer.subversion, peer.bestHeight);
});
peer.on('disconnect', function() {
  console.log('connection closed');
});
peer.connect();
```

Then, you can get information from other peers by using:

```javascript
// handle events
peer.on('inv', function(message) {
  // message.inventory[]
});
peer.on('tx', function(message) {
  // message.transaction
});
```

Take a look at this [guide](./docs/peer.md) on the usage of the `Peer` class.

## Contributing

See [Contributing.md](https://github.com/reddcoin-project/reddcore/blob/master/Contributing.md) on the main Reddcore repo for information about how to contribute.

## License

Code released under [the MIT license](https://github.com/reddcoin-project/reddcore/blob/master/LICENSE).

Original work copyright 2013-2025 BitPay, Inc. Bitcore is a trademark maintained by BitPay, Inc. Reddcoin-specific changes copyright the Reddcoin Project contributors.
