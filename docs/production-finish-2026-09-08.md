# Production finish verification — 2026-09-08

## Completed blockers

- Review resolves approved, skipped and manually recovered items. View Ledger appears after the final item resolves, including all-skipped runs.
- Manual recovery uses the existing endpoint; failures retain the form for retry. Deterministic recovery IDs prevent duplicate ledger records during concurrent requests. Invalid recovery values are rejected before writes.
- Skips persist through existing document/ledger status fields and audit records. Skipped entries contribute zero to totals. No schema changes.
- Retake stays in the current run, appends newly scanned items, then skips the original item. Original result objects and R2 objects are preserved. Session storage retains review progress through reloads.
- Ledger Edit / Review opens the existing review screen. Saved corrections are read from the audit trail; partial edits preserve category, payment and tax breakdown. Source extractions remain unchanged. Records with refunds or splits are protected from edits that would overwrite accounting allocations.
- Aggregate tax must match GST/HST/PST. Aggregate tax is never relabeled as GST. Calendar dates, negative/non-finite amounts and explicit zero-total confirmation are validated.
- Register, journal, total and ledger CSV share filter semantics. Journal columns use the le. prefix (including runId -> le.run_id). Totals use integer cents, add receipts/invoices, subtract refunds and exclude reference documents/skipped records. Totals span all matching records, independent of pagination; CSV has no fixed row cutoff.
- Stale tab responses are ignored; load errors offer Retry. This Run is disabled without a run ID. Original-document object URLs are released on close.
- Scan-start failures no longer fabricate nonexistent run IDs. Empty server envelopes cannot silently drop an image.
- GitHub Actions runs worker/frontend tests and builds before deployment, uploads assets before index.html, verifies the existing schema without migration writes, and checks health, deployed SHA and frontend contents.

## Verification

- Worker: 169 passing tests across 9 files, including real SQLite recovery, concurrent recovery, skip persistence, original preservation, correction/reopen/export and filters/totals.
- Frontend: 6 passing React behavior tests for mixed completion, all-skipped exit, restored progress, manual recovery, retry, failed skip and in-run retake.
- Worker TypeScript and frontend production build: passed.
- Workflow YAML parsing, production verification script syntax and diff whitespace checks: passed.

## Live acceptance

Local tests do not replace the physical-phone acceptance gate. After deployment, photograph a real receipt, approve it, reopen/edit it, view its original, and confirm corrected values in the filtered CSV. Also verify mixed failed/successful images, manual recovery and final-item skip on the production URL.
