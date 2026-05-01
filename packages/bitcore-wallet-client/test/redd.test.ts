'use strict';

import * as chai from 'chai';
import { BitcoreLibRedd } from '@bitpay-labs/crypto-wallet-core';
import { Defaults } from '../src/lib/common/defaults';
import { Key } from '../src/lib/key';

const should = chai.should();

// Focused wiring test for Reddcoin support in bitcore-wallet-client.
// Mirrors the bws redd.test.ts approach — proves that the chain-keyed
// hooks scattered through the client (Bitcore_ maps, BIP-44 coin-type
// lookups, MAX_TX_FEE table) all recognise `'rdd'` and route to the
// Reddcoin lib. End-to-end create/sign/broadcast is deferred to
// MIGRATION.md Phase 7 once a regtest reddcoind is wired in.
describe('Chain RDD (bitcore-wallet-client)', () => {
  describe('BitcoreLibRedd re-export', () => {
    it('should expose Reddcoin Networks (livenet pubkeyhash 0x3d, bech32 \'rdd\')', () => {
      BitcoreLibRedd.Networks.livenet.pubkeyhash.should.equal(0x3d);
      BitcoreLibRedd.Networks.livenet.bech32prefix.should.equal('rdd');
    });

    it('should validate a known RDD legacy address', () => {
      // Generator-point fixture: secp256k1 priv 1 → public key G → R-prefix
      // address on Reddcoin livenet. Same vector used in cwc validation tests.
      const known = 'RjJ4cn5Bg58D2khGiNRmQW1yWtA6Py9kWa';
      BitcoreLibRedd.Address.isValid(known, 'livenet').should.equal(true);
    });

    it('should validate a known RDD bech32 address (P2WPKH)', () => {
      const knownBech32 = 'rdd1qw508d6qejxtdg4y5r3zarvary0c5xw7ks0ue9n';
      BitcoreLibRedd.Address.isValid(knownBech32, 'livenet').should.equal(true);
    });
  });

  describe('Defaults.MAX_TX_FEE', () => {
    it('should return a chain-specific cap for rdd (not the generic default)', () => {
      const generic = Defaults.MAX_TX_FEE('does-not-exist');
      const rdd = Defaults.MAX_TX_FEE('rdd');
      // The 'rdd' branch must be hit (case in the switch) — the value is
      // higher than the generic 1e8 default because Reddcoin's denomination
      // is high-supply / low per-unit USD value, like DOGE.
      rdd.should.be.above(generic);
    });
  });

  describe('Key BIP-44 derivation path for RDD', () => {
    const xprv = 'xprv9s21ZrQH143K3zLpjtB4J4yrRfDTEfbrMa9vLZaTAv5BzASwBmA16mdBmZKpMLssw1AzTnm31HAD2pk2bsnZ9dccxaLD48mRdhtw82XoiBi';

    it('should return m/44\'/4\'/0\' for chain rdd, account 0 (SLIP-0044 coin type 4)', () => {
      const k = new Key({ seedType: 'extendedPrivateKey', seedData: xprv });
      const path = k.getBaseAddressDerivationPath({
        account: 0,
        coin: 'rdd',
        n: 1
      });
      path.should.equal("m/44'/4'/0'");
    });

    it('should accept rdd as a recognised chain in createCredentials', () => {
      const k = new Key({ seedType: 'extendedPrivateKey', seedData: xprv });
      const c = k.createCredentials(null, {
        coin: 'rdd',
        account: 0,
        network: 'livenet',
        n: 1
      });
      should.exist(c);
      // No assertion on internal credential shape — we just need
      // createCredentials() to not throw "unknown chain: rdd".
    });
  });
});
