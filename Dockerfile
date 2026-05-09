# Test runner image — long-running container that mimics a CI environment
# for running the workspace test suite locally (against the blockchain
# containers in docker-compose.test.base.yml). Not a deployable artifact;
# the published indexer / BWS images live in their respective package
# Dockerfiles. The actual CircleCI pipeline (.circleci/config.yml) runs
# on a machine executor with nvm and does NOT consume this image.
#
# Usage:
#   docker compose -f docker-compose.test.base.yml \
#                  -f docker-compose.test.local.yml build
#   docker compose -f docker-compose.test.base.yml \
#                  -f docker-compose.test.local.yml run test_runner bash
#
# Once inside the container, run e.g. `npm run test:bitcore-lib-redd`.
# Note: the `npm run test:ci:*` scripts on the host are currently
# broken (ci.sh doesn't handle the wrapped `npm run lerna:ci:*` arg);
# tracked separately.

FROM node:22

# Chrome — needed by browser test targets (karma / @wdio).
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnupg ca-certificates wget \
 && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo 'deb [signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/google-chrome

WORKDIR /bitcore

# .dockerignore at the repo root excludes node_modules / build / ts_build,
# so this is a clean copy. The previous per-package COPY block existed to
# create cache-friendly layers before npm workspaces; workspaces makes it
# moot, since `npm install` reads each workspace's package.json directly.
COPY lerna.json package.json package-lock.json ./
COPY packages/ ./packages/

# Install all deps (devDeps included — this is a test environment).
# `--ignore-scripts` skips the root `postinstall` hook that runs
# `npm run compile`. We deliberately do NOT compile here: the
# CircleCI flow re-runs `npm run compile` per test job (.circleci/
# config.yml), and the wallet-service / wallet-client test/ files
# currently have stale-typing TS errors that the CI flow tolerates by
# scoping per-package. Baking compile into the image would block this
# build the same way it blocked BIT-19. Compile on demand.
RUN npm install --ignore-scripts

# Default to an interactive shell — docker-compose.test.local.yml
# overrides via `--entrypoint`.
CMD ["bash"]
