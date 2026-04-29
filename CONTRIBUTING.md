# Submitting Issues
## Bug Reports

🐞 A bug is a _demonstrable problem_ that is caused by the code in the repository.
Good bug reports are extremely helpful - thank you!

Guidelines for bug reports:

1. **Use the GitHub issue search** &mdash; Check if the issue has already been
   reported. If it already exists, consider leaving a comment with any extra clarifying
   details about your situation that might help us narrow in on the nature of the problem.

2. **Check if the issue has already been fixed** &mdash; In the event that you don't 
    have the latest, try to reproduce it using the latest changes in the `master` branch.

3. **Submit a clear and detailed issue** &mdash; Please try to be as detailed as possible 
    in your report. Please include the following:
    - Your environment, OS and/or browsers facing the issue
    - Steps to reproduce the issue
    - Specific errors thrown, stack trace, etc.
    - The behaviour you expect vs what it's doing


## Feature Requests

💡 Feature requests are welcome. But take a moment to find out whether your idea
fits with the scope and aims of the project. It's up to *you* to make a strong
case to convince the project's developers of the merits of this feature. Please
provide as much detail and context as possible.


# Contributing Code
👍 Good pull requests — patches, improvements, new features — are a fantastic help. They should remain focused in scope and avoid containing unrelated commits.

🙏 Please adhere to the coding conventions used throughout this monorepo (indentation,
accurate comments, etc.) and any other requirements (such as test coverage).

✍️ **All commits must be [signed](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits)** and `Verified` in GitHub.

Follow this process:

