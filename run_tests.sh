#!/usr/bin/env bash
# Run the engine + AI test suite.
set -euo pipefail
cd "$(dirname "$0")"
node tests/engine.test.js
