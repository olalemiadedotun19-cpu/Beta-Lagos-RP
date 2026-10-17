#!/bin/sh
cd "$(dirname "$0")/.."
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/esbuild harness/main.ts --bundle --format=esm --outfile=harness/bundle.js --loader:.json=json --define:import.meta.env='{}' --log-level=warning 2>&1 | head -30
