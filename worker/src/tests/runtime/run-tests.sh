#!/bin/bash
# Snap It & Forget It — Runtime Test Runner
# FME Mission 001
#
# Runs all tests against real SQLite (D1-identical dialect).
# Captures output for verification record.
#
# Usage:
#   cd worker
#   bash src/tests/runtime/run-tests.sh
#
# Requirements:
#   Node 20+
#   npm install (installs better-sqlite3)

set -e
cd "$(dirname "$0")/../../.."  # worker/

echo "========================================"
echo " Snap It & Forget It — Runtime Tests"
echo " FME Mission 001"
echo " $(date)"
echo "========================================"
echo ""

# Install if needed
if [ ! -d node_modules ]; then
  echo "[1/4] Installing dependencies..."
  npm install
fi

# Money unit tests
echo "[2/4] Running money arithmetic tests..."
npx vitest run src/tests/money.test.ts --reporter=verbose 2>&1 | tee /tmp/snap-it-money-tests.txt
echo ""

# Ledger unit tests
echo "[3/4] Running ledger + refund + split unit tests..."
npx vitest run src/tests/ledger.test.ts src/tests/refund.test.ts src/tests/split.test.ts --reporter=verbose 2>&1 | tee /tmp/snap-it-unit-tests.txt
echo ""

# Runtime tests (SQLite)
echo "[4/4] Running runtime tests (real SQLite)..."
npx vitest run src/tests/runtime/refund.runtime.test.ts src/tests/runtime/split.runtime.test.ts --reporter=verbose 2>&1 | tee /tmp/snap-it-runtime-tests.txt
echo ""

echo "========================================"
echo " Test output saved to:"
echo "   /tmp/snap-it-money-tests.txt"
echo "   /tmp/snap-it-unit-tests.txt"
echo "   /tmp/snap-it-runtime-tests.txt"
echo ""
echo " Copy output and paste into mission"
echo " verification record."
echo "========================================"
