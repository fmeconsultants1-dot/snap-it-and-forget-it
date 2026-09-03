# Snap It & Forget It

**FME Mission 001** — Mobile receipt and document scanner with AI-powered bookkeeping.

## Production URL

```
https://snap-it-forget-it-api-extract.fmeconsultants1.workers.dev
```

Health check: `/health` → `{"status":"ok","db":true}`

## What It Does

Snap one or many receipts, invoices, and financial documents with your phone camera.
Gemini AI extracts all fields with confidence scores.
The user **reviews and corrects** extracted fields before approving.
Only after explicit approval does the record become a finalized ledger entry.
Every approved document creates a balanced double-entry journal entry.
Review, approve, split, refund, and export for your accountant.

## Workflow (Production)

```
SNAP → UPLOAD → STORE ORIGINAL → AI EXTRACT → REVIEW/EDIT → USER APPROVES → SAVE → LEDGER → REOPEN → EDIT → EXPORT
```

**Stage 6 detail:**
- After AI extraction, every result lands in D1 as `NEEDS_REVIEW` / `DRAFT`
- ResultsPage shows all extracted fields in an editable form
- User corrects vendor, date, type, category, subtotal, tax, total, payment method, description
- Confidence scores shown per field (green ≥ 80%, amber ≥ 60%, red < 60%) to guide review
- User taps **✓ Approve & Save** per document
- Backend `PATCH /api/ledger/:id` applies corrections, rebuilds journal lines, marks APPROVED atomically
- **View Ledger** button is locked until all documents are approved
- Original document in R2 is never modified

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 PWA (Vite), dark theme, #FFB800 gold |
| AI Engine | Google Gemini 3.5 Flash (`gemini-3.5-flash`) |
| API | Cloudflare Workers (TypeScript), 26 routes |
| Database | Cloudflare D1 (SQLite at edge), 9 tables |
| Storage | Cloudflare R2 (document images + frontend assets) |
| Deployment | Cloudflare Worker (serves frontend + API from one origin) |

> **Model history:** gemini-1.5-flash (shutdown), gemini-2.0-flash (shutdown June 1 2026),
> gemini-3.5-flash (current, as of Sept 2026)

## Features

- Multi-document camera scan (1-10 docs per run)
- Gemini AI: vendor, date, total, subtotal, tax (GST/HST/PST), line items, category, payment method
- Confidence scores per field — low confidence highlighted on review screen
- **Stage 6: editable review form before any record is finalized**
- Double-entry ledger: SUM(DR) = SUM(CR) always
- GST/HST/PST tracking: ITC only when registered + eligible + sufficient evidence
- AP/AR tracking with aging
- Refund engine: Full/Partial/Credit Note/Card Refund — reversing journals, over-refund protection, idempotency
- Split engine: one receipt across multiple categories, proportional GST/PST, personal-use accounting
- Reconciliation: match bank imports to ledger entries
- Accountant portal: export CSV/JSON, tax summary, AP aging, audit trail, refund history
- 26 API routes
- Source document viewer: tap any ledger entry to reopen original receipt from R2
- PWA installable on iOS/Android

## Repository Structure

```
worker/           Cloudflare Worker API (TypeScript)
  src/
    index.ts      14 core routes (incl. PATCH /api/ledger/:id — Stage 6)
    routes/       extended.ts — 12 additional routes + admin cleanup
    services/     LedgerService (updateAndApprove), RefundService, SplitService,
                  ScanService, GSTService, APARService, ExportService,
                  WatchdogService, ReconciliationService
    adapters/     GeminiAdapter (gemini-3.5-flash), StorageAdapter
    lib/          money.ts (deterministic cent arithmetic)
    db/           schema.sql, migrations/002_refunds_splits.sql
    tests/        ledger, refund, split, money unit tests
app/              React 18 PWA (Vite)
  src/
    pages/        HomePage, CameraPage, ProcessingPage,
                  ResultsPage (Stage 6: editable review + Approve),
                  LedgerPage (refund + split modals), AccountantPortal
    lib/          api.ts (incl. ledgerApi.updateAndApprove), camera.ts
docs/             deployment.md, api-inventory.md, acceptance-gates.md,
                  verification-record.md, architecture.md
scripts/          deploy.sh, setup.sh
.github/
  workflows/      deploy.yml (CI/CD: push to main → build → deploy → health check)
  SECRETS_REQUIRED.md
```

