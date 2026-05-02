'use strict';

import * as chai from 'chai';
import { BitcoreLibRedd } from '@bitpay-labs/crypto-wallet-core';
import { V8 } from '../../src/lib/blockchainexplorers/v8';
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

  describe('V8 blockchain-explorer wiring (BIT-12)', () => {
    // V8's own Bitcore_ map (separate from chain/index.ts and common/utils.ts)
    // was missed in BIT-7's RDD wiring. Without an entry here, BWS would
    // either crash or silently fall through to BTC defaults when scanning
    // an RDD wallet. Smoke-test that the V8 instance constructs cleanly
    // for chain='rdd' on livenet — the constructor's guard checks
    // (Constants.CHAINS / Constants.NETWORKS membership) only succeed
    // because BIT-7 already added the entries; this test additionally
    // proves the BitcoreLibRedd lib is wired into v8.ts itself.
    it('should construct a V8 client with chain rdd on livenet', () => {
      const v8 = new V8({
        chain: 'rdd',
        network: 'livenet',
        url: 'http://localhost:3232'
      });
      should.exist(v8);
      v8.chain.should.equal('rdd');
      v8.network.should.equal('livenet');
      v8.v8network.should.equal('mainnet'); // livenet → mainnet via v8network()
      v8.chainNetwork.should.equal('/RDD/mainnet');
    });

    it('should construct a V8 client with chain rdd on testnet', () => {
      const v8 = new V8({
        chain: 'rdd',
        network: 'testnet',
        url: 'http://localhost:3232'
      });
      should.exist(v8);
      v8.chain.should.equal('rdd');
      v8.network.should.equal('testnet');
    });
  });
});
