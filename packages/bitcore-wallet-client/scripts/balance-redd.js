#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Re-import the wallet created by smoke-redd.js (same mnemonic) and
 * read its balance from BWS. Proves the BWS → V8 → bitcore-node path
 * is actually surfacing live blockchain state, not just creating
 * empty records in Mongo.
 *
 * USAGE:
 *   node scripts/balance-redd.js
 *
 * Override the mnemonic by exporting MNEMONIC, e.g.:
 *   MNEMONIC='word1 word2 …' node scripts/balance-redd.js
 */

const fs = require('fs');
const path = require('path');
const { API } = require('../ts_build/src');

const BWS = process.env.BWS_URL || 'http://localhost:3232/bws/api';
const NETWORK = process.env.NETWORK || 'livenet';
const STATE_DIR = path.join(__dirname, '..', '.smoke-state');
const CREDS_PATH = path.join(STATE_DIR, `redd-${NETWORK}.creds.json`);

(async () => {
  // Prefer the persisted creds from smoke-redd.js — that's the original
  // copayer credentials so BWS recognises us without going through
  // serverAssistedImport (which fails for partially-discovered wallet
  // states and requires the mnemonic). Fall back to mnemonic import
  // (env var MNEMONIC) only if the creds file doesn't exist.
  let clients;
  if (fs.existsSync(CREDS_PATH)) {
    console.log(`Loading creds from ${CREDS_PATH}`);
    const client = new API({ baseUrl: BWS, verbose: false, timeout: 15000 });
    client.fromString(fs.readFileSync(CREDS_PATH, 'utf8'));
    clients = [client];
  } else {
    const words = process.env.MNEMONIC;
    if (!words) {
      console.error('No persisted creds and no MNEMONIC env — nothing to import.');
      process.exit(1);
    }
    console.log(`Server-assisted import against ${BWS} …`);
    clients = await API.serverAssistedImport(
      { words, includeTestnetWallets: false, includeLegacyWallets: false },
      { baseUrl: BWS, verbose: false, timeout: 15000 }
    );
  }
  if (!clients?.length) {
    console.error('No wallets found.');
    process.exit(1);
  }

  for (const client of clients) {
    const status = await client.getStatus({ includeExtendedInfo: true });
    const w = status.wallet;
    console.log('---');
    console.log('Wallet:', w.name, '(', w.chain, w.network, ')');
    console.log('  status:', w.status, ' m/n:', w.m, '/', w.n);
    console.log('Balance:');
    console.log('  totalAmount        :', status.balance.totalAmount, 'sats');
    console.log('  totalConfirmed     :', status.balance.totalConfirmedAmount, 'sats');
    console.log('  available          :', status.balance.availableAmount, 'sats');
    console.log('  availableConfirmed :', status.balance.availableConfirmedAmount, 'sats');
    if (status.balance.byAddress?.length) {
      console.log('  byAddress:');
      for (const a of status.balance.byAddress) {
        console.log(`    ${a.address}  amount=${a.amount} path=${a.path}`);
      }
    }
    const utxos = await client.getUtxos({});
    console.log(`UTXOs (${utxos.length}):`);
    for (const u of utxos) {
      console.log(`  ${u.txid}:${u.vout}  ${u.satoshis} sats  ${u.address} ` +
        `confirmations=${u.confirmations}`);
    }
  }
})().catch(err => {
  console.error('FAILED:', err?.stack || err?.message || err);
  process.exit(1);
});
