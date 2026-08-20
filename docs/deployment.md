# Snap It & Forget It — Deployment Guide
FME Mission 001

## Prerequisites

- Cloudflare account (free tier sufficient for dev)
- Node 20+
- Wrangler CLI: `npm install -g wrangler`
- `wrangler login`

## Step 1 — Create D1 Database

```bash
wrangler d1 create snap-it-db
```

Copy the `database_id` from output and paste into `worker/wrangler.toml`.

## Step 2 — Create R2 Bucket

```bash
wrangler r2 bucket create snap-it-documents
```

## Step 3 — Run Database Migration

```bash
cd worker
wrangler d1 execute snap-it-db --file=src/db/schema.sql
```

Local dev:
```bash
wrangler d1 execute snap-it-db --local --file=src/db/schema.sql
```

## Step 4 — Set Secrets

```bash
wrangler secret put GEMINI_API_KEY
# Paste your Google AI API key when prompted

wrangler secret put ALLOWED_ORIGINS
# Paste: https://snap-it-and-forget-it.pages.dev,http://localhost:5173
```

## Step 5 — Deploy Worker

```bash
cd worker
npm install
wrangler deploy
```

Note the worker URL: `https://snap-it-worker.YOUR_ACCOUNT.workers.dev`

## Step 6 — Deploy Frontend

```bash
cd app
npm install
echo "VITE_API_URL=https://snap-it-worker.YOUR_ACCOUNT.workers.dev" > .env.production
npm run build
wrangler pages deploy dist --project-name=snap-it-and-forget-it
```

## Step 7 — Verify

```bash
curl https://snap-it-worker.YOUR_ACCOUNT.workers.dev/health
# Expected: {"status":"ok","db":true,"ts":"..."}
```

Open `https://snap-it-and-forget-it.pages.dev` on mobile.

## Local Development

### Worker
```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with real GEMINI_API_KEY
wrangler d1 execute snap-it-db --local --file=src/db/schema.sql
wrangler dev
```

### Frontend
```bash
cd app
npm install
cp .env.example .env.local
# VITE_API_URL=http://localhost:8787 (default)
npm run dev
```

Visit: `http://localhost:5173`

## Environment Variables Reference

| Variable | Where | How to Set | Required |
|---|---|---|---|
| `GEMINI_API_KEY` | Worker | `wrangler secret put` | YES |
| `ALLOWED_ORIGINS` | Worker | `wrangler secret put` | YES |
| `DB` | wrangler.toml | binding | YES |
| `DOCUMENTS` | wrangler.toml | binding | YES |
| `VITE_API_URL` | app/.env.local | file | YES |

## Portability Checklist

- [ ] Clone repository
- [ ] `wrangler login` with authorized account
- [ ] Create D1 database, copy ID to wrangler.toml
- [ ] Create R2 bucket
- [ ] Run schema migration
- [ ] Set GEMINI_API_KEY secret
- [ ] Set ALLOWED_ORIGINS secret
- [ ] `wrangler deploy` from /worker
- [ ] `npm run build && wrangler pages deploy dist` from /app
- [ ] GET /health returns `{"status":"ok","db":true}`
- [ ] Mobile camera test: capture 1 receipt, verify extraction
- [ ] Ledger shows entry with DR amount
- [ ] Journal shows balanced entry (5010 DR / 1010 CR)
