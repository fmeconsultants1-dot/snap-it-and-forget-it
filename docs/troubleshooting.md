# Snap It & Forget It — Troubleshooting
FME Mission 001

## Camera Not Opening

**Symptom:** Camera permission denied or black screen.

**Fix:**
1. Ensure page is served over HTTPS (required for getUserMedia)
2. Check browser camera permissions: Settings → Site Permissions → Camera
3. Use gallery fallback button (photo icon) to upload from library
4. On iOS: Settings → Safari → Camera → Allow
5. On Android: Settings → Apps → Browser → Permissions → Camera

**Code path:** `CameraPage.tsx` → `navigator.mediaDevices.getUserMedia`

---

## Gemini Extraction Fails

**Symptom:** Document shows status FAILED in processing queue.

**Causes:**
1. `GEMINI_API_KEY` not set or expired
2. Image too small (< 100px) or corrupt
3. Rate limit exceeded

**Fix:**
1. Verify key: `wrangler secret put GEMINI_API_KEY`
2. Check Worker logs: `wrangler tail`
3. Test directly: `curl https://your-worker.workers.dev/health`
4. If rate limited: wait 60 seconds, retry

**Note:** One failed document does NOT abort the run. Other documents still process.

---

## D1 Database Error

**Symptom:** Worker returns 500 error, /health returns db: false.

**Fix:**
1. Check database_id in wrangler.toml matches your D1 database
2. Re-run migration: `wrangler d1 execute snap-it-db --file=src/db/schema.sql`
3. Check D1 dashboard in Cloudflare console

---

## Duplicate Entries in Ledger All Tab

**Symptom:** Same transactions appear twice.

**Root Cause:** Identified from v1.0.0 evidence (BUG-001).
**Fix:** Applied in LedgerPage.tsx — entries deduplicated by ID using Set.
**Regression Test:** Verify All tab count matches unique ref_number count.

---

## CORS Error in Browser

**Symptom:** Network error, "Access-Control-Allow-Origin" missing.

**Fix:**
1. Set ALLOWED_ORIGINS secret to include your Pages domain:
   `wrangler secret put ALLOWED_ORIGINS`
   Value: `https://snap-it-and-forget-it.pages.dev,http://localhost:5173`
2. Redeploy worker after changing secrets

---

## R2 Upload Fails

**Symptom:** Document status FAILED with R2-related error.

**Fix:**
1. Verify R2 bucket exists: `wrangler r2 bucket list`
2. Verify bucket name in wrangler.toml matches (`snap-it-documents`)
3. Check R2 is enabled for your Cloudflare account

---

## Frontend 404 on Refresh

**Symptom:** Refreshing /camera or /ledger returns 404.

**Fix:** Ensure `app/_redirects` file exists with: `/* /index.html 200`
Cloudflare Pages reads this automatically.

---

## Heading Shows Template Literal

**Symptom:** Processing screen shows `" + heading + "` instead of document count.

**Root Cause:** BUG-002 from v1.0.0 evidence. Fixed in ProcessingPage.tsx.
**If seen:** Hard refresh (Cmd+Shift+R). Old cached build may be served.
