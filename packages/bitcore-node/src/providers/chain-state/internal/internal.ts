
import { Transform } from 'stream';
import { Validation } from '@bitpay-labs/crypto-wallet-core';
import { LRUCache } from 'lru-cache';
import { LoggifyClass } from '../../../decorators/Loggify';
import { BitcoinBlockStorage, type IBtcBlock } from '../../../models/block';
import { CacheStorage } from '../../../models/cache';
import { CoinStorage, type ICoin } from '../../../models/coin';
import { StateStorage } from '../../../models/state';
import { type ITransaction, TransactionStorage } from '../../../models/transaction';
import { type IWallet, WalletStorage } from '../../../models/wallet';
import { type IWalletAddress, WalletAddressStorage } from '../../../models/walletAddress';
import { RPC } from '../../../rpc';
import { Config } from '../../../services/config';
import { Storage } from '../../../services/storage';
import { type CoinJSON, SpentHeightIndicators } from '../../../types/Coin';
import { normalizeChainNetwork } from '../../../utils';
import { StringifyJsonStream } from '../../../utils/jsonStream';
import { ListTransactionsStream } from './transforms';
import type { MongoBound } from '../../../models/base';
import type { IBlock } from '../../../types/Block';
import type { IUtxoNetworkConfig } from '../../../types/Config';
import type { TransactionJSON } from '../../../types/Transaction';
import type { StreamBlocksParams } from '../../../types/namespaces/ChainStateProvider';
import type { GetBlockBeforeTimeParams, StreamTransactionParams, WalletBalanceType } from '../../../types/namespaces/ChainStateProvider';
import type {
  ActiveAddressEntry,
  AddressDistribution,
  AddressStats,
  BroadcastTransactionParams,
  ChainSupply,
  CreateWalletParams,
  DailyTransactionsParams,
  DistributionBucket,
  DormantAddressEntry,
  GetActiveAddressesParams,
  GetAddressDistributionParams,
  GetAddressStatsParams,
  GetBalanceForAddressParams,
  GetBlockParams,
  GetCirculatingSupplyParams,
  GetDormantAddressesParams,
  GetEstimateSmartFeeParams,
  GetTopAddressesParams,
  GetWalletBalanceAtTimeParams,
  GetWalletBalanceParams,
  GetWalletParams,
  IChainStateService,
  StreamAddressUtxosParams,
  StreamTransactionsParams,
  StreamWalletAddressesParams,
  StreamWalletMissingAddressesParams,
  StreamWalletTransactionsParams,
  StreamWalletUtxosParams,
  TopAddressEntry,
  UpdateWalletParams,
  WalletCheckParams
} from '../../../types/namespaces/ChainStateProvider';
import type { ObjectId } from 'mongodb';

// The partial index on `coins` keyed by `spentHeight < 0`. Every
// chain-wide unspent aggregation (rich-list, dormant, distribution,
// supply) hints this index explicitly: Mongo 4.x's query planner can
// pick the wider `(chain, network, spentHeight)` index by default,
// which scans all ~35M coins instead of just the ~14M unspent ones.
// Hint stays valid as long as the index name lives in `models/coin.ts`.
const UNSPENT_BY_ADDRESS_INDEX = 'address_1_chain_1_network_1';

@LoggifyClass
export class InternalStateProvider implements IChainStateService {
  chain: string;
  blockAtTimeCache: { [key: string]: LRUCache<string, IBlock> };

  constructor(chain: string, private WalletStreamTransform = ListTransactionsStream) {
    this.chain = chain;
    this.chain = this.chain.toUpperCase();
    this.blockAtTimeCache = {};
  }

  getRPC(chain: string, network: string) {
    const RPC_PEER = (Config.chainConfig({ chain, network }) as IUtxoNetworkConfig).rpc;
    if (!RPC_PEER) {
      throw new Error(`RPC not configured for ${chain} ${network}`);
    }
    const { username, password, host, port, protocol } = RPC_PEER;
    return new RPC(username, password, host, port, protocol);
  }

  private getAddressQuery(params: StreamAddressUtxosParams) {
    const { chain, network, address, args } = params;
    if (typeof address !== 'string' || !chain || !network) {
      throw new Error('Missing required param');
    }
    const query = { chain, network: network.toLowerCase(), address } as any;
    if (args.unspent) {
      query.spentHeight = { $lt: SpentHeightIndicators.minimum };
    }
    if (args.excludeConflicting) {
      query.mintHeight = { $gt: SpentHeightIndicators.conflicting };
    }
    return query;
  }

  async streamAddressTransactions(params: StreamAddressUtxosParams) {
    const { req, res, args } = params;
    const { limit, since } = args;
    const query = this.getAddressQuery(params);
    // BIT-46: page by mintHeight (newest first by default) instead of by
    // _id. _id ordering is insertion-time which approximates mint time
    // but isn't tx-height-ordered; for an address with history older
    // than the indexer's last reorg/refill that approximation breaks.
    // The (address, mintHeight) compound index in models/coin.ts keys
    // this read; `since` is the mintHeight cursor for "Load more".
    Storage.apiStreamingFind(
      CoinStorage,
      query,
      { limit, since, paging: 'mintHeight' },
      req!,
      res!
    );
  }

  async getBalanceForAddress(params: GetBalanceForAddressParams): Promise<WalletBalanceType> {
    const { chain, network, address } = params;
    const query = {
      chain,
      network,
      address,
      spentHeight: { $lt: SpentHeightIndicators.minimum },
      mintHeight: { $gt: SpentHeightIndicators.conflicting }
    };
    const balance = await CoinStorage.getBalance({ query });
    return balance;
  }