## Environment / Secrets Required

```bash
# Required
wrangler secret put GEMINI_API_KEY          # Google AI Studio key
wrangler secret put ALLOWED_ORIGINS        # e.g. https://snap-it-forget-it-api-extract.fmeconsultants1.workers.dev

# Optional — ITC (Input Tax Credit) tracking
wrangler secret put ITC_REGISTERED         # true | false
wrangler secret put ITC_REGISTRATION_NUMBER  # e.g. RT-123456789
wrangler secret put ITC_REGISTRATION_DATE    # YYYY-MM-DD
wrangler secret put PROVINCE               # BC | ON | AB | SK | MB | QC | NS | NB | NL | PE
```

## Infrastructure

| Resource | Name | ID / Binding |
|---|---|---|
| D1 Database | `snap-it-db` | `32b381ab-3d40-4d50-bcc1-c70f3a5e17dd` |
| R2 Bucket | `snap-it-documents` | binding: `DOCUMENTS` |
| Worker | `snap-it-forget-it-api-extract` | serves frontend + API |

## Deploy (Fresh)

```bash
cd worker
npm install
wrangler d1 create snap-it-db
# paste database_id into wrangler.toml
wrangler r2 bucket create snap-it-documents
wrangler d1 execute snap-it-db --remote --file=src/db/schema.sql
wrangler d1 execute snap-it-db --remote --file=src/db/migrations/002_refunds_splits.sql
wrangler secret put GEMINI_API_KEY
wrangler secret put ALLOWED_ORIGINS
wrangler deploy

cd ../app
echo 'VITE_API_URL=' > .env.production  # leave empty: worker serves both
npm run build
# upload dist/ to R2 under frontend/ prefix
wrangler r2 object put snap-it-documents/frontend/index.html --file=dist/index.html
# (deploy.yml handles this automatically on push to main)
```

## CI/CD

Push to `main` → GitHub Actions `deploy.yml` runs:
1. Worker TypeScript build + `wrangler deploy`
2. React PWA build (`npm run build`)
3. R2 upload of `dist/` under `frontend/` prefix
4. Health check: `GET /health` → must return `{"status":"ok"}`

## Run Tests

```bash
cd worker
npm install
bash src/tests/runtime/run-tests.sh
```

## Admin: Stuck Run Cleanup

If the watchdog reports stuck runs (caused by a crashed extraction), call:

```
POST /api/admin/cleanup-stuck-runs
```

This marks runs stuck for >30 minutes as `FAILED_ABANDONED`. Ledger entries,
journal lines, documents, and R2 objects are never touched.

## Portability

To move to a new Cloudflare account:
1. Clone repo
2. `wrangler d1 create snap-it-db` (new account)
3. Run schema + migrations
4. Set secrets
5. `wrangler deploy`
6. Upload frontend to R2
7. `GET /health` → `ok`

## Acceptance Test (Final)

Performed once on live production URL using a real physical receipt:

1. Open `https://snap-it-forget-it-api-extract.fmeconsultants1.workers.dev` on phone
2. Tap **📷 Snap Documents**
3. Photograph real receipt
4. Watch processing
5. Review extracted fields — correct if needed
6. Tap **✓ Approve & Save**
7. Tap **View Ledger →**
8. Confirm entry appears with correct vendor, date, amount, status=APPROVED
9. Tap 📄 icon — confirm original receipt image opens
10. Tap entry — edit a field — save — confirm change persists
11. From Accountant Portal — download CSV — confirm corrected values present

**DONE = all 11 steps pass on the live production URL with a real receipt.**
