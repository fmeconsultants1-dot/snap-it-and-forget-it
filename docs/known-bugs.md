# Snap It & Forget It -- Known Bugs & Regression Register
FME Mission 001

## Evidence Source
11 screenshots from v1.0.0 baseline (captured 2026-08-19, user-provided).
Additional bugs identified during correction passes 1-5.

---

## BUG-001: Duplicate entries in All ledger tab
Status: FIXED
Evidence: Screenshot 4 (All tab) shows same entries duplicated
Fix: LedgerPage.tsx deduplicates by entry ID using Set before rendering, both register and journal views
Regression: Load All tab, count entries, must match unique ref_number count

## BUG-002: Heading shows template literal instead of scan count
Status: FIXED
Evidence: Screenshot 1 shows heading: '" + heading + "'
Fix: ProcessingPage.tsx uses React state for heading string
Regression: Process 4 docs, heading must show 'Scanning 4 documents...' then 'Done!'

## BUG-003: Source button non-functional
Status: WIRED (pending deployment verification)
Evidence: Source button visible in Screenshots 7-9
Fix: SourceModal in LedgerPage.tsx fetches /api/ledger/:id/source and renders image
Regression: Tap Source on any journal entry, verify image loads

## BUG-004: [object Object] in fields display
Status: FIXED
Evidence: Screenshot 2 shows 'fields: [object Object]'
Fix: ResultsPage.tsx renders line_items as structured array, raw_fields not displayed

## BUG-005: T7 zero-line refund accepted as pass
Status: FIXED (Correction 5A)
Previous: Negative total produced 0 journal lines, called 'trivially balanced'
Fix: RefundService.ts enforces REFUND != ZERO JOURNAL. Zero lines throws error.
New behavior: Refunds always produce reversing journal lines. Separate REFUND doc_type.
Regression: T7A-T7G all pass with non-zero line counts

## BUG-006: Split T5 was not a real split test
Status: FIXED (Correction 5B)
Previous: T5 used single category, documented as 'manual split queued'
Fix: SplitService.ts implements real multi-category splits with proportional GST/PST
New tests: TS1-TS7 all execute against real SQLite
Regression: TS5 proves 5-category split (Food/Cleaning/Office/Equipment/Personal) balanced

## BUG-007: Float drift in proportional tax allocation
Status: FIXED (Correction 5C)
Previous: splitProportional used floating-point arithmetic
Fix: money.ts uses largest-remainder method in integer cents
Invariant: SUM(allocated_parts) === total EXACTLY (diffCents === 0)
Regression: money.test.ts proves all splitProportional cases exact

## BUG-008: No over-refund protection
Status: FIXED (Correction 5C)
Previous: Multiple refunds could exceed original amount
Fix: checkOverRefund() validates cumulative refunds before every write
Regression: REFUND-01/02/03 runtime tests pass

## BUG-009: No idempotency on refund endpoint
Status: FIXED (Correction 5C)
Previous: Duplicate requests could double-post
Fix: idempotencyKey stored in review_note, checked before write
Regression: Idempotency runtime test passes

## BUG-010: Refund/split not atomic
Status: FIXED (Correction 5C)
Previous: Partial failure could leave orphan journal entries
Fix: D1 batch() wraps all writes. Partial failure = full rollback.
Regression: Atomicity runtime test - fake ledger ID throws, zero records written

## BUG-011: Personal purchase silently excluded from ledger
Status: FIXED (Correction 5C)
Previous: 'Personal purchase excluded from ITC' implied it was dropped
Fix: Personal purchase posts to expense account (is_business_use=0, itc_eligible=0)
Full cost appears in ledger for owner review. Not silently dropped.
Regression: TS4/TS5 verify personal lines exist in split_lines with is_business_use=0

## BUG-012: 2-line journal limit in engine
Status: FIXED (Correction 1)
Previous: Code comment and test implied 2-line limit
Fix: LedgerService.ts - only rule is SUM(DR)=SUM(CR)
Regression: T2 (3-line GST), T3 (GST+PST), T4 (AP invoice) all pass

## BUG-013: Auto-ITC from detected GST text
Status: FIXED (Correction 2)
Previous: ITC line created whenever GST/HST detected
Fix: GSTService.ts requires registration + eligible use + evidence + date
Regression: T8 (low confidence) flags ITC_DOCUMENTATION_INCOMPLETE, no 1310 line

## Regression Tests Required Before Gate 40
- [ ] Ledger All tab: no duplicate entries
- [ ] Processing heading: shows correct document count
- [ ] Results: no [object Object] in any field
- [ ] Journal: every entry has is_balanced=1
- [ ] Approve: status changes from DRAFT to APPROVED
- [ ] Export CSV: all entries present, no encoding errors
- [ ] Camera: getUserMedia opens rear camera on mobile
- [ ] Gallery fallback: works when camera denied
- [ ] Refund: T7A-T7G pass (SQLite runtime)
- [ ] Over-refund: REFUND-01/02/03 pass (SQLite runtime)
- [ ] Split: TS1-TS7 pass (SQLite runtime)
- [ ] Money: all splitProportional cases exact
- [ ] Personal line: is_business_use=0, itc_eligible=0 in split_lines
- [ ] Source button: loads image on deployed system
