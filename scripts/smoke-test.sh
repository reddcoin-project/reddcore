#!/usr/bin/env bash
# scripts/smoke-test.sh
#
# Pre-publish smoke test for the @reddcoinproject reddcoin packages.
# Packs each package via `npm pack`, installs the resulting tarballs into a
# fresh consumer project under /tmp, and runs reddcoin-specific behavioural
# assertions against the freshly-installed modules.
#
# Run from the repo root:
#   bash scripts/smoke-test.sh
#
# Exits 0 on full success, non-zero on any check failure or pack/install error.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_REDD="$REPO_ROOT/packages/bitcore-lib-redd"
P2P_REDD="$REPO_ROOT/packages/bitcore-p2p-redd"
SMOKE_DIR="${SMOKE_DIR:-/tmp/redd-smoke-$$}"

cleanup() { rm -rf "$SMOKE_DIR" "$LIB_REDD"/*.tgz "$P2P_REDD"/*.tgz; }
trap cleanup EXIT

echo "== Pack bitcore-lib-redd =="
LIB_TGZ=$(cd "$LIB_REDD" && npm pack --silent)
LIB_TGZ_PATH="$LIB_REDD/$LIB_TGZ"

echo "== Pack bitcore-p2p-redd =="
P2P_TGZ=$(cd "$P2P_REDD" && npm pack --silent)
P2P_TGZ_PATH="$P2P_REDD/$P2P_TGZ"

echo "== Fresh consumer install =="
mkdir -p "$SMOKE_DIR"
cd "$SMOKE_DIR"
npm init -y > /dev/null
npm install --no-audit --no-fund --silent "$LIB_TGZ_PATH" "$P2P_TGZ_PATH"

echo "== Run lib-redd assertions =="
node "$REPO_ROOT/scripts/smoke-lib-redd.js"

echo "== Run p2p-redd assertions =="
node "$REPO_ROOT/scripts/smoke-p2p-redd.js"

echo
echo "Smoke test complete — all assertions pass."
