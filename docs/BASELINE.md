# Snap It & Forget It — Recovery Baseline

## Status: FROZEN — DO NOT OVERWRITE

This document records the exact working Cloudflare deployment that must be
preserved as the recovery point for all subsequent work.

---

## Live Deployment — Confirmed Working

| Field | Value |
|---|---|
| **Worker URL** | `https://snap-it-forget-it-extract.fmeconsultants1.workers.dev/` |
| **Worker Name** | `snap-it-forget-it-extract` |
| **CF Account** | `fmeconsultants1` |
| **Recorded at** | 2026-08-20T19:14 PDT (America/Vancouver) |
| **Status** | Live and responding |

---

## Git Baseline Pointer

| Field | Value |
|---|---|
| **Frozen branch** | `baseline/working-2026-08-20` |
| **HEAD SHA at freeze** | `a5fcb279c917af7d6f605bc356edb6f7e659ccf1` |
| **Freeze commit message** | `ci: trigger deploy pipeline — secrets now set [2026-08-20]` |
| **Branch created at** | 2026-08-20T19:14 PDT |

---

## Repo Pipeline Target (separate from baseline worker)

| Field | Value |
|---|---|
| **Repo** | `fmeconsultants1-dot/snap-it-and-forget-it` |
| **Pipeline worker name** | `snap-it-worker` |
| **Pipeline CF account** | `fmeconsultants1-dot` |
| **Pages project** | `snap-it-and-forget-it` |
| **Workflow file** | `.github/workflows/test-and-deploy.yml` |
| **Secrets registered** | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GEMINI_API_KEY` |

---

## Wrangler Config at Freeze (worker/wrangler.toml)

```toml
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[vars]
APP_ENV = "production"

[[d1_databases]]
binding = "DB"
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"

[[r2_buckets]]
binding = "DOCUMENTS"
bucket_name = "snap-it-documents"

# Secrets: GEMINI_API_KEY, ALLOWED_ORIGINS, ITC_REGISTERED,
#          ITC_REGISTRATION_NUMBER, ITC_REGISTRATION_DATE, PROVINCE
```

---

## Key Source Files at Freeze

| File | SHA |
|---|---|
| `worker/src/index.ts` | `f77ad5a4f7083e1068b423c9125d9c9528ab73d4` |
| `worker/wrangler.toml` | `29c9d0d8b1b12f4632f44ee2e73151356c1d5527` |
| `.github/workflows/test-and-deploy.yml` | `50a9872716f07d2c72d6aec300d1ccf3c2a84a95` |

---

## Pipeline Architecture (self-sovereign, from commit 18d77e4d)

- **Job 1 — Test:** vitest suite (unit + runtime SQLite) — no secrets needed
- **Job 2 — Deploy Worker:** Creates D1 + R2 idempotently, patches wrangler.toml,
  runs migrations, injects GEMINI_API_KEY + ALLOWED_ORIGINS, deploys worker,
  health-checks `/health` and `/health/full`
- **Job 3 — Deploy Frontend:** Vite build with worker URL injected, deploys to
  Cloudflare Pages project `snap-it-and-forget-it`
- **Job 4 — Acceptance:** 15 automated gates (Gates 1–15) against live deployment;
  Gates 16–40 require physical device + Gemini runtime

---

## Rollback Procedure

If any change breaks the pipeline target worker and the working baseline is
needed as the recovery source:

1. Checkout `baseline/working-2026-08-20` — this branch is pinned to SHA
   `a5fcb279` and **must never be merged to or force-pushed**.
2. The live recovery URL remains:
   `https://snap-it-forget-it-extract.fmeconsultants1.workers.dev/`
3. That worker is on account `fmeconsultants1` (not `fmeconsultants1-dot`) —
   it is independent of the repo CI/CD pipeline and cannot be overwritten by
   pipeline runs targeting `snap-it-worker`.

---

## Protection Notes

- The branch `baseline/working-2026-08-20` is the permanent git snapshot.
- The live URL above is on a **separate Cloudflare account** from the repo
  pipeline — pipeline deployments physically cannot overwrite it.
- No fix, migration, or redeployment should target the `fmeconsultants1`
  account or the `snap-it-forget-it-extract` worker name without explicit
  authorization.
- All remaining deployment work targets `snap-it-worker` on `fmeconsultants1-dot`.
