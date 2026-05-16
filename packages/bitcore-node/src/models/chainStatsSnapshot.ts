import { ObjectID } from 'mongodb';
import { LoggifyClass } from '../decorators/Loggify';
import { StorageService } from '../services/storage';
import { DistributionBucket, TopAddressEntry } from '../types/namespaces/ChainStateProvider';
import { BaseModel } from './base';

/**
 * Per-chain precomputed chain-wide stats. One doc per {chain, network},
 * refreshed by the ChainStats background service. All chain-wide
 * aggregation endpoints (`/stats/rich-list`, `/stats/distribution`,
 * `/stats/supply`) read from this collection rather than aggregating over
 * the 14M+ unspent-coins set on every request.
 *
 * Stale-but-fast is the explicit deal: freshness is exposed to consumers
 * via `snapshotAt` and `snapshotBlockHeight` so the UI can render an "as of"
 * timestamp.
 */
export interface IChainStatsSnapshot {
  _id?: ObjectID;
  chain: string;
  network: string;
  snapshotAt: Date;
  snapshotBlockHeight: number;
  snapshotBlockTime: Date;
  totalSupply: number;
  totalAddresses: number;
  unspentCount: number;
  top: TopAddressEntry[];
  buckets: DistributionBucket[];
  computeDurationMs: number;
}

@LoggifyClass
export class ChainStatsSnapshotModel extends BaseModel<IChainStatsSnapshot> {
  constructor(storage?: StorageService) {
    super('chain_stats_snapshots', storage);
  }

  allowedPaging = [];

  onConnect() {
    this.collection.createIndex(
      { chain: 1, network: 1 },
      { background: true, unique: true }
    );
  }
}

export const ChainStatsSnapshotStorage = new ChainStatsSnapshotModel();
