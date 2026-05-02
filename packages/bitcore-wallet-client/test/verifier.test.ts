'use strict';

import * as chai from 'chai';
import { Verifier } from '../src/lib/verifier';
import { Key } from '../src/lib/key';

chai.should();

const aKey = new Key({
  seedData: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  seedType: 'mnemonic'
});

describe('Verifier', function() {
  describe('checkAddress', function() {
    it('should verify a BTC  address', () => {
      const cred = aKey.createCredentials(null, { coin: 'btc', network: 'livenet', account: 0, n: 1 });
      cred.addWalletInfo('id', 'name', 1, 1, 'copayer');

      Verifier.checkAddress(cred, {
        address: '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA',
        path: 'm/0/0',
        publicKeys: ['03aaeb52dd7494c361049de67cc680e83ebcbbbdbeb13637d92cd845f70308af5e']
      }).should.be.true;
    });

    it('should verify a ETH address', () => {
      const cred = aKey.createCredentials(null, { coin: 'eth', network: 'livenet', account: 0, n: 1 });
      cred.addWalletInfo('id', 'name', 1, 1, 'copayer');

      Verifier.checkAddress(cred, {
        address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
        path: 'm/0/0',
        publicKeys: ['0237b0bb7a8288d38ed49a524b5dc98cff3eb5ca824c9f9dc0dfdb3d9cd600f299']
      }).should.be.true;
    });

    it('should verify a MATIC address', () => {
      const cred = aKey.createCredentials(null, { coin: 'matic', network: 'livenet', account: 0, n: 1 });
      cred.addWalletInfo('id', 'name', 1, 1, 'copayer');

      Verifier.checkAddress(cred, {
        address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
        path: 'm/0/0',
        publicKeys: ['0237b0bb7a8288d38ed49a524b5dc98cff3eb5ca824c9f9dc0dfdb3d9cd600f299']
      }).should.be.true;
    });
  });

  describe('checkProposalCreation (BIT-18)', function() {
    // sharedEncryptingKey is only consulted when args.message or
    // args.outputs[i].message is set; tests below pass undefined which
    // is fine because Utils.decryptMessage short-circuits on falsy ct.
    const noKey = undefined as any;

    it('passes a sendMax txp where caller omitted amount but server filled it', () => {
      const args = {
        outputs: [{ toAddress: 'RUv5cE9smrhwgmiVxoCk73WjGtsZJoTncR' }],
        sendMax: true,
        feePerKb: 100000
      };
      const txp = {
        outputs: [{ toAddress: 'RUv5cE9smrhwgmiVxoCk73WjGtsZJoTncR', amount: 12345678 }],
        feePerKb: 100000
      };
      Verifier.checkProposalCreation(args, txp, noKey).should.be.true;
    });

    it('still rejects a sendMax txp where toAddress was tampered with', () => {
      const args = {
        outputs: [{ toAddress: 'RUv5cE9smrhwgmiVxoCk73WjGtsZJoTncR' }],
        sendMax: true,
        feePerKb: 100000
      };
      const txp = {
        outputs: [{ toAddress: 'RWrongAddressxxxxxxxxxxxxxxxxxxxxxx', amount: 12345678 }],
        feePerKb: 100000
      };
      Verifier.checkProposalCreation(args, txp, noKey).should.be.false;
    });

    it('still rejects amount mismatches on the non-sendMax path', () => {
      const args = {
        outputs: [{ toAddress: 'RUv5cE9smrhwgmiVxoCk73WjGtsZJoTncR', amount: 1000 }],
        feePerKb: 100000
      };
      const txp = {
        outputs: [{ toAddress: 'RUv5cE9smrhwgmiVxoCk73WjGtsZJoTncR', amount: 9999 }],
        feePerKb: 100000
      };
      Verifier.checkProposalCreation(args, txp, noKey).should.be.false;
    });

    it('still rejects feePerKb mismatch even when sendMax', () => {
      const args = {
        outputs: [{ toAddress: 'RUv5cE9smrhwgmiVxoCk73WjGtsZJoTncR' }],
        sendMax: true,
        feePerKb: 100000
      };
      const txp = {
        outputs: [{ toAddress: 'RUv5cE9smrhwgmiVxoCk73WjGtsZJoTncR', amount: 12345678 }],
        feePerKb: 999999
      };
      Verifier.checkProposalCreation(args, txp, noKey).should.be.false;
    });
  });
});
