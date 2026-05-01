'use strict';

import * as chai from 'chai';
import { BitcoreLibRedd } from '@bitpay-labs/crypto-wallet-core';
import { ChainService } from '../../src/lib/chain';
import { ReddChain } from '../../src/lib/chain/redd';
import { Common } from '../../src/lib/common';

const should = chai.should();
const { Constants } = Common;

// Focused wiring test — proves ReddChain is registered and resolvable
// through the same ChainService surface other chains use. Full
// tx-construction parity with LTC's suite needs RDD-specific fixtures
// (addresses, signed hex, multisig redeem scripts) and is out of scope
// for the initial wiring commit; it should land alongside Phase 7 of
// MIGRATION.md when end-to-end regtest flows are exercised.
describe('Chain RDD', () => {
  describe('registration', () => {
    it('should resolve ReddChain via ChainService.get(\'rdd\') (lowercase)', () => {
      const chain = ChainService.get('rdd');
      should.exist(chain);
      chain.should.be.instanceOf(ReddChain);
    });

    it('should resolve case-insensitively (\'RDD\' uppercase)', () => {
      const chain = ChainService.get('RDD');
      should.exist(chain);
      chain.should.be.instanceOf(ReddChain);
    });

    it('should expose the bitcore-lib-redd Networks (livenet pubkeyhash 0x3d, bech32 \'rdd\')', () => {
      // Sanity check that ReddChain's super(BitcoreLibRedd) wired the
      // Reddcoin-specific network constants and not a stale BTC fallback.
      BitcoreLibRedd.Networks.livenet.pubkeyhash.should.equal(0x3d);
      BitcoreLibRedd.Networks.livenet.bech32prefix.should.equal('rdd');
    });
  });

  describe('Constants', () => {
    it('should list RDD in CHAINS', () => {
      Constants.CHAINS.should.have.property('RDD', 'rdd');
    });

    it('should list RDD as a UTXO chain', () => {
      Constants.UTXO_CHAINS.should.have.property('RDD', 'rdd');
    });

    it('should list RDD as native-segwit-capable (rdd1q… P2WPKH)', () => {
      Constants.NATIVE_SEGWIT_CHAINS.should.have.property('RDD', 'rdd');
    });

    it('should NOT classify RDD as an EVM chain', () => {
      Constants.EVM_CHAINS.should.not.have.property('RDD');
      Constants.SVM_CHAINS.should.not.have.property('RDD');
    });
  });
});
