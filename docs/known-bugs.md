# Snap It & Forget It — Known Bugs & Regression Register
FME Mission 001

## Evidence Source
11 screenshots from v1.0.0 baseline (captured 2026-08-19, user-provided).

---

## BUG-001: Duplicate entries in "All" ledger tab

**Status:** FIXED in LedgerPage.tsx
**Evidence:** Screenshot 4 (All tab) shows same entries duplicated compared to Screenshot 3 (This Run tab)
**Observed:** Real Canadian Superstore, Cactus Club Cafe, Darcy's Auto Service all appear twice in All tab
**Root Cause:** API query for "all" (no filter) was fetching entries already present in run filter, frontend not deduplicating
**Fix Applied:** LedgerPage.tsx deduplicates by entry ID using `Set<string>` before rendering, for both register and journal views
**Regression Test:** Load All tab → count entries → must match unique IDs, no duplicate ref numbers

---

## BUG-002: Heading shows template literal `" + heading + "` instead of scan count

**Status:** FIXED in ProcessingPage.tsx
**Evidence:** Screenshot 1 shows heading: `" + heading + "` (raw template variable unresolved)
**Root Cause:** Template literal not evaluated — string interpolation broken in previous build
**Fix Applied:** ProcessingPage.tsx uses React state: `{allDone ? 'Done!' : 'Scanning N documents...'}`
**Regression Test:** Process 4 docs → heading must show "Scanning 4 documents..." → then "Done!"

---

## BUG-003: Source button non-functional

**Status:** KNOWN (stub) — requires deployment to verify R2 retrieval
**Evidence:** Source button visible in Screenshots 7-9 (Accounting Journal)
**Current State:** Button renders correctly, onClick stub present
**Fix Required:** Wire onClick to `GET /api/ledger/:id/source`, display image in modal or new tab
**Priority:** Medium (not blocking ledger or extraction flows)

---

## BUG-004: `[object Object]` in fields display

**Status:** FIXED in ResultsPage.tsx
**Evidence:** Screenshot 2 shows `fields: [object Object]` on ICBC document
**Root Cause:** Raw object passed to display instead of parsed JSON
**Fix Applied:** ResultsPage.tsx renders `line_items` as structured array, `raw_fields` not shown directly

---

## BUG-005: Statements tab shows empty (no STATEMENT type entries from test data)

**Status:** EXPECTED (not a bug) — test data had no bank statements
**Evidence:** Screenshot 8 shows "No matching records." on Statements tab
**Note:** Filter is correct (`entry_type=STATEMENT`). Will populate once bank statements are scanned.

---

## Regression Tests Required Before Gate 40

- [ ] Ledger All tab: no duplicate entries
- [ ] Processing heading: shows correct document count
- [ ] Results: no `[object Object]` in any field
- [ ] Journal: every entry has is_balanced=1 (debits == credits)
- [ ] Approve: status changes from DRAFT to APPROVED
- [ ] Export CSV: all entries present, no encoding errors
- [ ] Camera: getUserMedia opens rear camera on mobile
- [ ] Gallery fallback: works when camera denied
