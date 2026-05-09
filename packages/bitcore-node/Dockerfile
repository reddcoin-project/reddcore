###############################################################################
# Stage 1: builder — full toolchain, compiles bitcore-node + its workspace deps
###############################################################################
FROM node:22 AS builder
WORKDIR /bitcore

# Source. .dockerignore drops node_modules / build / ts_build at the root,
# so this is a clean copy regardless of local state.
COPY lerna.json package.json package-lock.json ./
COPY packages/ ./packages/

# Install everything (incl. devDeps — needed by tsc / lerna for compile),
# then compile only what the indexer actually imports from.
# `npm install --ignore-scripts` skips postinstall (the root `compile`
# script); we run the build explicitly below so failures surface clearly.
RUN npm install --ignore-scripts \
 && ./node_modules/.bin/lerna run build:prod \
      --scope @reddcoinproject/bitcore-node \
      --include-dependencies

# Drop everything not needed at runtime: devDependencies in node_modules,
# TypeScript sources, tests, sourcemaps, build/test/, scripts/, docs/, …
# Workspace symlinks under node_modules/@scope/<pkg> survive the prune.
RUN npm prune --omit=dev \
 && find packages -type d \( -name test -o -name tests -o -name scripts -o -name docs -o -name benchmark -o -name extra_tests -o -name coverage \) -prune -exec rm -rf {} + \
 && find packages -type f \( -name '*.ts' -o -name '*.map' -o -name '*.test.js' \) -delete \
 && find packages -mindepth 2 -maxdepth 2 -type d -name 'build' -path '*/bitcore-node/build' -prune -o -type d -name 'build' -exec rm -rf {} + 2>/dev/null \
 ; true

# Remove dev-tooling that survived `npm prune --omit=dev` because it's
# declared as a runtime `dependencies` of dev-only sibling packages
# (bitcore-build pulls @wdio/*, bitcore-tss pulls @stencil/* + vite,
# crypto-rpc pulls hardhat, root manifest carries typescript).
# None of these are reachable from bitcore-node's compiled require()
# graph; deleting their node_modules entries cleanly drops ~190 MB.
RUN rm -rf \
      node_modules/typescript \
      node_modules/typedoc \
      node_modules/@wdio \
      node_modules/create-wdio \
      node_modules/@stencil \
      node_modules/@swc \
      node_modules/vite \
      node_modules/hardhat \
      node_modules/@nomicfoundation \
      node_modules/lerna \
      node_modules/@lerna \
      node_modules/@octokit \
      node_modules/tsx \
      node_modules/eslint \
      node_modules/@eslint \
      node_modules/@typescript-eslint \
      node_modules/mocha \
      node_modules/@types \
      node_modules/sinon

###############################################################################
# Stage 2: runtime — slim Debian, copies only what the indexer needs
###############################################################################
FROM node:22-slim AS runtime
WORKDIR /bitcore

# Copy the pruned monorepo — workspace symlinks inside node_modules/ are
# preserved across COPY because Docker's COPY follows them into the source
# tree. The destination node_modules ends up with real files for direct
# deps and symlinks (relative paths) for workspace packages.
COPY --from=builder /bitcore/lerna.json ./
COPY --from=builder /bitcore/package.json ./
COPY --from=builder /bitcore/package-lock.json ./
COPY --from=builder /bitcore/node_modules ./node_modules
COPY --from=builder /bitcore/packages ./packages

WORKDIR /bitcore/packages/bitcore-node

# Default config path — matches bitcore-node's source-code default
# (src/config.ts: __dirname/../../../../bitcore.config.json from
# build/src/config.js → /bitcore/bitcore.config.json). Set explicitly
# so operators reading the Dockerfile see the contract; override via
# `-e BITCORE_CONFIG_PATH=/path/to/config.json` at run time.
ENV BITCORE_CONFIG_PATH=/bitcore/bitcore.config.json

# Liveness check — hits the in-memory /api/status/enabled-chains route
# which doesn't require Mongo or P2P connectivity, just that the API
# server is bound. node:22-slim has no curl/wget, so use node itself.
# --start-period=60s gives Mongo connect + P2P handshake time to settle
# before failures count against the unhealthy threshold.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:3000/api/status/enabled-chains', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]

CMD ["node", "./build/src/server.js"]