1. [Fork](http://help.github.com/fork-a-repo/) the project, clone your fork,
   and configure the remotes:

   ```bash
   # Clone your fork of the repo into the current directory
   git clone https://github.com/<your-username>/reddcore
   # Navigate to the newly cloned directory
   cd reddcore
   # Assign the original Reddcore repo to a remote called "origin"
   git remote add origin https://github.com/reddcoin-project/reddcore.git
   # Assign the original Bitpay bitcore repo to a remote called "upstream"
   # (this is what we periodically merge from to stay current)
   git remote add upstream https://github.com/bitpay/bitcore.git
   ```

   > **NOTE: If you cloned a while ago**, get the latest changes from upstream:
   >
   >   ```bash
   >   git checkout master
   >   git pull upstream master
   >   ```

2. Create a new feature branch (off the `master` branch) to
   contain your feature, change, or fix:

   ```bash
   git checkout -b <feature-branch-name>
   ```

3. Write code and commit your changes in logical chunks.

4. Locally merge (or rebase) the upstream `master` branch into your feature branch:

   ```bash
   git pull [--rebase] upstream master
   ```

5. Push your feature branch up to your fork:

   ```bash
   git push origin <feature-branch-name>
   ```

6. [Open a Pull Request](https://help.github.com/articles/using-pull-requests/)
    with a clear title and description from your fork to the base repository (reddcoin-project/reddcore - master).


# Releasing (publishing to npm)

Reddcore packages are published to npm under the `@reddcoinproject/` scope. **Each package has its own publish track** — converting a package for Reddcoin and publishing it are distinct activities, so a package can be 100% converted without being on the registry, and a publish for one package isn't blocked on the conversion state of unrelated packages.

## Publish dependency order

Some packages are blocked on others being on the registry first. Follow this order:

```
  bitcore-lib-redd            (no @reddcoinproject deps — can publish first)
        ▲
  bitcore-p2p-redd            (depends on bitcore-lib-redd)
        ▲
  bitcore-node                (depends on lib-redd + p2p-redd; also still
        ▲                     has @bitpay-labs/* deps until those convert)
        ├──────────────┐
        │              │
  bitcore-wallet-      bitcore-wallet-
  service              client
                       (both query bitcore-node's REST API at runtime,
                        so neither makes sense to ship before bitcore-node
                        is on the registry)
```

## Once-per-org prerequisites

Done once per machine, applies to every subsequent publish:

1. **Confirm the npm scope.** The `@reddcoinproject` org must exist on npmjs.com and your account must have publish rights:
   ```bash
   npm login              # interactive
   npm whoami             # confirm you're logged in
   npm org ls reddcoinproject  # confirm scope ownership
   ```

2. **Drop a publish token into your `~/.npmrc`** (and into CI secrets if/when you add CI publishing). For automation:
   ```
   //registry.npmjs.org/:_authToken=${NPM_TOKEN}
   ```

3. **Run the smoke test once** to make sure your local environment works end-to-end:
   ```bash
   bash scripts/smoke-test.sh
   ```
   Expected: 41/41 assertions green (29 lib-redd + 12 p2p-redd, last verified 2026-04-29).

## Per-package release runbook

Run this for each package, in dependency order:

```bash
# 1. Confirm you're on a clean reddcore/master at the expected commit
git status --short
git log --oneline -1

# 2. Pre-flight: confirm tarball contents look right
cd packages/<pkg>
npm pack --dry-run | tail -10
#   Expect 'name', 'version', file count, and total size to match what
#   you intend to ship. For bitcore-lib-redd at v11.8.1 that's currently
#   ~153 files / ~15.8 MB unpacked (browser bundles included).

# 3. Build (if applicable) and test
gulp test:node               # JS lib packages: gulp test:node, no flake
# OR for TS packages:
npm run tsc && npm run test  # ts packages
gulp browser                 # produce *.js + *.min.js bundle (lib-redd only)

# 4. Run the consolidated smoke test against the local source
cd /home/<you>/Projects/bitpay/reddcore   # back to repo root
bash scripts/smoke-test.sh

# 5. Bump version if releasing a delta from upstream's pin (e.g. 11.8.1 -> 11.8.1-redd.1)
#    Skip this step the first time we publish at version 11.8.1.
#    Use `npm version <new>` so package.json + git tag are stamped together.

# 6. Publish to npm
cd packages/<pkg>
npm publish --access public   # @reddcoinproject is a public scope

# 7. Verify the published version
npm view @reddcoinproject/<pkg>          # latest version + dist-tags
npm view @reddcoinproject/<pkg> dist.tarball
#   Optional: download the tarball and diff against the local one to
#   confirm the bytes you intended landed on the registry.

# 8. End-to-end consumer verification: install from the registry into a
#    fresh /tmp project and run the smoke assertions against the
#    registry copy (not the local tarball).
cd /tmp && mkdir -p verify-<pkg>-<ver> && cd verify-<pkg>-<ver>
npm init -y
npm install @reddcoinproject/<pkg>@<ver>
node -e "console.log(Object.keys(require('@reddcoinproject/<pkg>')))"
#   For lib-redd, drop in scripts/smoke-lib-redd.js as smoke.js and run it.
#   For p2p-redd, similar with smoke-p2p-redd.js.

# 9. Tag the release in git so we can correlate registry entries to commits
cd /home/<you>/Projects/bitpay/reddcore
git tag release/<pkg>@<ver>
git push origin release/<pkg>@<ver>

# 10. Announce: bump the migration doc + relevant package CHANGELOG.md
#     and push the change.
```

## Backout / unpublish

npm allows `npm unpublish` only within 72 hours of publish, and only if no other public package depends on yours. Use `npm deprecate` instead for anything older — it leaves the version installable but flags it with a warning:

```bash
npm deprecate '@reddcoinproject/bitcore-lib-redd@11.8.1' \
  'Use 11.8.2 — fixed <issue>'
```

## Per-package quirks

- **`bitcore-lib-redd`**: 5 pre-existing tapscript test failures inherited from upstream `bitcore-lib@v11.8.1` are *expected* — they exist in upstream too and are unrelated to Reddcoin. Do **not** treat them as a release blocker. Verify with `gulp test:node` reporting `4687 passing, 1 pending, 5 failing`.
- **`bitcore-p2p-redd`**: 19 pre-existing framework failures (sinon `.callsFake` API drift, `dns.resolve` stubbing in modern Node, peer integration test that needs a live `reddcoind`) — also expected and shared with upstream `bitcore-p2p`. Verify with `gulp test:node` reporting `173 passing, 19 failing`.
- **`bitcore-p2p-redd`** must wait until `@reddcoinproject/bitcore-lib-redd@<ver>` is on the registry — its `package.json` declares `@reddcoinproject/bitcore-lib-redd: ^11.8.1` as a runtime dep, and `npm install` will refuse if it can't be resolved.
- **Browser bundles** (`bitcore-lib-redd.js` / `.min.js`) are git-ignored but **shipped in the npm tarball**. Rerun `gulp browser` before each publish so the bundles in the tarball match the source. `bitcore-p2p-redd` has `skipBrowser: true` and ships no browser bundle (raw sockets aren't a browser thing).