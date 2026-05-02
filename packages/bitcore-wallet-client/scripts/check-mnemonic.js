#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Check whether a candidate mnemonic derives to a target Reddcoin
 * address. Use to verify a recovered mnemonic against the wallet
 * holding 10 RDD at RtHrtNEsPUPX9vxmD86KY9VqLQTvbXezct.
 *
 * USAGE:
 *   node scripts/check-mnemonic.js "word1 word2 ... word12"
 *   node scripts/check-mnemonic.js "..." --target=Ro9wr...
 *
 * Tests several common derivation variations: paths m/44'/4'/0',
 * m/44'/0'/0' (BTC fall-through), m/44'/60'/0' (ETH fall-through),
 * indices 0..3 of the change=0 chain. Reports any match.
 */

const Mnemonic = require('@bitpay-labs/bitcore-mnemonic');
const Redd = require('@reddcoinproject/bitcore-lib-redd');

const args = process.argv.slice(2);
const targetIdx = args.findIndex(a => a.startsWith('--target='));
const target = targetIdx >= 0
  ? args[targetIdx].split('=')[1]
  : 'RtHrtNEsPUPX9vxmD86KY9VqLQTvbXezct';
const words = args.filter(a => !a.startsWith('--target=')).join(' ').trim();

if (!words || words.split(/\s+/).length < 12) {
  console.error('Pass the 12 mnemonic words as a single argument (quoted).');
  process.exit(1);
}

console.log('Mnemonic word count:', words.split(/\s+/).length);
console.log('Target address     :', target);
console.log('---');

let m;
try {
  m = new Mnemonic(words);
} catch (e) {
  console.error('Invalid mnemonic checksum:', e.message);
  process.exit(1);
}
const seed = m.toSeed();

const livenet = Redd.HDPrivateKey.fromSeed(seed, Redd.Networks.livenet);
const testnet = Redd.HDPrivateKey.fromSeed(seed, Redd.Networks.testnet);

const paths = [
  "m/44'/4'/0'",   // RDD coin type (correct)
  "m/44'/0'/0'",   // BTC coin type (in case of cross-chain reuse)
  "m/44'/60'/0'",  // ETH default (Utils.getChain fall-through pre-cwc fix)
  "m/44'/1'/0'",   // testnet/regtest convention
];

for (const hd of [{ name: 'livenet', root: livenet, network: Redd.Networks.livenet },
  { name: 'testnet', root: testnet, network: Redd.Networks.testnet }]) {
  for (const p of paths) {
    let acc;
    try {
      acc = hd.root.deriveChild(p);
    } catch { continue; }
    for (const change of [0, 1]) {
      for (let i = 0; i < 4; i++) {
        const child = acc.deriveChild(`m/${change}/${i}`);
        const addr = child.publicKey.toAddress(hd.network).toString();
        const match = addr === target;
        if (match || i === 0) {
          console.log(`${hd.name} ${p}/${change}/${i} → ${addr}${match ? '   ★ MATCH' : ''}`);
        }
        if (match) {
          console.log('---');
          console.log('Match found! Mnemonic recovers the target address.');
          process.exit(0);
        }
      }
    }
  }
}
console.log('---');
console.log('No match.');
process.exit(2);
