#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * One-off backfill for Reddcoin PoSV blocks indexed before the
 * coinstake-aware fee logic landed (commit `feat(bitcore-node): wire
 * REDD-aware fee/coinstake detection`).
 *
 * For each transactions row matching `chain=RDD, coinbase=false, fee<0`
 * (the stable signature of a coinstake under the upstream
 * inputs - outputs formula, since real txs always have non-negative fees):
 *   - sets coinstake: true
 *   - sets stakeReward = -fee  (the original negative is exactly
 *                                subsidy + collected_fees)
 *   - sets fee: 0
 *
 * Then for each touched block, re-runs getBlockFee + getPosData and
 * writes the corrected feeData and new posData fields back.
 *
 * Idempotent: re-running it after the indexer has already been writing
 * coinstake/stakeReward correctly is a no-op (`fee<0` filter excludes
 * already-fixed rows because their fee is now 0).
 *
 * USAGE:
 *   node scripts/fixReddPosFees.js [--network mainnet] [--dry-run] [--verbose]
 */

const { BitcoinBlockStorage } = require('../build/src/models/block');
const { TransactionStorage } = require('../build/src/models/transaction');
const { Storage } = require('../build/src/services/storage');

function usage(errMsg) {
  console.log('USAGE: ./fixReddPosFees [options]');
  console.log('[OPTIONS]:');
  console.log('  --network <value>    mainnet (default), testnet, or regtest');
  console.log('  --dry-run            report what would change, write nothing');
  console.log('  --verbose            log each affected block height');
  if (errMsg) console.error(errMsg);
  process.exit(errMsg ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usage();

const chain = 'RDD';
const network = args.includes('--network') ? args[args.indexOf('--network') + 1] : 'mainnet';
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

if (!['mainnet', 'testnet', 'regtest'].includes(network)) {
  usage(`Invalid --network ${network}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('Connecting to storage...');
Storage.start()
  .then(async () => {
    const startTime = Date.now();

    // Phase 1: rewrite per-tx coinstake rows.
    const txQuery = { chain, network, coinbase: false, fee: { $lt: 0 } };
    const total = await TransactionStorage.collection.countDocuments(txQuery);
    console.log(`Found ${total} coinstake-shaped transactions on ${chain}/${network}`);
    if (total === 0) {
      console.log('Nothing to do.');
      return;
    }

    const blockHashes = new Set();
    let fixed = 0;
    const cursor = TransactionStorage.collection
      .find(txQuery, { projection: { txid: 1, fee: 1, blockHash: 1, blockHeight: 1, _id: 0 } })
      .addCursorFlag('noCursorTimeout', true)
      .stream();

    for await (const tx of cursor) {
      const stakeReward = -tx.fee;
      if (verbose) {
        console.log(`tx ${tx.txid} (block ${tx.blockHeight}): fee ${tx.fee} → coinstake, stakeReward ${stakeReward}`);
      }
      if (!dryRun) {
        await TransactionStorage.collection.updateOne(
          { chain, network, txid: tx.txid },
          { $set: { coinstake: true, stakeReward, fee: 0 } }
        );
      }
      blockHashes.add(tx.blockHash);
      fixed++;
      if (fixed % 5000 === 0) {
        const pct = ((fixed / total) * 100).toFixed(1);
        process.stdout.write(`  ${pct}% (${fixed}/${total} txs)\n`);
        await sleep(50);
      }
    }
    console.log(`Phase 1 done: ${fixed} coinstake txs ${dryRun ? 'would be' : ''} updated`);

    // Phase 2: recompute block.feeData and add block.posData for each
    // affected block. We reuse the storage methods so behaviour stays
    // in lockstep with the live indexer.
    console.log(`Phase 2: recomputing feeData + posData on ${blockHashes.size} blocks...`);
    let blockN = 0;
    for (const blockId of blockHashes) {
      const feeData = await BitcoinBlockStorage.getBlockFee({ chain, network, blockId });
      const posData = await BitcoinBlockStorage.getPosData({ chain, network, blockId });
      if (!dryRun) {
        await BitcoinBlockStorage.collection.updateOne(
          { chain, network, hash: blockId },
          { $set: { feeData, ...(posData && { posData }) } }
        );
      }
      blockN++;
      if (blockN % 5000 === 0) {
        const pct = ((blockN / blockHashes.size) * 100).toFixed(1);
        process.stdout.write(`  ${pct}% (${blockN}/${blockHashes.size} blocks)\n`);
        await sleep(50);
      }
    }

    const seconds = (Date.now() - startTime) / 1000;
    console.log(`Done in ${seconds.toFixed(1)}s | ${(fixed / seconds).toFixed(1)} txs/sec`);
    if (dryRun) console.log('(--dry-run: no writes performed)');
  })
  .catch(console.error)
  .finally(() => Storage.stop());
