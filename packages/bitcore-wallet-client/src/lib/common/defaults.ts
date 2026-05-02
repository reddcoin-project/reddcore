'use strict';

export const Defaults = {
  DEFAULT_FEE_PER_KB: 10000,
  MIN_FEE_PER_KB: 0,
  MAX_FEE_PER_KB: 1000000,
  MAX_TX_FEE(chain) {
    switch (chain) {
      case 'btc':
        return 0.5e8;
      case 'doge':
        return 400e8;
      case 'rdd':
        // Matches reddcoin Core's DEFAULT_TRANSACTION_MAXFEE
        // (src/wallet/wallet.h:107) = COIN = 1 RDD per tx. Reddcoin's
        // fee structure mirrors Litecoin's, not DOGE's; the high nominal
        // supply doesn't translate into a high relay-floor.
        return 1e8;
      default:
        return 1e8;
    }
  },
  TSS_KEYGEN_SCHEME_VERSION: 1,
  TSS_SIGGEN_SCHEME_VERSION: 1,
};
