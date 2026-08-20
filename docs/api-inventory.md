# Snap It & Forget It - Authoritative API Inventory
FME Mission 001 - Audited from index.ts + extended.ts
TOTAL REGISTERED ROUTES: 25

## index.ts (13)
1  GET  /health
2  GET  /health/full
3  POST /api/scan/run
4  POST /api/scan/document
5  POST /api/scan/run/:runId/finalize
6  GET  /api/scan/run/:runId
7  GET  /api/ledger
8  GET  /api/ledger/journal
9  POST /api/ledger/:id/approve
10 GET  /api/ledger/:id/source
11 POST /api/import/bank
12 GET  /api/export/ledger
13 GET  /api/audit

## extended.ts (12)
14 POST /api/reconcile
15 GET  /api/reconcile/missing
16 GET  /api/tax/summary
17 GET  /api/ap/summary
18 GET  /api/export/journal
19 GET  /api/export/json
20 GET  /api/accounts
21 GET  /api/runs
22 POST /api/refund
23 GET  /api/refund/guard/:id
24 POST /api/ledger/:id/split
25 GET  /api/ledger/:id/splits

## Error codes
422 = business rule violation (over-refund, unbalanced split)
409 = conflict (split on approved entry)
404 = not found
201 = created, 200 = idempotent duplicate
