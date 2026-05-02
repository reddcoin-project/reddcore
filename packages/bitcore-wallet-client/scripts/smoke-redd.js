#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Smoke script — create an RDD wallet against a locally-running BWS,
 * read back the wallet status, and request a receive address.
 *
 * Prereqs (must already be running):
 *   - bitcore-wallet-service on http://localhost:3232/bws/api
 *   - bitcore-node on http://localhost:3000 (BWS proxies blockchain
 *     queries to it for chain RDD via bws.config.js)
 *   - mongod on 27017
 *
 * USAGE:
 *   node scripts/smoke-redd.js
 *
 * Out of scope: build/sign/broadcast a tx — that requires a funded
 * UTXO and a mined block, which is Phase 7's regtest-with-reddcoind
 * territory. This script just exercises the create/read paths.
 */

const { API, Key } = require('../ts_build/src');

const BWS = process.env.BWS_URL || 'http://localhost:3232/bws/api';
const CHAIN = 'rdd';
const NETWORK = 'livenet';

(async () => {
  // 1. Generate a fresh key from a new random mnemonic.
  const key = new Key({ seedType: 'new' });
  const mnemonic = key.get(null, /* includeMnemonic */ true).mnemonic;
  console.log('Generated mnemonic (KEEP for replay tests):');
  console.log('  ', mnemonic);

  // 2. Build credentials for a 1-of-1 RDD livenet wallet.
  const creds = key.createCredentials(null, {
    coin: CHAIN,
    chain: CHAIN,
    network: NETWORK,
    account: 0,
    n: 1
  });
  console.log('Derivation path:', creds.rootPath);

  // 3. Stand up an API client pointed at our local BWS.
  const client = new API({
    baseUrl: BWS,
    verbose: false,
    timeout: 15000
  });
  client.fromString(JSON.stringify(creds));

  // 4. Create the wallet on BWS.
  console.log(`Creating wallet on ${BWS} …`);
  const secret = await client.createWallet('redd-smoke', 'me', 1, 1, {
    chain: CHAIN,
    coin: CHAIN,
    network: NETWORK,
    singleAddress: false,
    useNativeSegwit: false
  });
  console.log('Created. Secret:', secret);

  // 5. Read back the wallet status.
  const status = await client.getStatus({});
  console.log('Wallet:', {
    name: status.wallet.name,
    chain: status.wallet.chain,
    coin: status.wallet.coin,
    network: status.wallet.network,
    m: status.wallet.m,
    n: status.wallet.n,
    status: status.wallet.status,
    addressType: status.wallet.addressType,
    derivationStrategy: status.wallet.derivationStrategy
  });

  // 6. Request a receive address.
  const addr = await client.createAddress({});
  console.log('Receive address:', addr.address);
  console.log('  path:', addr.path);
  console.log('  type:', addr.type);
})().catch(err => {
  console.error('FAILED:', err?.stack || err?.message || err);
  process.exit(1);
});
