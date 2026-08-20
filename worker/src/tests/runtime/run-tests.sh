#!/bin/bash
# Snap It & Forget It -- Runtime Test Runner
# FME Mission 001
#
# Runs all tests: money arithmetic, unit (ledger/refund/split), runtime (SQLite).
# STATUS: SQLITE RUNTIME VERIFIED / D1 PENDING (Human Gate 1)
#
# Usage: cd worker && bash src/tests/runtime/run-tests.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../../.."  # worker/

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

echo ""
echo "=========================================="
echo " Snap It & Forget It -- Tests"
echo " FME Mission 001"
echo " $(date)"
echo "=========================================="
echo ""

# Install if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
  info "Dependencies installed"
fi

# --- Money arithmetic unit tests ---
echo "[1/4] Money arithmetic tests..."
npx vitest run src/tests/money.test.ts --reporter=verbose 2>&1 | tee /tmp/snap-it-money.txt
if [ ${PIPESTATUS[0]} -ne 0 ]; then error "Money tests FAILED"; fi
info "Money tests PASSED"

# --- Ledger unit tests (pure functions, no DB) ---
echo "[2/4] Ledger unit tests..."
npx vitest run src/tests/ledger.test.ts --reporter=verbose 2>&1 | tee /tmp/snap-it-ledger.txt
if [ ${PIPESTATUS[0]} -ne 0 ]; then error "Ledger tests FAILED"; fi
info "Ledger tests PASSED"

# --- Refund + split unit tests ---
echo "[3/4] Refund + split unit tests..."
npx vitest run src/tests/refund.test.ts src/tests/split.test.ts --reporter=verbose 2>&1 | tee /tmp/snap-it-unit.txt
if [ ${PIPESTATUS[0]} -ne 0 ]; then error "Refund/split unit tests FAILED"; fi
info "Refund/split unit tests PASSED"

# --- Runtime tests (real SQLite, D1-identical) ---
echo "[4/4] Runtime tests (real SQLite)..."
npx vitest run src/tests/runtime/refund.runtime.test.ts src/tests/runtime/split.runtime.test.ts --reporter=verbose 2>&1 | tee /tmp/snap-it-runtime.txt
if [ ${PIPESTATUS[0]} -ne 0 ]; then error "Runtime tests FAILED"; fi
info "Runtime tests PASSED"

echo ""
echo "=========================================="
echo " ALL TESTS PASSED"
echo ""
echo " Output saved to:"
echo "   /tmp/snap-it-money.txt"
echo "   /tmp/snap-it-ledger.txt"
echo "   /tmp/snap-it-unit.txt"
echo "   /tmp/snap-it-runtime.txt"
echo ""
echo " Next: bash scripts/deploy.sh"
echo "=========================================="
