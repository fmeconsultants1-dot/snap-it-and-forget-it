# Snap It & Forget It

**FME Mission 001** — Mobile receipt/document scanner with AI-powered bookkeeping.

## What It Does

Snap one or many receipts, invoices, and financial documents with your phone camera. Gemini AI extracts all fields with confidence scores. Every document creates a balanced double-entry journal entry automatically. Review, approve, and export for your accountant.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 PWA (Vite), dark theme, gold #FFB800 accent |
| AI Engine | Google Gemini 1.5 Flash (multi-document, confidence scoring) |
| API | Cloudflare Workers (TypeScript) |
| Database | Cloudflare D1 (SQLite at edge) |
| File Storage | Cloudflare R2 |
| Deployment | Cloudflare Pages + Workers |

## Features

- Multi-document camera scan (1-10 docs per run)
- Gemini AI extraction: vendor, date, total, subtotal, tax, line items, category, payment method
- Confidence scores per field (vendor, date, total, category)
- Double-entry ledger: 5010-Operating Expenses DR / 1010-Cash CR
- Document types: RECEIPT / INVOICE / DOCUMENT / STATEMENT
- Ledger views: This Run / Today / All / Receipts / Statements / Review
- Accounting Journal with Approve + Source actions
- GST/HST + PST tracking
- Bank/card import (CSV)
- Reconciliation engine
- Accountant export (CSV/PDF)
- Audit trail

## Repository Structure

```
/worker          Cloudflare Worker API (TypeScript)
  /src
    index.ts     Router entry point
    /routes      API route handlers
    /services    Business logic
    /db          D1 schema + migrations
    /adapters    AI + storage adapters
/app             React PWA frontend
  /src
    /pages       Screen components
    /components  UI components
    /store       State management
    /lib         API client
/scripts         Migration, export tools
/docs            Architecture, setup, deployment
```

## Acceptance

40 gates defined in docs/acceptance-gates.md

## Mission

FME Mission 001. Reconstructed from v1.0.0 screenshot evidence (11 screens).
Repository: fmeconsultants1-dot/snap-it-and-forget-it
