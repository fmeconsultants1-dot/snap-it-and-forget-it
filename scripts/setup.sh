#!/bin/bash
# Snap It & Forget It — Setup Script
# FME Mission 001
# Bootstraps full local + production environment

set -e

echo "=== Snap It & Forget It — Setup ==="
echo ""

# Check prerequisites
if ! command -v node &> /dev/null; then echo "ERROR: node not found. Install Node 20+"; exit 1; fi
if ! command -v wrangler &> /dev/null; then echo "Installing wrangler..."; npm install -g wrangler; fi

echo "[1/6] Installing worker dependencies..."
cd worker && npm install && cd ..

echo "[2/6] Installing frontend dependencies..."
cd app && npm install && cd ..

echo "[3/6] Setting up D1 database..."
echo "Run: wrangler d1 create snap-it-db"
echo "Then paste the database_id into worker/wrangler.toml"
echo "Then run: cd worker && wrangler d1 execute snap-it-db --local --file=src/db/schema.sql"

echo "[4/6] Setting up secrets..."
echo "Create worker/.dev.vars from worker/.dev.vars.example"
echo "Add your GEMINI_API_KEY"

echo "[5/6] Starting worker dev server..."
echo "Run: cd worker && wrangler dev"

echo "[6/6] Starting frontend dev server..."
echo "Run: cd app && npm run dev"

echo ""
echo "=== Setup complete. See docs/deployment.md for full instructions. ==="