  async getTopAddresses(params: GetTopAddressesParams): Promise<TopAddressEntry[]> {
    const { chain, network, args } = params;
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 1000);
    const offset = Math.max(Number(args.offset) || 0, 0);

    // Aggregate unspent (= currently held) outputs grouped by address.
    // The partial index (address, chain, network) WHERE spentHeight < 0 is the
    // selective access path; the leading $match keys it.
    const result = await CoinStorage.collection
      .aggregate<{ _id: string; balance: number }>(
        [
          {
            $match: {
              chain,
              network,
              spentHeight: { $lt: SpentHeightIndicators.minimum },
              mintHeight: { $gt: SpentHeightIndicators.conflicting }
            }
          },
          { $group: { _id: '$address', balance: { $sum: '$value' } } },
          { $sort: { balance: -1 } },
          { $skip: offset },
          { $limit: limit }
        ],
        { allowDiskUse: true, hint: UNSPENT_BY_ADDRESS_INDEX }
      )
      .toArray();

    return result.map((r, i) => ({
      rank: offset + i + 1,
      address: r._id,
      balance: r.balance
    }));
  }

  async getDormantAddresses(params: GetDormantAddressesParams): Promise<DormantAddressEntry[]> {
    const { chain, network, args } = params;
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 1000);
    const offset = Math.max(Number(args.offset) || 0, 0);
    const years = Math.max(Number(args.years) || 5, 1);

    // Cutoff = newest block whose time is before (now - years). Looking
    // up by time honours actual block intervals (RDD's PoSV transition
    // changed effective rate over time; a constant-blocks-per-year
    // approximation would drift).
    const cutoffDate = new Date(Date.now() - years * 365.25 * 24 * 60 * 60 * 1000);
    const cutoffBlock = await BitcoinBlockStorage.collection.findOne(
      { chain, network, processed: true, time: { $lt: cutoffDate } },
      { sort: { time: -1 }, projection: { height: 1 } }
    );
    if (!cutoffBlock) {
      // Chain younger than the requested dormancy window — nothing qualifies.
      return [];
    }
    const cutoffHeight = cutoffBlock.height;

    // Aggregate unspent outputs per address, keep $max(mintHeight) as the
    // "last activity" proxy. Filter the post-group set to addresses whose
    // most-recent receive is older than the cutoff. Sort by balance desc
    // and page.
    //
    // Caveat (documented in BIT-29): a "Payment to yourself" tx that
    // creates a change output back to the same address will reset this
    // clock even though the holder didn't externally move funds. True
    // dormancy via UTXO-age tracking is a follow-up.
    const grouped = await CoinStorage.collection
      .aggregate<{ _id: string; balance: number; lastActiveHeight: number }>(
        [
          {
            $match: {
              chain,
              network,
              spentHeight: { $lt: SpentHeightIndicators.minimum },
              mintHeight: { $gt: SpentHeightIndicators.conflicting }
            }
          },
          {
            $group: {
              _id: '$address',
              balance: { $sum: '$value' },
              lastActiveHeight: { $max: '$mintHeight' }
            }
          },
          { $match: { lastActiveHeight: { $lt: cutoffHeight, $gt: 0 } } },
          { $sort: { balance: -1 } },
          { $skip: offset },
          { $limit: limit }
        ],
        { allowDiskUse: true, hint: UNSPENT_BY_ADDRESS_INDEX }
      )
      .toArray();

    if (grouped.length === 0) return [];

    // Resolve last-active timestamps by joining with the block collection
    // for each unique height. One round trip; small set (≤ limit distinct
    // heights, capped at 1000).
    const heights = Array.from(new Set(grouped.map(g => g.lastActiveHeight)));
    const blocks = await BitcoinBlockStorage.collection
      .find(
        { chain, network, height: { $in: heights } },
        { projection: { height: 1, time: 1 } }
      )
      .toArray();
    const heightToTime = new Map(blocks.map(b => [b.height, b.time]));

    return grouped.map((r, i) => ({
      rank: offset + i + 1,
      address: r._id,
      balance: r.balance,
      lastActiveHeight: r.lastActiveHeight,
      lastActiveTime: (heightToTime.get(r.lastActiveHeight) || new Date(0)).toISOString()
    }));
  }

  async getAddressDistribution(params: GetAddressDistributionParams): Promise<AddressDistribution> {
    const { chain, network } = params;

    // Powers-of-10 boundaries in base units (sats). For an 8-decimal chain
    // like RDD, 1e8 sats = 1 coin, so this lays out as 0–0.001, 0.001–0.01,
    // ..., 1–10, ..., 10^9–10^10, plus an unbounded overflow above 10^18.
    // Mirrors bitinfocharts' "Wealth distribution" buckets.
    const boundaries = [0, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18];

    const result = await CoinStorage.collection
      .aggregate<{ _id: number | 'overflow'; addressCount: number; valueSum: number }>(
        [
          {
            $match: {
              chain,
              network,
              spentHeight: { $lt: SpentHeightIndicators.minimum },
              mintHeight: { $gt: SpentHeightIndicators.conflicting }
            }
          },
          { $group: { _id: '$address', balance: { $sum: '$value' } } },
          {
            $bucket: {
              groupBy: '$balance',
              boundaries,
              default: 'overflow',
              output: {
                addressCount: { $sum: 1 },
                valueSum: { $sum: '$balance' }
              }
            }
          }
        ],
        { allowDiskUse: true, hint: UNSPENT_BY_ADDRESS_INDEX }
      )
      .toArray();

    // $bucket omits empty buckets from its output; fill them back in so the
    // UI gets a stable, dense series (every defined band, in order).
    const bucketMap = new Map<number | string, { addressCount: number; valueSum: number }>();
    for (const r of result) {
      bucketMap.set(r._id, { addressCount: r.addressCount, valueSum: r.valueSum });
    }

    const buckets: DistributionBucket[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const entry = bucketMap.get(boundaries[i]) || { addressCount: 0, valueSum: 0 };
      buckets.push({
        min: boundaries[i],
        max: boundaries[i + 1],
        addressCount: entry.addressCount,
        valueSum: entry.valueSum
      });
    }
    const overflow = bucketMap.get('overflow') || { addressCount: 0, valueSum: 0 };
    buckets.push({
      min: boundaries[boundaries.length - 1],
      max: null,
      addressCount: overflow.addressCount,
      valueSum: overflow.valueSum
    });

    const totalAddresses = buckets.reduce((sum, b) => sum + b.addressCount, 0);
    const totalSupply = buckets.reduce((sum, b) => sum + b.valueSum, 0);

    return { totalSupply, totalAddresses, buckets };
  }

  async getCirculatingSupply(params: GetCirculatingSupplyParams): Promise<ChainSupply> {
    const { chain, network } = params;

    // Chain-wide sum of unspent values. Same access path as the distribution
    // aggregation (partial index on address keyed by spentHeight < 0), so this
    // is the same cost class — heavy on a cold cache, cheap with the route's
    // 5-min wrapper.
    const [result] = await CoinStorage.collection
      .aggregate<{ supply: number; count: number }>(
        [
          {
            $match: {
              chain,
              network,
              spentHeight: { $lt: SpentHeightIndicators.minimum },
              mintHeight: { $gt: SpentHeightIndicators.conflicting }
            }
          },
          { $group: { _id: null, supply: { $sum: '$value' }, count: { $sum: 1 } } }
        ],
        { allowDiskUse: true, hint: UNSPENT_BY_ADDRESS_INDEX }
      )
      .toArray();

    const tip = await BitcoinBlockStorage.collection.findOne(
      { chain, network, processed: true },
      { sort: { height: -1 }, projection: { height: 1, time: 1 } }
    );

    return {
      circulating: result?.supply ?? 0,
      unspentCount: result?.count ?? 0,
      asOfHeight: tip?.height ?? 0,
      asOf: (tip?.time ?? new Date(0)).toISOString()
    };
  }

  async getAddressStats(params: GetAddressStatsParams): Promise<AddressStats> {
    const { chain, network, address } = params;

    // Single $facet aggregation, one pass over the address's coin docs.
    //   - ins:   distinct mintTxids + min/max mintHeight (no sort, $min/$max in group)
    //   - outs:  distinct spentTxids (where set) + min/max spentHeight
    //   - txs:   union of in/out txids per coin → distinct count
    // Cost is O(docs-for-this-address). The {address:1,chain:1,network:1}
    // index keys the initial $match; the rest is in-memory grouping. No
    // sort step (unlike the previous parallel-point-lookup design which
    // hit 88s+ on hot addresses because there's no compound index covering
    // (address, mintHeight) for a sort+limit-1).
    const [agg] = await CoinStorage.collection
      .aggregate<{
      ins: Array<{ first: number; last: number; n: number }>;
      outs: Array<{ first: number; last: number; n: number }>;
      txs: Array<{ n: number }>;
    }>(
        [
          { $match: { chain, network, address } },
          {
            $facet: {
              ins: [
                { $match: { mintHeight: { $gt: SpentHeightIndicators.conflicting } } },
                // Group by mintTxid so a tx with multiple paying outputs counts once.
                { $group: { _id: '$mintTxid', height: { $min: '$mintHeight' } } },
                {
                  $group: {
                    _id: null,
                    first: { $min: '$height' },
                    last: { $max: '$height' },
                    n: { $sum: 1 }
                  }
                }
              ],
              outs: [
                {
                  $match: {
                    spentTxid: { $exists: true, $ne: null },
                    spentHeight: { $gt: SpentHeightIndicators.conflicting }
                  }
                },
                // Group by spentTxid so a tx that consumed multiple of this
                // address's UTXOs counts as one spend event.
                { $group: { _id: '$spentTxid', height: { $min: '$spentHeight' } } },
                {
                  $group: {
                    _id: null,
                    first: { $min: '$height' },
                    last: { $max: '$height' },
                    n: { $sum: 1 }
                  }
                }
              ],
              txs: [
                // Each coin contributes its mintTxid and (if set) its spentTxid
                // to the union. $filter drops null/empty spentTxid for unspent
                // coins. A PoSV staking tx that both spends from and mints to
                // the same address contributes the same txid from both sides
                // and the final $group dedups it back to one.
                {
                  $project: {
                    events: {
                      $filter: {
                        input: ['$mintTxid', '$spentTxid'],
                        cond: {
                          $and: [
                            { $ne: ['$$this', null] },
                            { $ne: ['$$this', ''] }
                          ]
                        }
                      }
                    }
                  }
                },
                { $unwind: '$events' },
                { $group: { _id: '$events' } },
                { $count: 'n' }
              ]
            }
          }
        ],
        { allowDiskUse: true }
      )
      .toArray();

    const ins = agg?.ins[0];
    const outs = agg?.outs[0];
    const numTxs = agg?.txs[0]?.n ?? 0;

    // Resolve heights → block times in one batched lookup.
    const heights = new Set<number>();
    if (ins) {
      heights.add(ins.first);
      heights.add(ins.last);
    }
    if (outs) {
      heights.add(outs.first);
      heights.add(outs.last);
    }
    const blocks = heights.size === 0
      ? []
      : await BitcoinBlockStorage.collection
        .find(
          { chain, network, height: { $in: Array.from(heights) } },
          { projection: { height: 1, time: 1 } }
        )
        .toArray();
    const heightToTime = new Map(blocks.map(b => [b.height, b.time]));

    const toRef = (h: number | undefined | null) =>
      h === undefined || h === null
        ? null
        : { height: h, time: (heightToTime.get(h) || new Date(0)).toISOString() };

    return {
      address,
      firstIn: toRef(ins?.first),
      lastIn: toRef(ins?.last),
      numIns: ins?.n ?? 0,
      firstOut: toRef(outs?.first),
      lastOut: toRef(outs?.last),
      numOuts: outs?.n ?? 0,
      numTxs
    };
  }

  async getActiveAddresses(params: GetActiveAddressesParams): Promise<ActiveAddressEntry[]> {
    const { chain, network, args } = params;
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 1000);
    const offset = Math.max(Number(args.offset) || 0, 0);
    const windowDays = Math.min(Math.max(Number(args.windowDays) || 30, 1), 365);
    const filter = args.filter || 'any';

    // Cutoff = newest block whose time is before (now - windowDays). Same
    // time-based approach used by the dormant query — honours actual block
    // intervals across PoW→PoSV.
    const cutoffDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const cutoffBlock = await BitcoinBlockStorage.collection.findOne(
      { chain, network, processed: true, time: { $lt: cutoffDate } },
      { sort: { time: -1 }, projection: { height: 1 } }
    );
    // No block older than the window — the entire chain falls inside it.
    // Use height 0 as the cutoff so every confirmed coin/tx qualifies.
    const cutoffHeight = cutoffBlock?.height ?? 0;

    let grouped: Array<{ _id: string; txCount: number; lastActiveHeight: number }> = [];

    // Reddcoin PoSV coinstake txs have an empty (non-standard) output at
    // index 0; bitcore stores those coin docs with address: 'false'. They
    // would otherwise dominate "any" rankings and contaminate "received"
    // counts, so filter them out at the source.
    //
    // Note: this pipeline targets MongoDB 3.4. $expr and the pipeline form
    // of $lookup don't exist there; we use the older localField/foreignField
    // form and avoid $expr in $match.
    const realAddress = { address: { $nin: ['', 'false', null] as Array<string | null> } };

    if (filter === 'staking') {
      // Two-step: list coinstake txids in window, then aggregate their
      // outputs in `coins` via an $in match. Avoids $lookup entirely —
      // works on Mongo 3.4. The $in list is bounded: a 365-day window has
      // ~525k coinstake txids worst case (under BSON limits); typical 30d
      // window is ~43k.
      const coinstakeTxs = await TransactionStorage.collection
        .find(
          { chain, network, coinstake: true, blockHeight: { $gte: cutoffHeight } },
          { projection: { txid: 1, blockHeight: 1 } }
        )
        .toArray();

      if (coinstakeTxs.length === 0) return [];

      const txids = coinstakeTxs.map(t => t.txid);
      grouped = await CoinStorage.collection
        .aggregate<{ _id: string; txCount: number; lastActiveHeight: number }>(
          [
            {
              $match: {
                chain,
                network,
                mintTxid: { $in: txids },
                mintIndex: { $gte: 1 },
                ...realAddress
              }
            },
            // Distinct (address, mintTxid) — a coinstake with multiple paying
            // outputs to the same address still counts as one stake event.
            { $group: { _id: { address: '$address', txid: '$mintTxid' }, h: { $max: '$mintHeight' } } },
            { $group: { _id: '$_id.address', txCount: { $sum: 1 }, lastActiveHeight: { $max: '$h' } } },
            { $sort: { txCount: -1, lastActiveHeight: -1 } },
            { $skip: offset },
            { $limit: limit }
          ],
          { allowDiskUse: true }
        )
        .toArray();
    } else {
      // any | received | sent — coins-based aggregation. Per side:
      //   received: count distinct mintTxid per address where mintHeight ≥ cutoff
      //   sent:     count distinct spentTxid per address where spentHeight ≥ cutoff
      //   any:      union of both, summed
      const receiveMatch = {
        chain,
        network,
        mintHeight: { $gte: cutoffHeight },
        ...realAddress
      };
      const spendMatch = {
        chain,
        network,
        spentHeight: { $gte: cutoffHeight },
        spentTxid: { $exists: true, $ne: null },
        ...realAddress
      };

      const tally = new Map<string, { txCount: number; lastActiveHeight: number }>();
      const bump = (addr: string, n: number, h: number) => {
        const cur = tally.get(addr);
        if (cur) {
          cur.txCount += n;
          if (h > cur.lastActiveHeight) cur.lastActiveHeight = h;
        } else {
          tally.set(addr, { txCount: n, lastActiveHeight: h });
        }
      };

      if (filter === 'received' || filter === 'any') {
        const rows = await CoinStorage.collection
          .aggregate<{ _id: string; txCount: number; lastActiveHeight: number }>(
            [
              { $match: receiveMatch },
              { $group: { _id: { address: '$address', txid: '$mintTxid' }, h: { $max: '$mintHeight' } } },
              { $group: { _id: '$_id.address', txCount: { $sum: 1 }, lastActiveHeight: { $max: '$h' } } }
            ],
            { allowDiskUse: true }
          )
          .toArray();
        for (const r of rows) bump(r._id, r.txCount, r.lastActiveHeight);
      }
      if (filter === 'sent' || filter === 'any') {
        const rows = await CoinStorage.collection
          .aggregate<{ _id: string; txCount: number; lastActiveHeight: number }>(
            [
              { $match: spendMatch },
              { $group: { _id: { address: '$address', txid: '$spentTxid' }, h: { $max: '$spentHeight' } } },
              { $group: { _id: '$_id.address', txCount: { $sum: 1 }, lastActiveHeight: { $max: '$h' } } }
            ],
            { allowDiskUse: true }
          )
          .toArray();
        for (const r of rows) bump(r._id, r.txCount, r.lastActiveHeight);
      }

      grouped = Array.from(tally.entries())
        .map(([address, v]) => ({ _id: address, txCount: v.txCount, lastActiveHeight: v.lastActiveHeight }))
        .sort((a, b) => b.txCount - a.txCount || b.lastActiveHeight - a.lastActiveHeight)
        .slice(offset, offset + limit);
    }

    if (grouped.length === 0) return [];

    // Resolve last-active times in one batch.
    const heights = Array.from(new Set(grouped.map(g => g.lastActiveHeight)));
    const blocks = await BitcoinBlockStorage.collection
      .find(
        { chain, network, height: { $in: heights } },
        { projection: { height: 1, time: 1 } }
      )
      .toArray();
    const heightToTime = new Map(blocks.map(b => [b.height, b.time]));

    return grouped.map((g, i) => ({
      rank: offset + i + 1,
      address: g._id,
      txCount: g.txCount,
      lastActiveHeight: g.lastActiveHeight,
      lastActiveTime: (heightToTime.get(g.lastActiveHeight) || new Date(0)).toISOString()
    }));
  }

  streamBlocks(params: StreamBlocksParams) {
    const { req, res } = params;
    const { query, options } = this.getBlocksQuery(params);
    Storage.apiStreamingFind(BitcoinBlockStorage, query, options, req, res);
  }

  async getBlocks(params: GetBlockParams): Promise<Array<IBlock>> {
    const { query, options } = this.getBlocksQuery(params);
    let cursor = BitcoinBlockStorage.collection.find(query, options).addCursorFlag('noCursorTimeout', true);
    if (options.sort) {
      cursor = cursor.sort(options.sort);
    }
    const blocks = await cursor.toArray();
    const tip = await this.getLocalTip(params);
    const tipHeight = tip ? tip.height : 0;
    const blockTransform = (b: IBtcBlock) => {
      let confirmations = 0;
      if (b.height > -1) {
        confirmations = tipHeight - b.height + 1;
      }
      const convertedBlock = BitcoinBlockStorage._apiTransform(b, { object: true }) as IBtcBlock;
      return { ...convertedBlock, confirmations };
    };
    return blocks.map(blockTransform);
  }

  protected getBlocksQuery(params: GetBlockParams | StreamBlocksParams) {
    const { chain, network, sinceBlock, blockId, args = {} } = params;
    const { startDate, endDate, date, since, direction, paging } = args;
    const { limit = 10, sort = { height: -1 } } = args;
    const options = { limit, sort, since, direction, paging };
    if (!chain || !network) {
      throw new Error('Missing required param');
    }
    const query: any = {
      chain,
      network: network.toLowerCase(),
      processed: true
    };
    if (blockId) {
      if (blockId.length >= 64) {
        query.hash = blockId;
      } else {
        const height = parseInt(blockId, 10);
        if (Number.isNaN(height) || height.toString(10) !== blockId) {
          throw new Error('invalid block id provided');
        }
        query.height = height;
      }
    }
    if (sinceBlock) {
      const height = Number(sinceBlock);
      if (Number.isNaN(height) || height.toString(10) !== sinceBlock) {
        throw new Error('invalid block id provided');
      }
      query.height = { $gt: height };
    }
    if (startDate) {
      query.time = { $gt: new Date(startDate) };
    }
    if (endDate) {
      query.time = Object.assign({}, query.time, { $lt: new Date(endDate) });
    }
    if (date) {
      const firstDate = new Date(date);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      query.time = { $gt: firstDate, $lt: nextDate };
    }
    return { query, options };
  }

  async getBlock(params: GetBlockParams) {
    const blocks = await this.getBlocks(params);
    return blocks[0];
  }

  async getBlockBeforeTime(params: GetBlockBeforeTimeParams): Promise<IBlock|null> {
    const { chain, network, time } = params;
    const date = new Date(time || Date.now());
    const chainNetwork = normalizeChainNetwork(chain, network);
    if (!this.blockAtTimeCache[chainNetwork]) {
      this.blockAtTimeCache[chainNetwork] = new LRUCache<string, IBlock>({ max: 1000 });
    }
    const cachedBlock = this.blockAtTimeCache[chainNetwork].get(date.toISOString());
    if (cachedBlock !== undefined) {
      return cachedBlock;
    }
    const [block] = await BitcoinBlockStorage.collection
      .find({
        chain,
        network,
        timeNormalized: { $lte: date }
      })
      .limit(1)
      .sort({ timeNormalized: -1 })
      .toArray();
    this.blockAtTimeCache[chainNetwork].set(date.toISOString(), block || null);
    return block || null;
  }

  async streamTransactions(params: StreamTransactionsParams) {
    const { chain, network, req, res, args } = params;
    const { blockHash, blockHeight } = args;
    if (!chain || !network) {
      throw new Error('Missing chain or network');
    }
    const query: any = {
      chain,
      network: network.toLowerCase()
    };
    if (blockHeight !== undefined) {
      query.blockHeight = Number(blockHeight);
    }
    if (blockHash !== undefined) {
      query.blockHash = blockHash;
    }
    const tip = await this.getLocalTip(params);
    const tipHeight = tip ? tip.height : 0;
    return Storage.apiStreamingFind(TransactionStorage, query, args, req, res, t => {
      let confirmations = 0;
      if (t.blockHeight !== undefined && t.blockHeight >= 0) {
        confirmations = tipHeight - t.blockHeight + 1;
      }
      const convertedTx = TransactionStorage._apiTransform(t, { object: true }) as Partial<ITransaction>;
      return JSON.stringify({ ...convertedTx, confirmations });
    });
  }

  async getTransaction(params: StreamTransactionParams) {
    let { network } = params;
    const { chain, txId } = params;
    if (typeof txId !== 'string' || !chain || !network) {
      throw new Error('Missing required param');
    }
    network = network.toLowerCase();
    const query = { chain, network, txid: txId };
    const tip = await this.getLocalTip(params);
    const tipHeight = tip ? tip.height : 0;
    const found = await TransactionStorage.collection.findOne(query);
    if (found) {
      let confirmations = 0;
      if (found.blockHeight != null && found.blockHeight >= 0) {
        confirmations = tipHeight - found.blockHeight + 1;
      }
      const convertedTx = TransactionStorage._apiTransform(found, { object: true }) as TransactionJSON;
      return { ...convertedTx, confirmations } as any;
    } else {
      return undefined;
    }
  }

  async getAuthhead(params: StreamTransactionParams) {
    const { chain, network, txId } = params;
    if (typeof txId !== 'string') {
      throw new Error('Missing required param');
    }
    const found = (await CoinStorage.resolveAuthhead(txId, chain, network))[0];
    if (found) {
      const transformedCoins = found.identityOutputs.map<CoinJSON>(output =>
        CoinStorage._apiTransform(output, { object: true })
      );
      return {
        chain: found.chain,
        network: found.network,
        authbase: found.authbase,
        identityOutputs: transformedCoins
      };
    } else {
      return undefined;
    }
  }

  async createWallet(params: CreateWalletParams) {
    const { chain, network, name, pubKey, path, singleAddress } = params;
    if (typeof name !== 'string' || !network) {
      throw new Error('Missing required param');
    }
    const state = await StateStorage.collection.findOne({});
    const initialSyncComplete =
      state && state.initialSyncComplete && state.initialSyncComplete.includes(`${chain}:${network}`);
    const walletConfig = Config.for('api').wallets;
    const canCreate = walletConfig && walletConfig.allowCreationBeforeCompleteSync;
    const isP2P = this.isP2p({ chain, network });
    if (isP2P && !initialSyncComplete && !canCreate) {
      throw new Error('Wallet creation not permitted before intitial sync is complete');
    }
    const wallet: IWallet = {
      chain,
      network,
      name,
      pubKey,
      path,
      singleAddress
    };
    await WalletStorage.collection.insertOne(wallet);
    return wallet;
  }

  async getWallet(params: GetWalletParams) {
    const { chain, pubKey } = params;
    return WalletStorage.collection.findOne({ chain, pubKey });
  }

  streamWalletAddresses(params: StreamWalletAddressesParams) {
    const { chain, network, walletId, req, res } = params;
    const query = { chain, network, wallet: walletId };
    Storage.apiStreamingFind(WalletAddressStorage, query, {}, req, res);
  }

  async walletCheck(params: WalletCheckParams) {
    const { chain, network, wallet } = params;
    return new Promise(resolve => {
      const addressStream = WalletAddressStorage.collection.find({ chain, network, wallet }).project({ address: 1 });
      let sum = 0;
      let lastAddress;
      addressStream.on('data', (walletAddress: IWalletAddress) => {
        if (walletAddress.address) {
          lastAddress = walletAddress.address;
          const addressSum = Buffer.from(walletAddress.address).reduce(
            (tot, cur) => (tot + cur) % Number.MAX_SAFE_INTEGER
          );
          sum = (sum + addressSum) % Number.MAX_SAFE_INTEGER;
        }
      });
      addressStream.on('end', () => {
        resolve({ lastAddress, sum });
      });
    });
  }

  isP2p({ chain, network }) {
    return Config.chainConfig({ chain, network })?.chainSource !== 'p2p';
  }

  async streamMissingWalletAddresses(params: StreamWalletMissingAddressesParams) {
    const { chain, network, pubKey, res } = params;
    const wallet = await WalletStorage.collection.findOne({ pubKey });
    const walletId = wallet!._id!;
    const query = { chain, network, wallets: walletId, spentHeight: { $gte: SpentHeightIndicators.minimum } };
    const cursor = CoinStorage.collection.find(query).addCursorFlag('noCursorTimeout', true);
    const seen = {};
    const stringifyWallets = (wallets: Array<ObjectId>) => wallets.map(w => w.toHexString());
    const allMissingAddresses = new Array<string>();
    let totalMissingValue = 0;
    const missingStream = cursor.pipe(
      new Transform({
        objectMode: true,
        async transform(spentCoin: MongoBound<ICoin>, _, next) {
          if (!seen[spentCoin.spentTxid]) {
            seen[spentCoin.spentTxid] = true;
            // find coins that were spent with my coins
            const spends = await CoinStorage.collection
              .find({ chain, network, spentTxid: spentCoin.spentTxid })
              .addCursorFlag('noCursorTimeout', true)
              .toArray();
            const missing = spends
              .filter(coin => !stringifyWallets(coin.wallets).includes(walletId.toHexString()))
              .map(coin => {
                const { _id, wallets, address, value } = coin;
                totalMissingValue += value;
                allMissingAddresses.push(address);
                return { _id, wallets, address, value, expected: walletId.toHexString() };
              });
            if (missing.length > 0) {
              return next(undefined, { txid: spentCoin.spentTxid, missing });
            }
          }
          return next();
        },
        flush(done) {
          done(null, { allMissingAddresses, totalMissingValue });
        }
      })
    );
    missingStream.pipe(new StringifyJsonStream()).pipe(res);
  }

  async updateWallet(params: UpdateWalletParams) {
    const { wallet, addresses, reprocess = false } = params;
    await WalletAddressStorage.updateCoins({ wallet, addresses, opts: { reprocess } });
  }

  async streamWalletTransactions(params: StreamWalletTransactionsParams) {
    const { chain, network, wallet, res, args } = params;
    const query: any = {
      chain,
      network,
      wallets: wallet._id,
      'wallets.0': { $exists: true }
    };
    if (wallet.chain === 'BTC' && ['testnet3', 'testnet4'].includes(wallet.network)) {
      query['network'] = wallet.network;
    }

    if (args) {
      if (args.startBlock || args.endBlock) {
        query.$or = [];
        if (args.includeMempool) {
          query.$or.push({ blockHeight: SpentHeightIndicators.pending });
        }
        const blockRangeQuery = {} as any;
        if (args.startBlock) {
          blockRangeQuery.$gte = Number(args.startBlock);
        }
        if (args.endBlock) {
          blockRangeQuery.$lte = Number(args.endBlock);
        }
        query.$or.push({ blockHeight: blockRangeQuery });
      } else {
        if (args.startDate) {
          const startDate = new Date(args.startDate);
          if (startDate.getTime()) {
            query.blockTimeNormalized = { $gte: new Date(args.startDate) };
          }
        }
        if (args.endDate) {
          const endDate = new Date(args.endDate);
          if (endDate.getTime()) {
            query.blockTimeNormalized = query.blockTimeNormalized || {};
            query.blockTimeNormalized.$lt = new Date(args.endDate);
          }
        }
      }
    }

    const transactionStream = TransactionStorage.collection
      .find(query)
      .sort({ blockTimeNormalized: 1 })
      .addCursorFlag('noCursorTimeout', true);
    const listTransactionsStream = new this.WalletStreamTransform(wallet);
    transactionStream.pipe(listTransactionsStream).pipe(res);
  }

  async getWalletBalance(params: GetWalletBalanceParams): Promise<WalletBalanceType> {
    const query = {
      wallets: params.wallet._id,
      'wallets.0': { $exists: true },
      spentHeight: { $lt: SpentHeightIndicators.minimum },
      mintHeight: { $gt: SpentHeightIndicators.conflicting }
    };
    if (params.wallet.chain === 'BTC' && ['testnet3', 'testnet4'].includes(params.wallet.network)) {
      query['network'] = params.wallet.network;
    }
    return CoinStorage.getBalance({ query });
  }

  async getWalletBalanceAtTime(params: GetWalletBalanceAtTimeParams): Promise<WalletBalanceType> {
    const { chain, network, time } = params;
    const query = { wallets: params.wallet._id, 'wallets.0': { $exists: true } };
    if (params.wallet.chain === 'BTC' && ['testnet3', 'testnet4'].includes(params.wallet.network)) {
      query['network'] = params.wallet.network;
    }
    return CoinStorage.getBalanceAtTime({ query, time, chain, network });
  }

  async streamWalletUtxos(params: StreamWalletUtxosParams) {
    const { wallet, limit, args = {}, req, res } = params;
    const query: any = {
      wallets: wallet._id,
      'wallets.0': { $exists: true },
      mintHeight: { $gt: SpentHeightIndicators.conflicting }
    };
    if (wallet.chain === 'BTC' && ['testnet3', 'testnet4'].includes(wallet.network)) {
      query['network'] = wallet.network;
    }
    if (args.includeSpent !== 'true') {
      if (args.includePending === 'true') {
        query.spentHeight = { $lte: SpentHeightIndicators.pending };
      } else {
        query.spentHeight = { $lt: SpentHeightIndicators.pending };
      }
    }
    const tip = await this.getLocalTip(params);
    const tipHeight = tip ? tip.height : 0;
    const utxoTransform = (c: Partial<ICoin>): string => {
      let confirmations = 0;
      if (c.mintHeight && c.mintHeight >= 0) {
        confirmations = tipHeight - c.mintHeight + 1;
      }
      c.confirmations = confirmations;
      return CoinStorage._apiTransform(c) as string;
    };

    Storage.apiStreamingFind(CoinStorage, query, { limit }, req, res, utxoTransform);
  }

  async getFee(params: GetEstimateSmartFeeParams) {
    const { chain, network, target, mode } = params;
    const cacheKey = `getFee-${chain}-${network}-${target}${mode ? '-' + mode.toLowerCase() : ''}`;
    return CacheStorage.getGlobalOrRefresh(
      cacheKey,
      async () => {
        return this.getRPC(chain, network).getEstimateSmartFee(Number(target), mode);
      },
      5 * CacheStorage.Times.Minute
    );
  }

  async broadcastTransaction(params: BroadcastTransactionParams) {
    const { chain, network, rawTx } = params;
    const txids = new Array<string>();
    const rawTxs = typeof rawTx === 'string' ? [rawTx] : rawTx;
    for (const tx of rawTxs) {
      const txid = await this.getRPC(chain, network).sendTransaction(tx);
      txids.push(txid);
    }
    return txids.length === 1 ? txids[0] : txids;
  }

  async getCoinsForTx({ chain, network, txid }: { chain: string; network: string; txid: string }) {
    const tx = await TransactionStorage.collection.findOne({ txid });
    if (!tx) {
      throw new Error(`No such transaction ${txid}`);
    }

    const tip = await this.getLocalTip({ chain, network });
    const confirmations = (tip && tx.blockHeight! > -1) ? tip.height - tx.blockHeight! + 1 : 0;

    const inputs = await CoinStorage.collection
      .find({
        chain,
        network,
        spentTxid: txid
      })
      .addCursorFlag('noCursorTimeout', true)
      .toArray();

    const outputs = await CoinStorage.collection
      .find({
        chain,
        network,
        mintTxid: txid
      })
      .addCursorFlag('noCursorTimeout', true)
      .toArray();

    return {
      inputs: inputs.map(input => CoinStorage._apiTransform(input, { object: true, confirmations })),
      outputs: outputs.map(output => CoinStorage._apiTransform(output, { object: true, confirmations }))
    };
  }

  async getDailyTransactions(params: DailyTransactionsParams) {
    const { chain, network, startDate, endDate } = params;
    const formatDate = (d: Date) => new Date(d.toISOString().split('T')[0]);
    const todayTruncatedUTC = formatDate(new Date());
    let oneMonth = new Date(todayTruncatedUTC);
    oneMonth.setDate(todayTruncatedUTC.getDate() - 30);
    oneMonth = formatDate(oneMonth);

    const isValidDate = (d: string) => {
      return new Date(d).toString() !== 'Invalid Date';
    };
    const start = startDate && isValidDate(startDate) ? new Date(startDate) : oneMonth;
    const end = endDate && isValidDate(endDate) ? formatDate(new Date(endDate)) : todayTruncatedUTC;
    const results = await BitcoinBlockStorage.collection
      .aggregate<{ date: string; transactionCount: number }>([
        {
          $match: {
            chain,
            network,
            timeNormalized: {
              $gte: start,
              $lt: end
            }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$timeNormalized'
              }
            },
            transactionCount: {
              $sum: '$transactionCount'
            }
          }
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            transactionCount: '$transactionCount'
          }
        },
        {
          $sort: {
            date: 1
          }
        }
      ])
      .toArray();
    return {
      chain,
      network,
      results
    };
  }

  async getLocalTip({ chain, network }) {
    return BitcoinBlockStorage.getLocalTip({ chain, network });
  }

  /**
   * Get a series of hashes that come before a given height, or the 30 most recent hashes
   *
   * @returns {Promise<Array<string>>}
   */
  async getLocatorHashes(params): Promise<Array<string>> {
    const { chain, network, startHeight, endHeight } = params;
    const query =
      startHeight && endHeight
        ? {
          processed: true,
          chain,
          network,
          height: { $gt: startHeight, $lt: endHeight }
        }
        : {
          processed: true,
          chain,
          network
        };
    const locatorBlocks = await BitcoinBlockStorage.collection
      .find(query).sort({ height: -1 }).limit(30)
      .addCursorFlag('noCursorTimeout', true)
      .toArray();
    if (locatorBlocks.length < 2) {
      return [Array(65).join('0')];
    }
    return locatorBlocks.map(block => block.hash);
  }

  public isValid(params) {
    const { input } = params;

    if (this.isValidBlockOrTx(input)) {
      return { isValid: true, type: 'blockOrTx' };
    } else if (this.isValidAddress(params)) {
      return { isValid: true, type: 'addr' };
    } else if (this.isValidBlockIndex(input)) {
      return { isValid: true, type: 'blockOrTx' };
    } else {
      return { isValid: false, type: 'invalid' };
    }
  }

  private isValidBlockOrTx(inputValue: string): boolean {
    const regexp = /^[0-9a-fA-F]{64}$/;
    if (regexp.test(inputValue)) {
      return true;
    } else {
      return false;
    }
  }

  private isValidAddress(params): boolean {
    const { chain, network, input } = params;
    const addr = this.extractAddress(input);
    return !!Validation.validateAddress(chain, network, addr);
  }

  private isValidBlockIndex(inputValue): boolean {
    return isFinite(inputValue);
  }

  private extractAddress(address: string): string {
    const extractedAddress = address.replace(/^(bitcoincash:|bchtest:|bitcoin:)/i, '').replace(/\?.*/, '');
    return extractedAddress || address;
  }

  async getWalletAddresses(walletId: ObjectId) {
    const query = { chain: this.chain, wallet: walletId };
    return WalletAddressStorage.collection
      .find(query)
      .addCursorFlag('noCursorTimeout', true)
      .toArray();
  }

  async getBlockFee(params: {
    chain: string;
    network: string;
    blockId: string;
  }) {
    const { chain, network, blockId } = params;
    const transactions = blockId.length >= 64 
      ? await TransactionStorage.collection.find({ chain, network, blockHash: blockId }).toArray()
      : await TransactionStorage.collection.find({ chain, network, blockHeight: parseInt(blockId, 10) }).toArray();
    if (transactions.length <= 1)
      return { feeTotal: 0, mean: 0, median: 0, mode: 0 };

    let feeRateSum = 0;
    let feeTotal = 0;
    const feeRates: number[] = [];
    const freq = {};
    let mode = 0, maxCount = 0;
    for (const tx of transactions) {
      if (tx.coinbase) continue; // skip coinbase transaction
      const rate = tx.fee && tx.size ? tx.fee / tx.size : 0; // does not add fee rate 0 or divide by zero
      feeRates.push(rate);
      feeRateSum += rate;
      feeTotal += tx.fee || 0;
      
      freq[rate] = (freq[rate] || 0) + 1;
      if (freq[rate] > maxCount) {
        mode = rate;
        maxCount = freq[rate];
      }
    }
    const mean = feeRateSum / feeRates.length;
    feeRates.sort((a, b) => a - b);
    const median = feeRates.length % 2 === 1
      ? feeRates[Math.floor(feeRates.length / 2)]
      : (feeRates[feeRates.length / 2 - 1] + feeRates[feeRates.length / 2]) / 2;

    return { feeTotal, mean, median, mode };
  }
}
