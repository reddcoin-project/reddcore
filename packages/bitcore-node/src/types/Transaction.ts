export interface TransactionJSON {
  txid: string;
  chain: string;
  network: string;
  blockHeight: number;
  blockHash: string;
  blockTime: string;
  blockTimeNormalized: string;
  coinbase: boolean;
  /** Reddcoin PoSV-only; absent on chains without a stake mechanism. */
  coinstake?: boolean;
  fee: number;
  /** For coinstake txs: subsidy + collected_fees. Absent otherwise. */
  stakeReward?: number;
  size: number;
  locktime: number;
  inputCount: number;
  outputCount: number;
  value: number | string;
  replacedByTxid?: string;
}
