'use strict';
// Reddcoin-specific assertions against the freshly-installed
// @reddcoinproject/bitcore-lib-redd. Run via scripts/smoke-test.sh.

const reddcore = require('@reddcoinproject/bitcore-lib-redd');

let pass = 0, fail = 0;
function check(label, ok, expected, actual) {
  if (ok) { console.log('  OK   ' + label); pass++; }
  else { console.log('  FAIL ' + label + ' (expected ' + expected + ', got ' + actual + ')'); fail++; }
}

console.log('=== Networks ===');
const live = reddcore.Networks.livenet;
const test = reddcore.Networks.testnet;
check('livenet pubkeyhash 0x3d', live.pubkeyhash === 0x3d, '0x3d', '0x' + live.pubkeyhash.toString(16));
check('livenet privatekey 0xbd', live.privatekey === 0xbd, '0xbd', '0x' + live.privatekey.toString(16));
check('livenet bech32 = rdd', live.bech32prefix === 'rdd', 'rdd', live.bech32prefix);
check('livenet port 45444', live.port === 45444, 45444, live.port);
check('livenet magic fbc0b6db', live.networkMagic.toString('hex') === 'fbc0b6db', 'fbc0b6db', live.networkMagic.toString('hex'));
check('testnet pubkeyhash 0x6f', test.pubkeyhash === 0x6f, '0x6f', '0x' + test.pubkeyhash.toString(16));
check('testnet bech32 = trdd', test.bech32prefix === 'trdd', 'trdd', test.bech32prefix);

console.log('=== Address ===');
const addr = reddcore.Address.fromString('RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV');
check('R-prefixed P2PKH parses', addr.toString() === 'RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV');
check('address network = livenet', addr.network.name === 'livenet');
check('address type = pubkeyhash', addr.type === 'pubkeyhash');

console.log('=== PrivateKey / WIF ===');
const pk = new reddcore.PrivateKey('UxbB4W72649zAoWBXKbnTtt437yHn6FPmVjdkrUtoSSXE4gwagjA');
check('reddcoin compressed WIF parses', pk.toString() === '0000000000000000000000000000000000000000000000000000000000000001');
check('derives address RjJ4cn5Bg58D2khGiNRmQW1yWtA6Py9kWa', pk.toAddress().toString() === 'RjJ4cn5Bg58D2khGiNRmQW1yWtA6Py9kWa');

console.log('=== Transaction (PoS nTime) ===');
const tx = new reddcore.Transaction();
check('new tx version = 2', tx.version === 2);
check('new tx nTime = 0', tx.nTime === 0);
check('empty v2 tx serialises with nTime', tx.toBuffer().toString('hex') === '0200000000000000000000000000');

console.log('=== Block (PoS detection) ===');
check('Block has isProofOfStake', typeof reddcore.Block.prototype.isProofOfStake === 'function');
check('Block has isProofOfWork', typeof reddcore.Block.prototype.isProofOfWork === 'function');

console.log('=== URI ===');
const uri = new reddcore.URI('reddcoin:RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV?amount=1.0');
check('reddcoin: URI scheme parses', uri.address.toString() === 'RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV');
check('amount converts to satoshis', uri.amount === 100000000);

console.log('=== Hash format helpers ===');
check('formatHash exists', typeof reddcore.crypto.Hash.formatHash === 'function');
check('formatHashFull exists', typeof reddcore.crypto.Hash.formatHashFull === 'function');

console.log('=== Output coinstake helper ===');
check('Output.isNull exists', typeof reddcore.Transaction.Output.prototype.isNull === 'function');

console.log('=== Transaction coinstake helper ===');
check('Transaction.isCoinStake exists', typeof reddcore.Transaction.prototype.isCoinStake === 'function');

console.log('=== Unit (RDD) ===');
const Unit = reddcore.Unit;
check('Unit.RDD constant', Unit.RDD === 'RDD');
check('Unit.mRDD constant', Unit.mRDD === 'mRDD');
check('Unit.fromRDD is a function', typeof Unit.fromRDD === 'function');
check('Unit.fromRDD(1).toSatoshis() === 1e8', Unit.fromRDD(1).toSatoshis() === 1e8);
check('Unit.fromSatoshis(1e8).toRDD() === 1', Unit.fromSatoshis(1e8).toRDD() === 1);
check('Old BTC API removed', Unit.BTC === undefined);

console.log();
console.log('lib-redd: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
