# Snap It & Forget It — Architecture
FME Mission 001

## System Overview

```
┌─────────────────────────────────────────────┐
│            Mobile Browser (PWA)             │
│  React 18 + Vite + react-router-dom         │
│  Cloudflare Pages                           │
│                                             │
│  /           HomePage       (launch)        │
│  /camera     CameraPage     (getUserMedia)  │
│  /processing ProcessingPage (queue)         │
│  /results    ResultsPage    (extractions)   │
│  /ledger     LedgerPage     (register+journal)│
└─────────────────┬───────────────────────────┘
                  │ HTTPS fetch
                  ▼
┌─────────────────────────────────────────────┐
│         Cloudflare Worker (API)             │
│  TypeScript, itty-router                    │
│                                             │
│  POST /api/scan/run          → create run   │
│  POST /api/scan/document     → process doc  │
│  POST /api/scan/run/:id/finalize            │
│  GET  /api/ledger            → register     │
│  GET  /api/ledger/journal    → journal      │
│  POST /api/ledger/:id/approve               │
│  GET  /api/ledger/:id/source → R2 image     │
│  POST /api/import/bank       → CSV import   │
│  GET  /api/export/ledger     → CSV export   │
│  GET  /api/audit             → audit log    │
│  GET  /health                               │
└────┬──────────┬──────────────────────────────┘
     │          │
     ▼          ▼
  ┌──────┐  ┌──────────────────┐
  │  D1  │  │  Gemini 1.5 Flash │
  │SQLite│  │  (Google AI API)  │
  │      │  │                  │
  │Tables│  │  Multi-document  │
  │ scan_│  │  extraction with │
  │ runs │  │  confidence scores│
  │ docs │  └──────────────────┘
  │ extr │
  │ ledg │       ┌───────────┐
  │ jour │       │    R2     │
  │ j_ln │       │  Storage  │
  │ acct │       │  (images) │
  │ bank │       └───────────┘
  │ audt │
  └──────┘
```

## Data Flow

### Scan Flow
1. User opens camera on mobile
2. Captures 1-10 document images
3. Frontend creates a scan run → `POST /api/scan/run`
4. For each document:
   - Frontend sends base64 image → `POST /api/scan/document`
   - Worker uploads image to R2
   - Worker calls Gemini 1.5 Flash with extraction prompt
   - Gemini returns: doc_type, vendor, date, total, subtotal, tax, line_items, confidence scores
   - Worker validates and persists extraction to D1
   - Worker creates ledger_entry + journal_entry + 2 journal_lines
   - Returns result to frontend
5. Frontend shows ✓ Done per document
6. Frontend finalizes run → `POST /api/scan/run/:id/finalize`

### Ledger Flow
- Register view: `GET /api/ledger` with tab filter params
- Journal view: `GET /api/ledger/journal` with tab filter params
- Approve: `POST /api/ledger/:id/approve`
- Export: `GET /api/export/ledger?format=csv`

### Double-Entry Logic
For every RECEIPT/INVOICE:
```
DR  [5010-Operating Expenses OR category-specific]  $amount
CR  [1010-Cash OR 1040-Credit Card]                 $amount
```
For DOCUMENT/STATEMENT:
```
No DR/CR lines — Balance type only
```

## Key Business Rules

1. Every scan creates exactly one ledger_entry
2. Every ledger_entry has one journal_entry
3. Every journal_entry for RECEIPT/INVOICE has exactly 2 journal_lines
4. total_debits MUST equal total_credits (is_balanced=1)
5. All new entries start as NEEDS_REVIEW + DRAFT
6. Approve action: ledger→APPROVED, journal→APPROVED
7. Ref numbers are 6-char uppercase hex (e.g. #10A631)
8. A failed document does NOT abort the scan run
9. "All" tab deduplicates by entry ID (regression fix for duplicate bug)

## Provider Adapters

| Adapter | Interface | Implementation |
|---|---|---|
| AI Vision | GeminiAdapter | gemini-1.5-flash |
| Storage | R2Bucket (CF binding) | Cloudflare R2 |
| Database | D1Database (CF binding) | Cloudflare D1 (SQLite) |

Swapping AI provider: replace GeminiAdapter, keep ExtractionResult interface.
Swapping storage: replace R2 calls in ScanService, keep r2_key pattern.

## Account Code Map

| Code | Name | Type |
|---|---|---|
| 1010 | Cash | ASSET |
| 1020 | Bank - Chequing | ASSET |
| 1030 | Bank - Savings | ASSET |
| 1040 | Credit Card Payable | LIABILITY |
| 1100 | Accounts Receivable | ASSET |
| 2010 | Accounts Payable | LIABILITY |
| 2020 | GST/HST Payable | LIABILITY |
| 2030 | PST Payable | LIABILITY |
| 3010 | Owner Equity | EQUITY |
| 4010 | Revenue | REVENUE |
| 5010 | Operating Expenses | EXPENSE |
| 5020 | Meals & Entertainment | EXPENSE |
| 5030 | Travel | EXPENSE |
| 5040 | Vehicle | EXPENSE |
| 5050 | Office Supplies | EXPENSE |
| 5060 | Professional Fees | EXPENSE |
| 5070 | Utilities | EXPENSE |
