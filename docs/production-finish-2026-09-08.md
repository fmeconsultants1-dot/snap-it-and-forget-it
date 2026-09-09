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

### Continuation checkpoint — 2026-09-09 00:23 UTC

- Current local branch: `codex/production-finish-bug-e`, commit `1b95b69b7788aafdb4e922529e583f5b1158f5b9`. Working tree was clean at continuation; remote branch matches.
- GitHub Actions run [34294226652](https://github.com/fmeconsultants1-dot/snap-it-and-forget-it/actions/runs/34294226652) completed successfully for that exact commit.
- Remote `main` remains at `7ff98c2bbf02f3f5bada29aae51649ad9c2466bf`. GitHub reports the finish branch can merge automatically; no open PR exists for it.
- Production `/health` returned `status: ok`, `db: true`; `/version` returned `git_sha: unknown`. The finish has not been verified as deployed.
- PR creation needs an authenticated GitHub session. The available browser is signed out. No stored credential was read.
- Next: create the PR from the existing branch, deploy through the validated main-branch workflow, verify the deployed SHA and frontend, then perform the physical-phone acceptance below.

### Release validation — 2026-09-09

- User authorized committing the preserved working tree and pushing directly to `main` for GitHub Actions deployment.
- Re-ran existing suites: 169 worker tests and 6 frontend tests passed. Worker TypeScript build and frontend production build passed. Frontend built with the same production API URL as CI.
- Production verification script syntax and diff whitespace checks passed.
- Remote `main` remained at `7ff98c2` immediately before release; the finish branch contains that commit, allowing a normal fast-forward push.
- Deployment and physical-phone acceptance are separate gates. Check the release Actions run and deployed SHA before declaring readiness for phone acceptance.
- First main deployment run `34295254808` passed validation but failed at schema verification before deployment. Corrected its Wrangler invocation from the bulk-import `--file` path to the SELECT-only `--command` query path. Exact original failure logs require GitHub sign-in; this correction does not claim the original error cause is confirmed.

Local tests do not replace the physical-phone acceptance gate. After deployment, photograph a real receipt, approve it, reopen/edit it, view its original, and confirm corrected values in the filtered CSV. Also verify mixed failed/successful images, manual recovery and final-item skip on the production URL.

## P0 follow-up: dates and likely duplicates

Valid extracted dates retain their original confidence even below 90%; malformed, impossible and out-of-range dates remain null. Review prefills the date and visibly requests verification below 90%. Required-date approval rules, Gemini prompts and model are unchanged.

Duplicate checks compare normalized vendor/entity, business date and integer cents against existing receipt/invoice records, excluding the current record and skipped records. Matching document identity strengthens the visible warning. Approval rechecks immediately before saving; after seeing the warning the user may explicitly approve again or skip. No records are automatically deleted, merged, suppressed or rejected, and originals remain untouched.

Validation: 176 worker tests and 8 frontend tests pass; worker TypeScript and frontend TypeScript/production build pass. Tests cover 95%/70% valid dates, malformed/out-of-range/impossible dates, required versus optional dates, duplicate matching/nonmatching, source identity and legitimate approval after warning.
