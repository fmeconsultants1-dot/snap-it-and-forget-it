# Production date diagnosis — run eca83d5b-e72e-4c71-9ca4-f8dbf522753a

Read original extraction records created 2026-09-09 16:42:25–16:42:55 UTC. Ledger approval corrections were not mistaken for extraction output.

| Vendor / type | Extraction ID | Stored extraction date | Raw candidate | Raw confidence / stored confidence | Validator discarded? | Gemini omitted date? |
|---|---|---|---|---|---|---|
| Canadian Tire / RECEIPT | d5938e1b-3f14-482d-84ba-95e5ce3cb4c3 | null | 2020-07-13 | .95 / 0 | Yes: out of range | No |
| Superstore / RECEIPT | a42345ae-da4a-4f4b-ac7d-b7d46f366a44 | null | 2020-07-21 | .95 / 0 | Yes: out of range | No |
| Superstore / RECEIPT | a13dffa2-6140-41bf-ad19-3987c12a641c | null | 2020-07-20 | .95 / 0 | Yes: out of range | No |
| ADP / STATEMENT | eaded92c-5111-4dc3-bb37-ce24679927dc | null | null | .10 / 0 | No candidate | Yes |
| BC Hydro / INVOICE | 3cbbece0-1837-4a92-8a69-9181759ca873 | 2026-06-15 | 2026-06-15 | .95 / .95 | No | No |
| Superstore / RECEIPT (separate image) | 55a10d6a-e275-4a70-ad65-18bbec0f4b44 | 2026-08-13 | 2026-08-13 | .95 / .95 | No | No |

Classification: the first three are A literally (a returned date was discarded), but correctly so: 2020 is outside the retained 2021–2027 range. They are not low-confidence valid-date bugs. ADP is B. Recovery is needed for unusable extraction candidates; lowering confidence thresholds or replacing 2020 with 2026 would not be justified.

Date-only reread uses the same Gemini model and matches vendor/type/amount. It never changes original multi-document prompts, extraction path, approved accounting records or R2. It returns candidate plus printed evidence for verification; no candidate remains blank.
