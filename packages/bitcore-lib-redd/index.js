'use strict';

var reddcore = module.exports;

// module information
reddcore.version = 'v' + require('./package.json').version;
reddcore.versionGuard = function(version) {
  if (version !== undefined) {
    var message = 'More than one instance of reddcore-lib found. ' +
      'Please make sure to require reddcore-lib and check that submodules do' +
      ' not also include their own reddcore-lib dependency.';
    throw new Error(message);
  }
};
reddcore.versionGuard(global._reddcore);
global._reddcore = reddcore.version;

// crypto
reddcore.crypto = {};
reddcore.crypto.BN = require('./lib/crypto/bn');
reddcore.crypto.ECDSA = require('./lib/crypto/ecdsa');
reddcore.crypto.Schnorr = require('./lib/crypto/schnorr');
reddcore.crypto.Hash = require('./lib/crypto/hash');
reddcore.crypto.Random = require('./lib/crypto/random');
reddcore.crypto.Point = require('./lib/crypto/point');
reddcore.crypto.Signature = require('./lib/crypto/signature');
reddcore.crypto.TaggedHash = require('./lib/crypto/taggedhash');

// encoding
reddcore.encoding = {};
reddcore.encoding.Base58 = require('./lib/encoding/base58');
reddcore.encoding.Base58Check = require('./lib/encoding/base58check');
reddcore.encoding.BufferReader = require('./lib/encoding/bufferreader');
reddcore.encoding.BufferWriter = require('./lib/encoding/bufferwriter');
reddcore.encoding.Varint = require('./lib/encoding/varint');

// utilities
reddcore.util = {};
reddcore.util.buffer = require('./lib/util/buffer');
reddcore.util.js = require('./lib/util/js');
reddcore.util.preconditions = require('./lib/util/preconditions');

// errors thrown by the library
reddcore.errors = require('./lib/errors');

// main bitcoin library
reddcore.Address = require('./lib/address');
reddcore.Block = require('./lib/block');
reddcore.MerkleBlock = require('./lib/block/merkleblock');
reddcore.BlockHeader = require('./lib/block/blockheader');
reddcore.HDPrivateKey = require('./lib/hdprivatekey.js');
reddcore.HDPublicKey = require('./lib/hdpublickey.js');
reddcore.Message = require('./lib/message');
reddcore.Networks = require('./lib/networks');
reddcore.Opcode = require('./lib/opcode');
reddcore.PrivateKey = require('./lib/privatekey');
reddcore.PublicKey = require('./lib/publickey');
reddcore.Script = require('./lib/script');
reddcore.Transaction = require('./lib/transaction');
reddcore.URI = require('./lib/uri');
reddcore.Unit = require('./lib/unit');

// dependencies, subject to change
reddcore.deps = {};
reddcore.deps.bnjs = require('bn.js');
reddcore.deps.bs58 = require('bs58');
reddcore.deps.Buffer = Buffer;
reddcore.deps.elliptic = require('elliptic');
reddcore.deps._ = require('lodash');

// Internal usage, exposed for testing/advanced tweaking
reddcore.Transaction.sighash = require('./lib/transaction/sighash');
