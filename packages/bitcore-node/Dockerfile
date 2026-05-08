FROM node:22
RUN set -x && node -v && npm -v
WORKDIR /bitcore

# Add source
# NOTE(danny): not the most optimal layering, but it works for now
COPY lerna.json ./
COPY package*.json ./
COPY packages/ ./packages/

# Install dependencies and build
# npm workspaces (root package.json) creates the cross-package symlinks
# during `npm install` — lerna bootstrap is redundant with that.
# build:prod is the test-excluding variant used uniformly across all TS
# packages bitcore-node imports from; it lets --include-dependencies
# walk the dep graph (including devDeps via wallet-client) without
# tripping on stale-typing test files in wallet-service / wallet-client.
RUN npm install --ignore-scripts
RUN ./node_modules/.bin/lerna run build:prod \
    --scope @reddcoinproject/bitcore-node \
    --include-dependencies

# Start the server
WORKDIR /bitcore/packages/bitcore-node
CMD ["node", "./build/src/server.js"]