# Snap It & Forget It — 40 Acceptance Gates
FME Mission 001

## CAMERA (Gates 1-5)
- [ ] 1. Mobile camera opens on `/camera` route
- [ ] 2. Rear camera (environment) is default
- [ ] 3. Camera flip button works
- [ ] 4. Shutter captures image to queue
- [ ] 5. Gallery fallback works when camera permission denied

## MULTI-DOCUMENT (Gates 6-10)
- [ ] 6. Multiple documents can be captured in one run (1-10)
- [ ] 7. Each document shows thumbnail in processing queue
- [ ] 8. Documents labeled Document 1 ... Document N
- [ ] 9. All processed sequentially; one failure does not abort run
- [ ] 10. "View Results →" only appears when all done

## GEMINI EXTRACTION (Gates 11-16)
- [ ] 11. RECEIPT correctly identified and fields extracted
- [ ] 12. INVOICE correctly identified and fields extracted
- [ ] 13. DOCUMENT type detected (notices, statements)
- [ ] 14. confidence_vendor, _date, _total, _category all present as %
- [ ] 15. Line items extracted with name, qty, unit_price, total
- [ ] 16. Canadian tax fields: tax_gst, tax_hst, tax_pst correctly populated

## RESULTS SCREEN (Gates 17-19)
- [ ] 17. Results screen shows all extracted fields
- [ ] 18. Confidence scores shown as percentages
- [ ] 19. "View Ledger" navigates to ledger with runId

## LEDGER — REGISTER (Gates 20-24)
- [ ] 20. Register view shows DATE/TYPE, ENTITY/ACCOUNT, AMOUNT columns
- [ ] 21. Debit entries show "DR $X.XX" in orange
- [ ] 22. Balance entries show "$X.XX" in white
- [ ] 23. NEEDS REVIEW badge appears on all new entries
- [ ] 24. "All" tab does NOT show duplicate entries

## LEDGER — TABS (Gate 25)
- [ ] 25. All 6 tabs work: This Run / Today / All / Receipts / Statements / Review

## LEDGER — ACCOUNTING JOURNAL (Gates 26-30)
- [ ] 26. Journal view shows ACCOUNT / DEBIT / CREDIT columns
- [ ] 27. 5010-Operating Expenses debit line present
- [ ] 28. 1010-Cash credit line present (or 1040 for credit card)
- [ ] 29. ✓ Balanced badge shown when debits == credits
- [ ] 30. Approve button changes status from DRAFT to APPROVED

## DOUBLE-ENTRY ENGINE (Gates 31-33)
- [ ] 31. Every scan creates exactly 2 journal lines (debit + credit)
- [ ] 32. total_debits == total_credits for every entry
- [ ] 33. Ref numbers are 6-char hex (e.g. #10A631)

## STORAGE (Gates 34-35)
- [ ] 34. Document images upload to R2 successfully
- [ ] 35. D1 database persists scan_runs, documents, extractions, ledger_entries, journal_entries, journal_lines

## EXPORT + AUDIT (Gates 36-37)
- [ ] 36. CSV export returns all ledger entries with correct columns
- [ ] 37. Audit log records CREATE and APPROVE events

## DEPLOYMENT (Gates 38-39)
- [ ] 38. Worker deployed to Cloudflare, /health returns {status: ok, db: true}
- [ ] 39. Frontend deployed to Cloudflare Pages, loads on mobile browser

## END-TO-END (Gate 40)
- [ ] 40. Physical mobile test: snap 2+ documents, Gemini extracts all fields, ledger shows balanced journal entries, approve one entry, export CSV
