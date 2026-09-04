# Known-Good Baseline

**Tag:** `known-good-multidoc-gallery-2026-09-04`  
**Branch:** `known-good-multidoc-gallery-2026-09-04`  
**Commit:** `799df0b9e73a7d19ae831b5eca96b4240536c58f`  
**Date:** 2026-09-04  
**Production JS:** `index-C-eMpWPd.js`  
**Production URL:** `https://snap-it-forget-it-api-extract.fmeconsultants1.workers.dev`

## What Is Confirmed Working at This Baseline

- Gallery / photo-library upload works
- One image → one document: detected, extracted, reviewed, approved
- One image → five documents: all five detected, extracted, individually reviewed
- 6 of 6 documents extracted successfully in one session
- Real Canadian Superstore identified correctly
- Canadian Tire identified
- BC Hydro invoice identified
- ADP statement identified
- Subtotal / tax / total extraction working
- Line-item extraction working
- Payment method extraction working
- Approved records reach the Ledger
- RECEIPT / INVOICE / STATEMENT type separation working
- Review screen populated with correct fields
- Status filtering functioning
- visualViewport-based camera shutter positioning (Samsung/Android fix)
- PWA service worker disabled (stabilization mode)
- /version endpoint live
- Diagnostic viewport readout on camera screen
- Error surfacing from results[0].error (not just HTTP 422)

## Remaining Bugs at This Baseline

- A. Single-document Walmart: date missing, total $0.00 — zero-dollar records must not auto-approve
- B. Date normalization: some statement dates show 2020-07-31 vs 2026-07-31
- C. Duplicate records: ADP / RCS appearing multiple times in ledger
- D. Ledger total accuracy: statement balances vs receipt/invoice treatment
- E. Review progression: final card exit flow needs verification

## Restore Instructions

To restore this exact version:
```
git checkout known-good-multidoc-gallery-2026-09-04
```
Or redeploy by pushing this branch to trigger the deploy workflow.
