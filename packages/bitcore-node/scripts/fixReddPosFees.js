#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * One-off backfill for Reddcoin PoSV blocks indexed before the
 * coinstake-aware fee logic landed (commit `feat(bitcore-node): wire
 * REDD-aware fee/coinstake detection`).
 *
 * Phase 1 — rewrite per-tx coinstake rows.
 * For each transactions row matching `chain=RDD, coinbase=false, fee<0`
 * (the stable signature of a coinstake under the upstream
 * inputs - outputs formula, since real txs always have non-negative fees):
 *   - sets coinstake: true
 *   - sets stakeReward = -fee  (the original negative is exactly
 *                                subsidy + collected_fees)
 *   - sets fee: 0
 *
 * Phase 2 — recompute block aggregates.
 * Visits every block that needs `feeData`/`posData` rebuilt — i.e. any
 * block on this chain with a coinstake tx but no `posData` field, OR
 * any block visited in Phase 1. Calls the same getBlockFee/getPosData
 * methods the live indexer uses, so behaviour stays in lockstep.
 *
 * Idempotent + resumable. Phase 1 is a no-op once all coinstake rows
 * are clean; Phase 2 picks up wherever it last left off because the
 * "missing posData" filter shrinks as blocks are processed. Crash-safe:
 * if interrupted, just re-run.
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
    const blockHashes = new Set();

    // ---- Phase 1: rewrite per-tx coinstake rows ----
    const txQuery = { chain, network, coinbase: false, fee: { $lt: 0 } };
    const phase1Total = await TransactionStorage.collection.countDocuments(txQuery);
    console.log(`Phase 1: ${phase1Total} coinstake-shaped tx rows still need rewriting`);

    if (phase1Total > 0) {
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
          const pct = ((fixed / phase1Total) * 100).toFixed(1);
          process.stdout.write(`  ${pct}% (${fixed}/${phase1Total} txs)\n`);
          await sleep(50);
        }
      }
      console.log(`Phase 1 done: ${fixed} coinstake txs ${dryRun ? 'would be' : ''} updated`);
    }

    // ---- Phase 2: recompute block-level aggregates ----
    // Stream blocks where feeData.feeTotal < 0. That's the unambiguous
    // signature of a block whose aggregate still includes a coinstake's
    // negative fee. Once recomputed (with phase-1's fee=0 in place),
    // feeTotal becomes non-negative and the block drops out of this
    // set. Phase-1-only sweeps (where the previous run added blocks via
    // the in-memory `blockHashes` set) are also included for free,
    // since a phase-1 update without a phase-2 follow-up leaves the
    // block's feeTotal still negative.
    const phase2Query = { chain, network, 'feeData.feeTotal': { $lt: 0 } };
    const phase2Total = await BitcoinBlockStorage.collection.countDocuments(phase2Query);
    // Union with any blocks phase 1 just touched (covers the rare case
    // of a brand-new fix where feeTotal hasn't been computed yet at all).
    const totalToVisit = phase2Total + blockHashes.size;
    if (totalToVisit === 0) {
      console.log('Phase 2: nothing to do (no blocks have negative feeData).');
    } else {
      console.log(`Phase 2: recomputing feeData + posData on ${totalToVisit} blocks`);
      let blockN = 0;
      const visit = async blockId => {
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
          const pct = ((blockN / totalToVisit) * 100).toFixed(1);
          process.stdout.write(`  ${pct}% (${blockN}/${totalToVisit} blocks)\n`);
          await sleep(50);
        }
      };
      // Stream the negative-feeTotal blocks first (the bulk of work).
      const blockCursor = BitcoinBlockStorage.collection
        .find(phase2Query, { projection: { hash: 1, _id: 0 } })
        .addCursorFlag('noCursorTimeout', true)
        .stream();
      for await (const b of blockCursor) await visit(b.hash);
      // Then any extras from phase-1's in-memory set (probably empty
      // unless feeTotal had not yet been computed pre-backfill).
      for (const h of blockHashes) await visit(h);
      console.log(`Phase 2 done: ${blockN} blocks ${dryRun ? 'would be' : ''} updated`);
    }

    const seconds = (Date.now() - startTime) / 1000;
    console.log(`Total wall time: ${seconds.toFixed(1)}s`);
    if (dryRun) console.log('(--dry-run: no writes performed)');
  })
  .catch(console.error)
  .finally(() => Storage.stop());
