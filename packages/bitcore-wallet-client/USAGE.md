# Using bitcore-wallet-client

A developer's guide to driving a Bitcore Wallet Service instance
programmatically. The package exports an `API` (the REST/JSON-RPC
client) and a `Key` (the HD-wallet primitive). Together they own the
full create → fund → read → spend lifecycle.

If you've never used BWS before, start with the package
[`README.md`](./README.md) for the npm install + a multi-copayer multisig
example. This document covers the **single-signer flow** end-to-end —
that's the path you want for any wallet UI, exchange integration,
treasury bot, or chain-specific tool. Multisig and TSS get a one-line
appendix at the end.

This guide is written from the live bring-up of the Reddcoin wallet
stack (`packages/bitcore-wallet-service` + `packages/bitcore-node` +
`reddcoind` mainnet). Every section corresponds to a script in
[`scripts/`](./scripts/) that exercises the path; treat those scripts
as the executable spec. If a snippet here drifts from what they do in
practice, the scripts are right.

---

## Contents

1. [Concepts](#concepts)
2. [Create a wallet](#create-a-wallet)
3. [Persist credentials — and never lose a mnemonic](#persist-credentials--and-never-lose-a-mnemonic)
4. [Recover an existing wallet](#recover-an-existing-wallet)
5. [Read wallet state](#read-wallet-state)
6. [Spend (build, sign, broadcast)](#spend-build-sign-broadcast)
7. [Multisig / TSS](#multisig--tss)
8. [API reference quick-jump](#api-reference-quick-jump)

---

## Concepts

| Object | Source | Purpose |
|---|---|---|
| `Key` | `import { Key } from '@bitpay-labs/bitcore-wallet-client'` | The HD root: 12-word mnemonic ↔ xPriv. Knows nothing about BWS. |
| `Credentials` | Returned by `key.createCredentials(...)` | A per-wallet bundle: xPub for that chain/network/account, plus a fresh `walletPrivKey` (request-signing) and `requestPrivKey` (auth). Created once at wallet creation; **must be persisted** for that copayer to ever re-attach. |
| `API` | `new API({ baseUrl, ... })` | The REST client. Stateless until you `client.fromString(<creds-json>)` to bind it to a wallet. |
| `walletId` | Server-assigned at create time | UUID that BWS uses to look up the record. Lives inside the persisted credentials JSON; you never construct it manually. |
| `txp` | Returned by `createTxProposal(...)` | A proposed transaction. Goes through publish → sign → push-signatures → broadcast. |

The most important fact: **`Key.createCredentials(...)` produces non-deterministic data** (the `walletPrivKey` and `requestPrivKey` are randomly generated). Re-running it with the same mnemonic yields a *different* Credentials JSON. So:

- The xPub is deterministic from the mnemonic + path. BWS recognises a copayer by its xPub-derived `copayerId`.
- The `requestPrivKey` is what BWS *authenticates* you with on subsequent calls. That key is generated once at create time and lives nowhere except wherever you put `client.toString()`.
- If you have only the mnemonic later, you can recover the wallet via `API.serverAssistedImport(...)` — but that re-derives a *new* `requestPrivKey` (deterministically, from `Constants.PATHS.REQUEST_KEY`). It works only if BWS has the matching `requestPubKey` on file from the original create. Which it does for any wallet created via this client; it's the same derivation.

In practice: **always persist the full `client.toString()`** to disk after wallet creation. The mnemonic alone is enough for recovery, but the persisted creds are faster, don't depend on `serverAssistedImport`'s chain-permutation table, and won't surprise you with edge cases.

---

## Create a wallet

[`scripts/smoke-redd.js`](./scripts/smoke-redd.js) is the canonical worked example. Skeleton:

```js
const fs = require('fs');
const { API, Key } = require('@bitpay-labs/bitcore-wallet-client');

const BWS = 'http://localhost:3232/bws/api';
const CHAIN = 'rdd';        // or 'btc', 'bch', 'doge', 'ltc', 'eth', etc
const NETWORK = 'livenet';

(async () => {
  // 1. Generate (or load) the HD key.
  const key = new Key({ seedType: 'new' });
  const mnemonic = key.get(null, /* includeMnemonic */ true).mnemonic;

  // 2. Build per-wallet credentials. The xPub is deterministic from the
  //    mnemonic + chain/account; the walletPrivKey and requestPrivKey
  //    embedded in the result are generated freshly here and exist only
  //    in this object until we persist client.toString() below.
  const creds = key.createCredentials(null, {
    coin: CHAIN,
    chain: CHAIN,
    network: NETWORK,
    account: 0,
    n: 1
  });

  // 3. Stand up an API client and create the wallet on BWS.
  const client = new API({ baseUrl: BWS, timeout: 15000 });
  client.fromString(JSON.stringify(creds));

  await client.createWallet('my-wallet-name', 'my-copayer-name', /*m*/ 1, /*n*/ 1, {
    chain: CHAIN,
    coin: CHAIN,
    network: NETWORK,
    singleAddress: false,
    useNativeSegwit: false
  });

  // 4. PERSIST. Without this, the requestPrivKey is gone the moment
  //    the process exits and you lose the ability to authenticate
  //    against the wallet record on BWS.
  fs.writeFileSync('redd.creds.json', client.toString(), { mode: 0o600 });
  fs.writeFileSync('redd.key.json', JSON.stringify({ mnemonic }), { mode: 0o600 });

  // 5. Get a receive address.
  const addr = await client.createAddress({});
  console.log('Receive at:', addr.address);   // → R...
})();
```

Notes:

- `n=1` is single-signer. For `m`-of-`n` multisig, see [Multisig / TSS](#multisig--tss).
- `useNativeSegwit: true` switches the wallet to bech32 receive addresses (`rdd1q…` for RDD, `bc1q…` for BTC). The chain must support it (`Constants.NATIVE_SEGWIT_CHAINS` in `bws/src/lib/common/constants.ts`).
- The first call to `createAddress` returns `m/0/0`; subsequent calls walk the receive chain (`m/0/1`, `m/0/2`, …). Change addresses (`m/1/...`) are managed internally by BWS — you never request them directly.

---

## Persist credentials — and never lose a mnemonic

This is the section to read twice. We learned it the hard way.

When `smoke-redd.js` was first written it did:

```js
const mnemonic = key.get(null, true).mnemonic;
console.log('Generated mnemonic (KEEP for replay tests):');
console.log('  ', mnemonic);
// ... wallet creation ...
console.log('Receive address:', addr.address);
```

The script then exited. In the terminal where it was run, the output was piped through `tail -25`, which truncated the mnemonic line off the top. The receive address landed at the bottom and was preserved; the mnemonic was lost. **Real RDD was sent to that address before the loss was noticed**; the funds are now permanently inaccessible because:

1. The xPub stored on BWS is enough to *check* balance (we did) but cannot reconstruct the private key.
2. The mnemonic was the only path to the private key. Since the script generated it freshly and only logged it to stdout, there's nowhere on disk to recover from.
3. xpub → mnemonic is one-way crypto; no offline brute-force is tractable.

So: **never generate a mnemonic without persisting it before you do anything else with the resulting wallet**. The pattern in the current `smoke-redd.js` is:

```js
fs.mkdirSync(STATE_DIR, { recursive: true });

let key;
if (fs.existsSync(KEY_PATH)) {
  // Idempotent — if we've created this wallet before, reuse the seed.
  const stored = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  key = new Key({ seedType: 'mnemonic', seedData: stored.mnemonic });
} else {
  key = new Key({ seedType: 'new' });
  const mnemonic = key.get(null, true).mnemonic;
  // FIRST WRITE the mnemonic, THEN proceed.
  fs.writeFileSync(KEY_PATH, JSON.stringify({ mnemonic }, null, 2), { mode: 0o600 });
}
// ... only AFTER persisting do we createCredentials + createWallet ...
fs.writeFileSync(CREDS_PATH, client.toString(), { mode: 0o600 });
```

Two files, both `0o600` (user-only-readable):

| File | Contents | Purpose |
|---|---|---|
| `*.key.json` | `{ "mnemonic": "<12 words>" }` | Recovery seed. Restore-from-backup target. |
| `*.creds.json` | The full `client.toString()` JSON | Re-attach to BWS without going through `serverAssistedImport`. Includes xPub, walletId, walletPrivKey, requestPrivKey. |

`packages/bitcore-wallet-client/.gitignore` excludes `.smoke-state/` so these files never end up in git. A real wallet UI would replace this layout with secure-storage / keychain APIs; the principle is the same — **persist before printing or exiting**.

---

## Recover an existing wallet

There are two paths.

### Fast: from persisted creds JSON

If you have the `*.creds.json` file from create-time, this is one line:

```js
const client = new API({ baseUrl: BWS, timeout: 15000 });
client.fromString(fs.readFileSync('redd.creds.json', 'utf8'));
// Done. client is fully attached.
```

This is what [`scripts/balance-redd.js`](./scripts/balance-redd.js) does by default.

### Slow: from mnemonic alone

If you only have the 12 words, use `serverAssistedImport`:

```js
const clients = await API.serverAssistedImport(
  {
    words: 'word1 word2 ... word12',
    includeTestnetWallets: false,
    includeLegacyWallets: false
  },
  { baseUrl: BWS, timeout: 15000 }
);
// → array, one entry per wallet BWS recognised for this mnemonic
for (const client of clients) {
  console.log('Found wallet:', (await client.getStatus({})).wallet.name);
}
```

What this does internally: derives candidate xPubs across every chain in the `chainPermutations` table at [`src/lib/api.ts` (≈line 3627)](./src/lib/api.ts), POSTs each `{copayerId, signature}` to `/v1/wallets/exist`, and for every match BWS confirms, builds a fully-attached `API` instance.

**Caveat:** the chain has to be in `chainPermutations`. RDD was missing originally; we added it in commit `7242a377b`. If you're recovering a wallet on a chain you've added yourself, ensure your fork has the row. BWS won't volunteer wallets for chains the client doesn't probe.

`scripts/balance-redd.js` falls back to this path when no creds file exists and `MNEMONIC` is set in the environment.

### Verifying a candidate mnemonic without contacting BWS

If you've found *some* mnemonic and want to check whether it derives to a known address (no server roundtrip), use [`scripts/check-mnemonic.js`](./scripts/check-mnemonic.js):

```sh
node scripts/check-mnemonic.js "word1 ... word12" --target=R...
```

It walks the derivation paths the chain might have used (RDD coin type, BTC fall-through, ETH default, testnet conventions) × change × indices 0..3 and reports any match. Useful when you're not sure which derivation a wallet was created with.

---

## Read wallet state

Once a client is attached:

```js
// Wallet record + balance summary.
const status = await client.getStatus({ includeExtendedInfo: true });
console.log('Wallet:', status.wallet.name, status.wallet.chain, status.wallet.network);
console.log('Available:', status.balance.availableAmount, 'sats');
console.log('Confirmed:', status.balance.totalConfirmedAmount, 'sats');

// Per-address breakdown (only addresses with a non-zero balance).
for (const a of status.balance.byAddress || []) {
  console.log(`  ${a.address}  amount=${a.amount}  path=${a.path}`);
}

// Spendable UTXOs — what tx construction will draw from.
const utxos = await client.getUtxos({});
for (const u of utxos) {
  console.log(`  ${u.txid}:${u.vout}  ${u.satoshis} sats  ${u.address}  conf=${u.confirmations}`);
}

// Get a fresh address (next on the receive chain).
const addr = await client.createAddress({});

// Recent activity.
const txs = await client.getTxHistory({ skip: 0, limit: 20 });
```

A few things to know:

- **`confirmations` comes from BWS, not chain truth.** BWS's confirmation counter is fed by `bcmonitor.js`. If `bcmonitor.js` isn't running or hasn't caught up, `confirmations` may report `0` for a UTXO that's already in a confirmed block. The chain truth is at the bitcore-node REST endpoint (`GET /api/<chain>/<network>/address/<addr>/balance` returns `{ confirmed, unconfirmed, balance }`). See `bws/OPERATING.md` for `bcmonitor.js` setup.
- **`availableAmount` excludes locked UTXOs** — anything tied up in a pending txproposal. So if you create a txp and don't broadcast it, `availableAmount` drops by the amount + fee until the txp is rejected/abandoned.
- **`byAddress` only includes addresses with non-zero balance.** If you've used a receive address in the past, paid out everything, it won't appear here. Use `getMainAddresses()` for the full list.

---

## Spend (build, sign, broadcast)

Five steps; each is its own API call. [`scripts/send-redd.js`](./scripts/send-redd.js) is the worked example end-to-end.

### 1. Create the txp

```js
const txp = await client.createTxProposal({
  outputs: [{
    toAddress: 'Rr4M5uQSm2mhCcAKYguG8essuM6dByk8j1',
    amount: 100000000   // sats
  }],
  feePerKb: 100000      // sat/KB; or use feeLevel: 'normal'
});
console.log('Created:', txp.id, 'fee:', txp.fee);
```

BWS picks UTXOs (via `selectTxInputs` in the chain class), computes an exact fee against bitcore-node, and stores the proposal in mongo. The returned object has the chosen inputs, outputs, change address, and computed fee.

A few alternates:

- `sendMax: true` (with `outputs[0].amount` *omitted* — BWS rejects it if you pass both): drains all available funds minus fee. Fixed in [BIT-18](https://reddink.youtrack.cloud/issue/BIT-18) — the upstream verifier was rejecting every sendMax txp because `args.outputs[0].amount` is undefined while `txp.outputs[0].amount` is the server-computed drain value. The patch in `Verifier.checkProposalCreation` skips the amount-equality check on the sendMax leg while keeping every other invariant (toAddress, script, output count, feePerKb, changeAddress, message) strict.
- `feeLevel: 'priority' | 'normal' | 'economy' | 'superEconomy'`: lets BWS look up an estimated rate from `feeStats`. **Caveat**: on chains with empty fee history (RDD before significant traffic), this hits the `samplePoints` crash documented as BIT-13. Pass `feePerKb` explicitly to avoid that path.
- `excludeUnconfirmedUtxos: true`: only spend confirmed inputs. Default is to allow any.

### 2. Publish

```js
const published = await client.publishTxProposal({ txp });
```

Commits the proposal so signatures can be attached to it. Single-signer wallets still need this — it's the gate that lets BWS accept signatures against a known proposal-id.

### 3. Sign

```js
const rootPath = client.credentials.rootPath;   // e.g. "m/44'/4'/0'" for RDD
const signatures = await key.sign(rootPath, published);
console.log(`Got ${signatures.length} signature(s)`);
```

`Key.sign` derives the per-input private keys from your HD root, signs the bitcore-Transaction `published` is built from, and returns DER-encoded signatures (one per input, sorted by input index).

### 4. Push signatures back

```js
const signed = await client.pushSignatures(published, signatures);
```

BWS verifies each signature against the corresponding input's `xpub + path`, attaches them to the proposal, and marks it broadcast-ready.

### 5. Broadcast

```js
const result = await client.broadcastTxProposal(signed);
// result has shape { txp } — the txid is at result.txp.txid
console.log('Broadcast:', result.txp.txid, 'status:', result.txp.status);
```

BWS forwards the raw tx to bitcore-node via `sendrawtransaction`, which relays to the chain daemon's mempool. The returned `txp` has `status: 'broadcasted'` and `txid` set; from there you can watch the tx land via the bitcore-node REST API:

```sh
curl http://localhost:3000/api/RDD/mainnet/tx/<txid>
```

A live-tested round-trip from this codebase: txid `7f434367d078baee0103729fcc81ec0f69f5689e1bf644f094c81159bbb72dfa`, mined into block 6,414,327, sent 9.99 RDD via this exact flow.

### Recovering from a partially-failed spend

If a step throws, the proposal is in mongo but in some intermediate state. To clean up:

```js
// List pending proposals
const pending = await client.getTxProposals({ doNotVerify: false });
for (const p of pending) console.log(p.id, p.status);

// Discard a proposal you no longer want (releases the locked UTXOs)
await client.removeTxProposal(p);
```

Common causes of mid-flow failures and what they mean:

- `Failed state: fee-too-high at <getBitcoreTx()>` from `createTxProposal` → BWS's `MAX_TX_FEE` cap for the chain is `undefined`. Should not happen on a current build; for new chains, see `bws/OPERATING.md` "Common errors".
- `BADREQUEST: Amount is not allowed when sendMax is specified` → you passed both `amount` and `sendMax: true` in a single output. Drop the `amount`.
- `Server response could not be verified` from `createTxProposal` → was the BIT-18 sendMax verifier bug; should no longer fire on current builds. If you see it on a non-sendMax flow, suspect a genuinely tampered server response: check the txp `outputs`, `feePerKb`, `changeAddress`, and `message` against what you sent.
- `Not authorized` on any post-create call → your client's `requestPrivKey` doesn't match what BWS recorded. You're using fresh credentials for an existing wallet; either `client.fromString(<persisted-creds>)` or `serverAssistedImport`.

---

## Multisig / TSS

This guide is the 1-of-1 walkthrough. For `m`-of-`n` multisig:

- `createWallet(name, copayer, m, n, ...)` makes a wallet that needs more than one copayer to join. BWS returns a `secret` you share with the other copayers.
- Each other copayer calls `joinWalletViaSecret(secret, ...)` to attach.
- After `n` copayers have joined, `getStatus().wallet.status` becomes `'complete'` and address generation is enabled.
- Spending requires `m` signers to each call `pushSignatures(...)` against the same proposal.

For TSS (threshold signatures, no on-chain multisig footprint), see `src/lib/tsskey.ts` and `src/lib/tsssign.ts`. The TSS flow is its own protocol with extra round-trips between copayers; out of scope for this guide.

---

## API reference quick-jump

The full surface is in [`src/lib/api.ts`](./src/lib/api.ts). The methods you'll actually call:

| Method | What it does |
|---|---|
| `new Key({ seedType, seedData? })` | Construct a Key from `'new'` (random), `'mnemonic'` (12 words), or `'extendedPrivateKey'` (xPriv) |
| `key.get(password, includeMnemonic)` | Read mnemonic + xPriv from the key; password used iff key is encrypted |
| `key.createCredentials(password, opts)` | Derive Credentials for `(coin, chain, network, account, n)` |
| `key.sign(rootPath, txp, password?)` | Produce DER signatures for every input of `txp` |
| `key.getBaseAddressDerivationPath(opts)` | The `m/44'/<coin>'/N'` path the wallet uses |
| `new API({ baseUrl, timeout })` | The HTTP client |
| `client.fromString(credsJson)` | Attach to a previously-created wallet |
| `client.toString()` | Serialise creds for persistence |
| `client.createWallet(name, copayer, m, n, opts)` | Create a new wallet on BWS |
| `client.openWallet()` | Refresh the current wallet's record |
| `client.getStatus(opts)` | Wallet record + balance + pending proposals |
| `client.getUtxos(opts)` | Spendable UTXOs |
| `client.getMainAddresses(opts)` | All receive addresses (incl. zero-balance) |
| `client.createAddress(opts)` | Next receive address |
| `client.getTxHistory(opts)` | Recent on-chain activity |
| `client.createTxProposal(opts)` | Build an unsigned transaction |
| `client.publishTxProposal({ txp })` | Commit the proposal so signatures can be accepted |
| `client.pushSignatures(txp, sigs)` | Submit signatures and verify |
| `client.broadcastTxProposal(txp)` | Send the raw tx to the network |
| `client.removeTxProposal(txp)` | Cancel a proposal, release locked UTXOs |
| `client.getTxProposals(opts)` | List pending proposals |
| `API.serverAssistedImport(opts, clientOpts)` | Recover wallets from a mnemonic |

For everything else — payment-protocol (`paypro.ts`, `payproV2.ts`), bulk-client batching (`bulkclient.ts`), the verifier internals — read the source. The methods above are 95% of what a wallet-app integrator touches.

---

## See also

- [`README.md`](./README.md) — npm install + a 2-copayer multisig example
- [`scripts/`](./scripts/) — the runnable specs: `smoke-redd.js`, `balance-redd.js`, `send-redd.js`, `check-mnemonic.js`
- [`packages/bitcore-wallet-service/OPERATING.md`](../bitcore-wallet-service/OPERATING.md) — running the BWS this client talks to
- BIT-7 / BIT-8 / BIT-9 / BIT-12 — the wallet-stack RDD chain that produced the lessons codified here
