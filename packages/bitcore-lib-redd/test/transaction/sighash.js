'use strict';

var buffer = require('buffer');

var chai = require('chai');
var should = chai.should();
var bitcore = require('../../');
var Script = bitcore.Script;
var Transaction = bitcore.Transaction;
var sighash = Transaction.sighash;

var vectors_sighash = require('../data/sighash.json');

describe('sighash', function() {

  vectors_sighash.forEach(function(vector, i) {
    if (i === 0) {
      // First element is just a row describing the next ones
      return;
    }
    it('test vector from bitcoind #' + i + ' (' + vector[4].substring(0, 16) + ')', function() {
      var txbuf = Buffer.from(vector[0], 'hex');
      var scriptbuf = Buffer.from(vector[1], 'hex');
      var subscript = Script(scriptbuf);
      var nin = vector[2];
      var nhashtype = vector[3];
      var sighashbuf = Buffer.from(vector[4], 'hex');
      var tx = new Transaction(txbuf);

      // Make sure transaction to/from buffer is isomorphic. These vectors
      // are bitcoind's; some PoS-version vectors already have a 4-byte
      // tail that the parser reads as nTime, others have nothing trailing
      // nLockTime. Either way reddcoin's serialiser always emits an
      // nTime for v2+, so the round-trip equals the source bytes when
      // nTime was present, or the source bytes plus '00000000' when it
      // wasn't.
      var actual = tx.uncheckedSerialize();
      var expected = txbuf.toString('hex');
      if (tx.version > Transaction.POW_TX_VERSION && actual !== expected) {
        expected += '00000000';
      }
      actual.should.equal(expected);

      // Sighash ought to be correct. Reddcoin's toSigningBuffer (used by
      // sighash.sighash) deliberately excludes nTime, so the sighash bytes
      // match bitcoind's expected hashes even though the on-wire tx
      // serialisation differs by 4 bytes.
      sighash.sighash(tx, nhashtype, nin, subscript).toString('hex').should.equal(sighashbuf.toString('hex'));
    });
  });
});
