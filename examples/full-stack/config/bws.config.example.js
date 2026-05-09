// BWS config for the docker-compose example. Reddcoin-only.
// Hostnames are docker-network service names (mongo, bitcore-node).

module.exports = {
  basePath: '/bws/api',
  disableLogs: false,
  port: 3232,

  // Set true if your reddcoind is regtest. For mainnet, leave false.
  allowRegtest: false,

  storageOpts: {
    mongoDb: {
      uri: 'mongodb://mongo:27017/bws',
      dbname: 'bws'
    }
  },

  // bcmonitor + emailservice + push communicate via this in-process
  // broker; default port 3380 inside the container.
  messageBrokerOpts: {
    messageBrokerServer: { url: 'http://localhost:3380' }
  },

  blockchainExplorerOpts: {
    rdd: {
      // RDD is self-hosted — point at the in-network bitcore-node.
      livenet: { url: 'http://bitcore-node:3000' },
      testnet: { url: 'http://bitcore-node:3000', regtestEnabled: true }
    },

    // socketApiKey: required for bcmonitor's wallet-room subscriptions.
    // Generate one with:
    //   docker run --rm reddcoincore/bitcore-wallet-service:latest \
    //     node -e "console.log(new (require('@bitpay-labs/bitcore-lib').PrivateKey)('livenet').toWIF())"
    // and either replace the placeholder below OR pass via env override.
    socketApiKey: 'REPLACE_ME_WIF_PRIVATE_KEY'
  },

  // Where bws.js serves its static assets from. Inside the container
  // /tmp is writable; operators wanting persistence should mount a
  // volume here.
  staticRoot: '/tmp/static'
};
