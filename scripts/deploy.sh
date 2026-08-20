#!/bin/bash
# Snap It & Forget It — Deployment Script
# FME Mission 001
# Usage: bash scripts/deploy.sh
# Requires: wrangler login already completed, D1 database_id set in worker/wrangler.toml

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "=========================================="
echo " Snap It & Forget It — Deploy"
echo " FME Mission 001"
echo " $(date)"
echo "=========================================="
echo ""

# Check wrangler
command -v wrangler &>/dev/null || error "wrangler not found. Run: npm install -g wrangler"
command -v node &>/dev/null    || error "node not found. Install Node 20+"

# Check database_id is set
if grep -q 'REPLACE_WITH_YOUR_D1_DATABASE_ID' "$ROOT/worker/wrangler.toml"; then
  error "Set your D1 database_id in worker/wrangler.toml before deploying."
fi

# ---- Worker ----
echo "[1/6] Installing worker dependencies..."
cd "$ROOT/worker"
npm install --silent
info "Worker dependencies installed"

echo "[2/6] Running schema migration..."
wrangler d1 execute snap-it-db --file=src/db/schema.sql
wrangler d1 execute snap-it-db --file=src/db/migrations/002_refunds_splits.sql
info "Migrations applied"

echo "[3/6] Deploying worker..."
wrangler deploy
info "Worker deployed"

# Extract worker URL from wrangler output or use name pattern
WORKER_NAME=$(grep '^name' wrangler.toml | head -1 | sed 's/name = //;s/"//g;s/ //')
ACCOUNT_SUBDOMAIN=$(wrangler whoami 2>/dev/null | grep 'account_id' | head -1 | awk '{print $NF}' || echo '')

echo "[4/6] Verifying worker health..."
sleep 3
HEALTH=$(curl -s "https://${WORKER_NAME}.${ACCOUNT_SUBDOMAIN:0:8}.workers.dev/health" 2>/dev/null || echo '{}')
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  info "Worker health: OK"
else
  warn "Health check inconclusive. Check manually: curl https://YOUR_WORKER.workers.dev/health"
  warn "Response: $HEALTH"
fi

# ---- Frontend ----
echo "[5/6] Building frontend..."
cd "$ROOT/app"
npm install --silent

# Check VITE_API_URL
if [ ! -f .env.production ]; then
  warn ".env.production not found. Create it with:"
  warn "  echo 'VITE_API_URL=https://YOUR_WORKER.workers.dev' > app/.env.production"
  warn "Attempting build anyway (will use localhost fallback)"
fi

npm run build
info "Frontend built"

echo "[6/6] Deploying frontend to Cloudflare Pages..."
wrangler pages deploy dist --project-name=snap-it-and-forget-it
info "Frontend deployed"

echo ""
echo "=========================================="
echo " DEPLOYMENT COMPLETE"
echo " Worker:   https://${WORKER_NAME}.workers.dev"
echo " Frontend: https://snap-it-and-forget-it.pages.dev"
echo ""
echo " Manual verification:"
echo "   curl https://YOUR_WORKER.workers.dev/health"
echo "   curl https://YOUR_WORKER.workers.dev/health/full"
echo "   Open https://snap-it-and-forget-it.pages.dev on mobile"
echo "=========================================="
