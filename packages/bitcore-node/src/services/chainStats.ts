import logger from '../logger';
import { ChainStatsSnapshotStorage } from '../models/chainStatsSnapshot';
import { ChainStateProvider } from '../providers/chain-state';
import { wait } from '../utils';
import { Config } from './config';

/**
 * Periodic background writer for chain_stats_snapshots.
 *
 * Replaces on-demand aggregations behind `/stats/rich-list`,
 * `/stats/distribution`, `/stats/supply` — those endpoints walk ~14M
 * unspent coin docs and were measured at 5+ minutes warm on production
 * (see BIT-41). This service computes the same numbers periodically and
 * upserts them into a single doc per chain/network; the routes then read
 * the snapshot in milliseconds.
 *
 * Runs only on the cluster primary (registered in workers/all.ts under
 * `cluster.isPrimary`). Single-instance by design; if multi-instance HA
 * is ever needed, add a lease modelled on `services/p2p.ts`.
 */

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_TOP_LIMIT = 200;
const RETRY_BACKOFF_MS = 60 * 1000;
const POLL_GRANULARITY_MS = 1000;

interface ChainStatsConfig {
  intervalMs?: number;
  topLimit?: number;
  disabled?: boolean;
}

class ChainStatsWorker {
  private chain: string;
  private network: string;
  private intervalMs: number;
  private topLimit: number;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;

  constructor(params: { chain: string; network: string; intervalMs: number; topLimit: number }) {
    this.chain = params.chain;
    this.network = params.network;
    this.intervalMs = params.intervalMs;
    this.topLimit = params.topLimit;
  }

  start() {
    this.loopPromise = this.loop();
  }

  async stop() {
    this.stopping = true;
    if (this.loopPromise) {
      await this.loopPromise.catch(() => {});
    }
  }

  private async loop() {
    // Probe once: if the provider doesn't implement the aggregations we
    // need (non-UTXO chain), don't loop at all.
    const supported = await this.providerSupported();
    if (!supported) {
      logger.info(
        'ChainStats: %s:%s provider missing UTXO aggregations; not scheduling refresh',
        this.chain,
        this.network
      );
      return;
    }

    logger.info(
      'ChainStats: started for %s:%s (interval=%dms, topLimit=%d)',
      this.chain,
      this.network,
      this.intervalMs,
      this.topLimit
    );

    // Refresh immediately on startup if the snapshot is missing or older
    // than intervalMs; otherwise wait out the remainder. Avoids re-doing
    // work when bitcore-node restarts shortly after a refresh.
    const nowMs = Date.now();
    const existing = await ChainStatsSnapshotStorage.collection.findOne({
      chain: this.chain,
      network: this.network
    });
    const ageMs = existing ? nowMs - new Date(existing.snapshotAt).getTime() : Number.POSITIVE_INFINITY;
    if (ageMs < this.intervalMs) {
      const remainder = this.intervalMs - ageMs;
      logger.info(
        'ChainStats: %s:%s existing snapshot %dms old; first refresh in %dms',
        this.chain,
        this.network,
        ageMs,
        remainder
      );
      if (!(await this.sleep(remainder))) return;
    }

    while (!this.stopping) {
      let nextDelayMs = this.intervalMs;
      try {
        await this.refresh();
      } catch (err: any) {
        logger.error(
          'ChainStats: refresh failed for %s:%s: %o',
          this.chain,
          this.network,
          err.stack || err.message || err
        );
        // Back off on errors; don't hammer mongo if aggregations are broken.
        nextDelayMs = RETRY_BACKOFF_MS;
      }
      if (!(await this.sleep(nextDelayMs))) return;
    }
  }

  private async providerSupported(): Promise<boolean> {
    try {
      // Cheapest probe: a limit-1 rich-list. If the provider exposes it,
      // the other two aggregations are guaranteed by the InternalState
      // provider interface (all three share UTXO_BY_ADDRESS access path).
      await ChainStateProvider.getTopAddresses({
        chain: this.chain,
        network: this.network,
        args: { limit: 1 }
      });
      return true;
    } catch (err: any) {
      if (/not implemented/i.test(err?.message || '')) return false;
      // Any other error (empty DB, transient mongo blip) — assume supported;
      // the main loop will surface real failures.
      return true;
    }
  }

  private async refresh() {
    const t0 = Date.now();
    const [top, distribution, supply] = await Promise.all([
      ChainStateProvider.getTopAddresses({
        chain: this.chain,
        network: this.network,
        args: { limit: this.topLimit }
      }),
      ChainStateProvider.getAddressDistribution({ chain: this.chain, network: this.network }),
      ChainStateProvider.getCirculatingSupply({ chain: this.chain, network: this.network })
    ]);
    const computeDurationMs = Date.now() - t0;

    await ChainStatsSnapshotStorage.collection.updateOne(
      { chain: this.chain, network: this.network },
      {
        $set: {
          chain: this.chain,
          network: this.network,
          snapshotAt: new Date(),
          snapshotBlockHeight: supply.asOfHeight,
          snapshotBlockTime: new Date(supply.asOf),
          totalSupply: distribution.totalSupply,
          totalAddresses: distribution.totalAddresses,
          unspentCount: supply.unspentCount,
          top,
          buckets: distribution.buckets,
          computeDurationMs
        }
      },
      { upsert: true }
    );

    logger.info(
      'ChainStats: snapshot refreshed for %s:%s in %dms (height=%d, totalSupply=%d, addresses=%d)',
      this.chain,
      this.network,
      computeDurationMs,
      supply.asOfHeight,
      distribution.totalSupply,
      distribution.totalAddresses
    );
  }

  // Interruptible sleep — returns false if stopping was requested while waiting.
  private async sleep(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.stopping) return false;
      await wait(Math.min(POLL_GRANULARITY_MS, deadline - Date.now()));
    }
    return !this.stopping;
  }
}

export class ChainStatsManager {
  private workers: ChainStatsWorker[] = [];

  async start() {
    // No top-level `isDisabled('chainStats')` check — Config.isDisabled's
    // type only accepts the historical built-in service names. Per-chain
    // disable via chainConfig.chainStats.disabled (below) is sufficient.
    for (const chainNetwork of Config.chainNetworks()) {
      const { chain, network } = chainNetwork;
      const chainConfig = Config.chainConfig(chainNetwork) as { disabled?: boolean; chainStats?: ChainStatsConfig };
      if (chainConfig.disabled) continue;
      const csCfg = chainConfig.chainStats || {};
      if (csCfg.disabled) {
        logger.info('ChainStats: disabled for %s:%s by chain config', chain, network);
        continue;
      }
      const worker = new ChainStatsWorker({
        chain,
        network,
        intervalMs: csCfg.intervalMs ?? DEFAULT_INTERVAL_MS,
        topLimit: csCfg.topLimit ?? DEFAULT_TOP_LIMIT
      });
      this.workers.push(worker);
      worker.start();
    }
  }

  async stop() {
    await Promise.all(this.workers.map(w => w.stop()));
    this.workers = [];
  }
}

export const ChainStats = new ChainStatsManager();
