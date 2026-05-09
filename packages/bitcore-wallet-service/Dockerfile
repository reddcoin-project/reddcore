###############################################################################
# Stage 1: builder — full toolchain, compiles bitcore-wallet-service + deps
###############################################################################
FROM node:22 AS builder
WORKDIR /bitcore

# Source. .dockerignore at the repo root drops node_modules / build /
# ts_build, so this is a clean copy regardless of local state.
COPY lerna.json package.json package-lock.json ./
COPY packages/ ./packages/

# Install everything (incl. devDeps — needed by tsc / lerna for compile),
# then compile only what BWS imports from. build:prod uses tsconfig.prod.json
# in each package, which excludes the test/ dirs that have stale-typing
# files (sinon stub APIs in wallet-service, superagent in wallet-client).
RUN npm install --ignore-scripts \
 && ./node_modules/.bin/lerna run build:prod \
      --scope @bitpay-labs/bitcore-wallet-service \
      --include-dependencies

# Drop everything not needed at runtime: devDependencies, TypeScript
# sources, tests, sourcemaps, build/ in non-bitcore-node packages, …
# `scripts/` is preserved at the wallet-service package root since it
# contains operator/migration tools (clean_db, deleteDupAddresses,
# migrateWalletsNetwork, etc.) that we want available in the image.
# Workspace symlinks under node_modules/@scope/<pkg> survive prune.
RUN npm prune --omit=dev \
 && find packages -type d \( -name test -o -name tests -o -name docs -o -name benchmark -o -name extra_tests -o -name coverage \) -prune -exec rm -rf {} + \
 && find packages -type f \( -name '*.ts' -o -name '*.map' -o -name '*.test.js' \) -delete \
 && find packages -mindepth 2 -maxdepth 2 -type d -name 'build' -exec rm -rf {} + 2>/dev/null \
 ; true

# Remove dev-tooling that survived `npm prune --omit=dev` because it's
# declared as runtime `dependencies` of dev-only sibling packages
# (bitcore-build pulls @wdio/*, bitcore-tss pulls @stencil/* + vite,
# crypto-rpc pulls hardhat, root manifest carries typescript). None of
# these are reachable from BWS's compiled require() graph.
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
# Stage 2: runtime — slim Debian, copies only what BWS needs to run
###############################################################################
FROM node:22-slim AS runtime
WORKDIR /bitcore

COPY --from=builder /bitcore/lerna.json ./
COPY --from=builder /bitcore/package.json ./
COPY --from=builder /bitcore/package-lock.json ./
COPY --from=builder /bitcore/node_modules ./node_modules
COPY --from=builder /bitcore/packages ./packages

WORKDIR /bitcore/packages/bitcore-wallet-service
CMD ["./start-docker.sh"]
