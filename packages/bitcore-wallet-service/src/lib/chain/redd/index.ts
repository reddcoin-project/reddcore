import { BitcoreLibRedd } from '@bitpay-labs/crypto-wallet-core';
import { IChain } from '../../../types/chain';
import { BtcChain } from '../../chain/btc';

export class ReddChain extends BtcChain implements IChain {
  constructor() {
    super(BitcoreLibRedd);
  }
  // Reddcoin's mempool fee policy and tx-size limits track Bitcoin's
  // closely enough that no per-chain override is needed here today.
  // PoSV-specific tx fields (the nTime byte on v2+ txs) are handled
  // inside bitcore-lib-redd's Transaction class — the wallet path
  // produces canonical bytes via uncheckedSerialize() and reddcoind
  // stamps the actual time at relay, so no plumbing is required at
  // this layer.
}
