# Snap It & Forget It — Authoritative API Inventory
FME Mission 001

**SOURCE:** Audited directly from `worker/src/index.ts` and `worker/src/routes/extended.ts`
**TOTAL REGISTERED ROUTES: 21**

> This file is generated from router source. Do not manually maintain the route count.
> Any change to the router must be reflected here in the same commit.

---

## Routes — index.ts (13 routes)

| # | METHOD | PATH | HANDLER | AUTH | TEST STATUS |
|---|--------|------|---------|------|-------------|
| 1 | GET | `/health` | D1 ping, returns `{status,db,ts}` | None | Pending deploy |
| 2 | GET | `/health/full` | WatchdogService.check() | None | Pending deploy |
| 3 | POST | `/api/scan/run` | ScanService.createRun() | None (future: user token) | Pending deploy |
| 4 | POST | `/api/scan/document` | ScanService.processDocument() → R2 upload + Gemini + LedgerService | None | Pending deploy |
| 5 | POST | `/api/scan/run/:runId/finalize` | ScanService.finalizeRun() | None | Pending deploy |
| 6 | GET | `/api/scan/run/:runId` | ScanService.getRun() | None | Pending deploy |
| 7 | GET | `/api/ledger` | LedgerService.getLedgerEntries() | None | Pending deploy |
| 8 | GET | `/api/ledger/journal` | LedgerService.getJournalEntries() | None | Pending deploy |
| 9 | POST | `/api/ledger/:id/approve` | LedgerService.approveLedgerEntry() | None | Pending deploy |
| 10 | GET | `/api/ledger/:id/source` | R2 object retrieval | None | Pending deploy |
| 11 | POST | `/api/import/bank` | D1 insert to bank_imports | None | Pending deploy |
| 12 | GET | `/api/export/ledger` | LedgerService.getLedgerEntries() → CSV | None | Pending deploy |
| 13 | GET | `/api/audit` | audit_log SELECT | None | Pending deploy |

## Routes — extended.ts (8 routes)

| # | METHOD | PATH | HANDLER | AUTH | TEST STATUS |
|---|--------|------|---------|------|-------------|
| 14 | POST | `/api/reconcile` | ReconciliationService.reconcileAll() | None | Pending deploy |
| 15 | GET | `/api/reconcile/missing` | ReconciliationService.getMissingReceipts() | None | Pending deploy |
| 16 | GET | `/api/tax/summary` | GSTService.getTaxSummary() | None | Pending deploy |
| 17 | GET | `/api/ap/summary` | APARService.getAPSummary() | None | Pending deploy |
| 18 | GET | `/api/export/journal` | ExportService.exportJournalCSV() | None | Pending deploy |
| 19 | GET | `/api/export/json` | ExportService.exportJSON() | None | Pending deploy |
| 20 | GET | `/api/accounts` | accounts SELECT | None | Pending deploy |
| 21 | GET | `/api/runs` | scan_runs SELECT | None | Pending deploy |

---

## Query Parameters

| Route | Params |
|-------|--------|
| GET /api/ledger | `runId`, `dateFilter` (today\|all), `entryType`, `status`, `limit`, `offset` |
| GET /api/ledger/journal | `runId`, `dateFilter`, `entryType`, `status` |
| GET /api/export/ledger | `format` (csv), `dateFrom`, `dateTo` |
| GET /api/export/journal | `format` (csv), `dateFrom`, `dateTo` |
| GET /api/export/json | `dateFrom`, `dateTo` |
| GET /api/tax/summary | `dateFrom` (required), `dateTo` (required) |
| GET /api/audit | `limit` |

---

## CORS

All routes: `Access-Control-Allow-Origin` set to the matched value from `ALLOWED_ORIGINS` secret.
Preflight: `OPTIONS *` returns `204 No Content` with full CORS headers.

## Auth

Current: None (all routes open).
Future gate: Bearer token on scan + approve endpoints before accountant portal launch.
This is a pre-deployment TODO, tracked in `docs/acceptance-gates.md` Gate 38.

## Error Shape

```json
{ "error": "Human-readable message" }
```

## Success Shape

All JSON responses: `Content-Type: application/json`
HTTP status reflects outcome (200, 201, 404, 422, 500).
