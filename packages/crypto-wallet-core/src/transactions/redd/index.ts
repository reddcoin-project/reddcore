import BitcoreLibRedd from '@reddcoinproject/bitcore-lib-redd';
import { BTCTxProvider } from '../btc';

export class RDDTxProvider extends BTCTxProvider {
  lib = BitcoreLibRedd;
  // PoSV note: bitcore-lib-redd's `_newTransaction` sets `nTime = 0` so
  // serialised tx bytes are deterministic. Reddcoind stamps the actual
  // time at broadcast/relay; the wallet path produces the canonical
  // bytes the network expects without further plumbing here.
  create({ recipients, utxos = [], change, feeRate, fee = 20000 }) {
    const filteredUtxos = this.selectCoins(recipients, utxos, fee);
    const btcUtxos = filteredUtxos.map(utxo => {
      const btcUtxo = Object.assign({}, utxo, {
        amount: utxo.value / 1e8,
        txid: utxo.mintTxid,
        outputIndex: utxo.mintIndex
      });
      return new this.lib.Transaction.UnspentOutput(btcUtxo);
    });
    const tx = new this.lib.Transaction().from(btcUtxos);
    if (fee) {
      tx.fee(fee);
    }
    if (feeRate) {
      tx.feePerKb(Number(feeRate) * 1000); // feeRate is in feePerByte
    }
    if (change) {
      tx.change(change);
    }
    for (const recipient of recipients) {
      tx.to(recipient.address, parseInt(recipient.amount));
    }
    return tx.uncheckedSerialize();
  }
}
