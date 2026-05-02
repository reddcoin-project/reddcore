#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Build, sign, and broadcast an RDD spend from the persisted smoke
 * wallet at .smoke-state/redd-livenet.creds.json. Demonstrates the
 * full Phase 7 flow end-to-end through bitcore-wallet-client →
 * bitcore-wallet-service → bitcore-node → reddcoind.
 *
 * USAGE:
 *   node scripts/send-redd.js <toAddress> <amountSats>
 *
 *   # send 1 RDD (1e8 sats) to RuFHSqUod8...
 *   node scripts/send-redd.js RuFHSqUod8y64LrTufB6eXwZqZZsbeAAMG 100000000
 *
 *   # send-max via env var
 *   SEND_MAX=1 node scripts/send-redd.js RuFHSqUod8y64LrTufB6eXwZqZZsbeAAMG 0
 *
 * Set FEE_PER_KB to override the auto fee level. Set DRY_RUN=1 to
 * stop after createTxProposal without committing or broadcasting.
 */

const fs = require('fs');
const path = require('path');
const { API, Key } = require('../ts_build/src');

const BWS = process.env.BWS_URL || 'http://localhost:3232/bws/api';
const NETWORK = process.env.NETWORK || 'livenet';
const STATE_DIR = path.join(__dirname, '..', '.smoke-state');
const KEY_PATH = path.join(STATE_DIR, `redd-${NETWORK}.key.json`);
const CREDS_PATH = path.join(STATE_DIR, `redd-${NETWORK}.creds.json`);

const [, , toAddress, amountStr] = process.argv;
if (!toAddress) {
  console.error('USAGE: send-redd.js <toAddress> <amountSats>');
  process.exit(1);
}
const amount = parseInt(amountStr, 10) || 0;
const sendMax = process.env.SEND_MAX === '1';
const dryRun = process.env.DRY_RUN === '1';

(async () => {
  if (!fs.existsSync(CREDS_PATH) || !fs.existsSync(KEY_PATH)) {
    console.error('Missing persisted state. Run smoke-redd.js first.');
    process.exit(1);
  }

  const { mnemonic } = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const key = new Key({ seedType: 'mnemonic', seedData: mnemonic });

  const client = new API({ baseUrl: BWS, verbose: false, timeout: 30000 });
  client.fromString(fs.readFileSync(CREDS_PATH, 'utf8'));

  // 1. Create the proposal. BWS picks UTXOs and computes fees against
  //    bitcore-node via V8. RDD has no historical fee data yet
  //    (BIT-13), so feeLevel falls back to a sensible default — we
  //    pin feePerKb explicitly to avoid that crash path.
  const feePerKb = parseInt(process.env.FEE_PER_KB, 10) || 100000; // 0.001 RDD/KB — generous on a quiet chain
  console.log('Creating txp…');
  const opts = sendMax
    ? { outputs: [{ toAddress }], sendMax: true, feePerKb }
    : { outputs: [{ toAddress, amount }], feePerKb };
  const txp = await client.createTxProposal(opts);
  console.log('Created txp:', {
    id: txp.id,
    inputs: txp.inputs?.length,
    outputs: txp.outputs?.length,
    amount: txp.amount,
    fee: txp.fee,
    feePerKb: txp.feePerKb,
    rawSize: txp.size,
  });

  if (dryRun) {
    console.log('DRY_RUN=1, stopping after createTxProposal.');
    return;
  }

  // 2. Publish — commits the proposal to BWS so signatures can be
  //    accepted against it. (Single-sig wallets still go through this
  //    step; it's how BWS gates the signature push to a known proposal.)
  console.log('Publishing txp…');
  const published = await client.publishTxProposal({ txp });

  // 3. Sign locally with the wallet's HD key. rootPath comes from the
  //    persisted credentials — for our 1-of-1 RDD livenet wallet it's
  //    m/44'/4'/0' (BIP-44, SLIP-0044 coin type 4). Key.sign returns an
  //    array of DER signatures, one per input.
  const rootPath = client.credentials.rootPath;
  console.log('Signing at rootPath', rootPath, '…');
  const signatures = await key.sign(rootPath, published);
  console.log(`Got ${signatures.length} signature(s).`);

  // 4. Push signatures back to BWS. BWS verifies them, attaches them
  //    to the proposal, and marks it ready for broadcast.
  console.log('Pushing signatures…');
  const signed = await client.pushSignatures(published, signatures);

  // 5. Broadcast — BWS forwards the raw tx to bitcore-node, which
  //    relays to reddcoind's mempool over P2P. Returns the broadcast
  //    txid as soon as bitcore-node accepts it.
  console.log('Broadcasting…');
  const broadcast = await client.broadcastTxProposal(signed);
  console.log('Broadcast:', { txid: broadcast.txid, status: broadcast.status });

  console.log('---');
  console.log('Sent', amount || '(all available)', 'sats to', toAddress);
  console.log('Watch with: curl http://localhost:3000/api/RDD/mainnet/tx/' + broadcast.txid);
})().catch(err => {
  console.error('FAILED:', err?.stack || err?.message || err);
  process.exit(1);
});
