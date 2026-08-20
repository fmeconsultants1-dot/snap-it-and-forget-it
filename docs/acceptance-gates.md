# Snap It & Forget It — 40 Acceptance Gates
FME Mission 001

Legend: [CODE] = code written | [UNIT] = unit test written | [RUNTIME] = SQLite runtime test written | [DEPLOY] = requires deployment

## CAMERA (Gates 1-5)
- [ ] 1. [DEPLOY] Mobile camera opens on /camera route
- [ ] 2. [DEPLOY] Rear camera (environment) is default
- [ ] 3. [DEPLOY] Camera flip button works
- [ ] 4. [DEPLOY] Shutter captures image to queue
- [ ] 5. [DEPLOY] Gallery fallback works when camera permission denied

## MULTI-DOCUMENT (Gates 6-10)
- [ ] 6. [DEPLOY] Multiple documents captured in one run (1-10)
- [ ] 7. [DEPLOY] Each document shows thumbnail in processing queue
- [ ] 8. [DEPLOY] Documents labeled Document 1 ... Document N
- [ ] 9. [CODE] Failed document does NOT abort run
- [ ] 10. [DEPLOY] View Results button only appears when all done

## GEMINI EXTRACTION (Gates 11-16)
- [ ] 11. [DEPLOY] RECEIPT correctly identified and fields extracted
- [ ] 12. [DEPLOY] INVOICE correctly identified and fields extracted
- [ ] 13. [DEPLOY] DOCUMENT type detected (notices, statements)
- [ ] 14. [DEPLOY] confidence_vendor, _date, _total, _category all present as %
- [ ] 15. [DEPLOY] Line items extracted with name, qty, unit_price, total
- [ ] 16. [DEPLOY] Canadian tax fields: tax_gst, tax_hst, tax_pst correctly populated

## RESULTS SCREEN (Gates 17-19)
- [ ] 17. [DEPLOY] Results screen shows all extracted fields
- [ ] 18. [DEPLOY] Confidence scores shown as percentages
- [ ] 19. [DEPLOY] View Ledger navigates to ledger with runId

## LEDGER — REGISTER (Gates 20-24)
- [ ] 20. [DEPLOY] Register view shows DATE/TYPE, ENTITY/ACCOUNT, AMOUNT columns
- [ ] 21. [DEPLOY] Debit entries show DR $X.XX in orange
- [ ] 22. [DEPLOY] Balance entries show $X.XX in white
- [ ] 23. [DEPLOY] NEEDS REVIEW badge appears on all new entries
- [ ] 24. [CODE+UNIT] All tab does NOT show duplicate entries (dedup by ID)

## LEDGER — TABS (Gate 25)
- [ ] 25. [DEPLOY] All 6 tabs work: This Run / Today / All / Receipts / Statements / Review

## LEDGER — ACCOUNTING JOURNAL (Gates 26-30)
- [ ] 26. [DEPLOY] Journal view shows ACCOUNT / DEBIT / CREDIT columns
- [ ] 27. [RUNTIME] 5010-Operating Expenses debit line present (T2 passes)
- [ ] 28. [RUNTIME] 1010-Cash credit line present (T1 passes) / 1040 for credit card
- [ ] 29. [RUNTIME] Balanced badge shown when debits == credits (all T1-T8 pass)
- [ ] 30. [DEPLOY] Approve button changes status from DRAFT to APPROVED

## DOUBLE-ENTRY ENGINE (Gates 31-33)
- [ ] 31. [RUNTIME] SUM(DR)=SUM(CR) for every transaction type (T1-T8, TS1-TS7)
- [ ] 32. [RUNTIME] No 2-line limit: 3-line GST, 4-line split, AP invoice all work
- [ ] 33. [RUNTIME] Ref numbers are 6-char hex (e.g. #10A631)

## REFUND ENGINE (Gates 34-35)
- [ ] 34. [RUNTIME] Full/partial/credit-note/card refunds all produce balanced journals (T7A-T7G)
- [ ] 35. [RUNTIME] Over-refund rejected, idempotency prevents double-post, atomicity prevents orphans (REFUND-01/02/03)

## SPLIT ENGINE (Gate 36)
- [ ] 36. [RUNTIME] Multi-category splits with proportional GST/PST, personal-use excluded from ITC, TS6 validation rejection writes zero records (TS1-TS7)

## STORAGE (Gate 37)
- [ ] 37. [DEPLOY] Document images upload to R2, D1 persists all 9 tables

## EXPORT + AUDIT (Gates 38-39)
- [ ] 38. [DEPLOY] CSV export returns all ledger entries with correct columns
- [ ] 39. [RUNTIME] Audit log records CREATE/APPROVE/REFUND_CREATED/SPLIT_APPLIED events

## END-TO-END (Gate 40)
- [ ] 40. [DEPLOY] Physical mobile test: snap 2+ documents, Gemini extracts all fields,
         ledger shows balanced journal entries, refund one entry, split one entry,
         approve one entry, export CSV, open Accountant Portal

## HOW TO RUN RUNTIME TESTS NOW (before deployment)
```bash
cd worker
npm install
bash src/tests/runtime/run-tests.sh
```
Expected: all money, unit, and runtime tests pass.
Actual D1 verification: after Human Gate 1 (Cloudflare deployment).
