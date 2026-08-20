# Snap It & Forget It

**FME Mission 001** - Mobile receipt and document scanner with AI-powered bookkeeping.

## What It Does

Snap one or many receipts, invoices, and financial documents with your phone camera.
Gemini AI extracts all fields with confidence scores.
Every document creates a balanced double-entry journal entry automatically.
Review, approve, split, refund, and export for your accountant.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 PWA (Vite), dark theme, #FFB800 gold |
| AI Engine | Google Gemini 1.5 Flash |
| API | Cloudflare Workers (TypeScript), 25 routes |
| Database | Cloudflare D1 (SQLite at edge), 9 tables |
| Storage | Cloudflare R2 (document images) |
| Deployment | Cloudflare Pages + Workers |

## Features

- Multi-document camera scan (1-10 docs per run)
- Gemini AI: vendor, date, total, subtotal, tax, line items, category, payment method
- Confidence scores per field
- Double-entry ledger: SUM(DR) = SUM(CR) always. No 2-line limit.
- GST/HST/PST tracking: ITC only when registered + eligible + sufficient evidence
- AP/AR tracking with aging
- Refund engine: Full/Partial/Credit Note/Card Refund - reversing journals, over-refund protection, idempotency, atomicity
- Split engine: one receipt across multiple categories, proportional GST/PST, personal-use accounting
- Reconciliation: match bank imports to ledger entries
- Accountant portal: export CSV/JSON, tax summary, AP aging, audit trail, refund history
- 25 API routes, all documented
- 40 acceptance gates

## Repository Structure

```
worker/           Cloudflare Worker API (TypeScript)
  src/
    index.ts      13 core routes
    routes/       extended.ts - 12 additional routes
    services/     LedgerService, RefundService, SplitService, ScanService,
                  GSTService, APARService, ExportService, WatchdogService,
                  ReconciliationService
    adapters/     GeminiAdapter, StorageAdapter
    lib/          money.ts (deterministic cent arithmetic)
    db/           schema.sql, migrations/002_refunds_splits.sql
    tests/        ledger, refund, split, money unit tests
    tests/runtime refund.runtime.test.ts, split.runtime.test.ts (real SQLite)
app/              React 18 PWA (Vite)
  src/
    pages/        HomePage, CameraPage, ProcessingPage, ResultsPage,
                  LedgerPage (refund + split modals), AccountantPortal
    lib/          api.ts, camera.ts
docs/             deployment.md, api-inventory.md, acceptance-gates.md,
                  verification-record.md, architecture.md, known-bugs.md
scripts/          deploy.sh, setup.sh
.github/workflows test.yml (CI)
```

## Run Tests Now (No Deployment Required)

```bash
cd worker
npm install          # installs better-sqlite3 for runtime tests
bash src/tests/runtime/run-tests.sh
```

Test suites:
- `money.test.ts` - deterministic cent arithmetic, splitProportional, allocateProportionally
- `ledger.test.ts` - T1-T8 journal line building, SUM(DR)=SUM(CR)
- `refund.test.ts` - T7A-T7G refund line building
- `split.test.ts` - TS1-TS7 split line building
- `runtime/refund.runtime.test.ts` - T7A-T7G + REFUND-01/02/03 + atomicity + idempotency + rounding against real SQLite
- `runtime/split.runtime.test.ts` - TS1-TS7 against real SQLite

## Deploy

```bash
# 1. Set D1 database_id in worker/wrangler.toml
# 2. Run:
bash scripts/deploy.sh
```

Or manually:
```bash
cd worker
wrangler d1 create snap-it-db
# paste database_id into wrangler.toml
wrangler r2 bucket create snap-it-documents
wrangler d1 execute snap-it-db --file=src/db/schema.sql
wrangler d1 execute snap-it-db --file=src/db/migrations/002_refunds_splits.sql
wrangler secret put GEMINI_API_KEY
wrangler secret put ALLOWED_ORIGINS
wrangler deploy

cd ../app
echo 'VITE_API_URL=https://snap-it-worker.YOUR.workers.dev' > .env.production
npm run build
wrangler pages deploy dist --project-name=snap-it-and-forget-it
```

Verify:
```bash
curl https://snap-it-worker.YOUR.workers.dev/health
# {"status":"ok","db":true,"ts":"..."}
```

## Optional: ITC Configuration

```bash
wrangler secret put ITC_REGISTERED        # true or false
wrangler secret put ITC_REGISTRATION_NUMBER  # e.g. RT-123456789
wrangler secret put ITC_REGISTRATION_DATE    # YYYY-MM-DD
wrangler secret put PROVINCE              # BC, ON, AB, SK, MB, QC, etc.
```

## Source Recovery Note

```
ORIGINAL SOURCE CODE:     NOT RECOVERED
VISUAL BASELINE:          RECOVERED from 11 v1.0.0 screenshots
IMPLEMENTATION:           RECONSTRUCTED from screenshot evidence + Mission 001 spec
```

Repository: https://github.com/fmeconsultants1-dot/snap-it-and-forget-it
