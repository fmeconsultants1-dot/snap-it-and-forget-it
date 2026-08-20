# Snap It & Forget It - Verification Record
FME Mission 001

## HONEST STATUS

### VERIFIED (SQLite runtime - executable now)

Run these commands to produce real test output:

```bash
cd worker
npm install
bash src/tests/runtime/run-tests.sh
```

Tests that execute against real SQLite (D1-identical):

| Suite | File | Tests |
|-------|------|-------|
| Money arithmetic | src/tests/money.test.ts | toCents, splitProportional, allocateProportionally, verifySumExact |
| Ledger unit | src/tests/ledger.test.ts | T1-T8 journal line building |
| Refund unit | src/tests/refund.test.ts | T7A-T7G line building |
| Split unit | src/tests/split.test.ts | TS1-TS7 line building |
| Refund runtime | src/tests/runtime/refund.runtime.test.ts | T7A-T7G + REFUND-01/02/03 + atomicity + idempotency + rounding |
| Split runtime | src/tests/runtime/split.runtime.test.ts | TS1-TS7 + atomicity + personal accounting |

### NOT YET VERIFIED (requires Cloudflare deployment)

- /health endpoint live
- Gemini API extraction from real camera image
- R2 image upload and retrieval
- D1 at Cloudflare edge (not local SQLite)
- Cloudflare Pages frontend load on mobile browser
- Physical camera capture on mobile device
- End-to-end: snap -> extract -> ledger -> approve -> export

## HUMAN GATE STEPS (exact, in order)

### Prerequisites
```bash
npm install -g wrangler
wrangler login
```

### Step 1: Create D1 database
```bash
wrangler d1 create snap-it-db
# Copy the database_id from output
# Paste into worker/wrangler.toml replacing REPLACE_WITH_YOUR_D1_DATABASE_ID
```

### Step 2: Create R2 bucket
```bash
wrangler r2 bucket create snap-it-documents
```

### Step 3: Run migrations
```bash
cd worker
wrangler d1 execute snap-it-db --file=src/db/schema.sql
wrangler d1 execute snap-it-db --file=src/db/migrations/002_refunds_splits.sql
```

### Step 4: Set secrets
```bash
wrangler secret put GEMINI_API_KEY
# Paste your key from https://aistudio.google.com/app/apikey

wrangler secret put ALLOWED_ORIGINS
# Paste: https://snap-it-and-forget-it.pages.dev,http://localhost:5173

# Optional (enables ITC):
wrangler secret put ITC_REGISTERED
# Paste: true

wrangler secret put ITC_REGISTRATION_NUMBER
# Paste: your GST registration number

wrangler secret put ITC_REGISTRATION_DATE
# Paste: YYYY-MM-DD (date you registered)

wrangler secret put PROVINCE
# Paste: BC (or ON, AB, etc.)
```

### Step 5: Deploy worker
```bash
cd worker
npm install
wrangler deploy
# Note the worker URL: https://snap-it-worker.YOUR.workers.dev
```

### Step 6: Verify worker
```bash
curl https://snap-it-worker.YOUR.workers.dev/health
# Expected: {"status":"ok","db":true,"ts":"..."}

curl https://snap-it-worker.YOUR.workers.dev/health/full
# Expected: {"status":"ok","db":true,"r2":true,"gemini_configured":true,...}
```

### Step 7: Deploy frontend
```bash
cd app
npm install
echo 'VITE_API_URL=https://snap-it-worker.YOUR.workers.dev' > .env.production
npm run build
wrangler pages deploy dist --project-name=snap-it-and-forget-it
```

### Step 8: Mobile test
1. Open https://snap-it-and-forget-it.pages.dev on phone
2. Tap Snap Documents
3. Allow camera
4. Capture 2 receipts
5. Verify processing queue shows both Done
6. Verify Results screen shows extracted fields with confidence scores
7. Verify Ledger shows DR entries
8. Open Accounting Journal - verify Balanced badge
9. Tap Approve on one entry
10. Export CSV - verify it downloads

## AFTER DEPLOYMENT - SUPER AGENT RESUMES

Provide the worker URL and confirm /health passes.
Super Agent will run all 40 acceptance gates and close Mission 001.
