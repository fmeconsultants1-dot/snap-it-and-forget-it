# GitHub Secrets Required for Full CI/CD

This repository uses GitHub Actions to test, deploy, and verify Snap It & Forget It.

The test suite (Job 1) runs automatically and requires NO secrets.

Deployment and acceptance gates (Jobs 2-4) require these GitHub Repository Secrets:

## Required Secrets

Set at: GitHub → Repository → Settings → Secrets and variables → Actions → New repository secret

| Secret | Required For | How to Get |
|--------|-------------|------------|
| `CLOUDFLARE_API_TOKEN` | Deploy worker + frontend | Cloudflare Dashboard → My Profile → API Tokens → Create Token (Workers:Edit, D1:Edit, Pages:Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | All Cloudflare operations | Cloudflare Dashboard → right sidebar |
| `D1_DATABASE_ID` | Database migrations | After `wrangler d1 create snap-it-db` — copy the ID |
| `GEMINI_API_KEY` | AI extraction | https://aistudio.google.com/app/apikey |
| `WORKER_URL` | Post-deploy verification | Auto-detected from wrangler output; override if using custom domain |
| `VITE_API_URL` | Frontend build | Set to your worker URL (e.g. https://snap-it-worker.YOUR.workers.dev) |

## What Happens After Secrets Are Set

1. Any push to main triggers the pipeline automatically
2. Job 1: Tests run (vitest, real SQLite, all T7A-T7G + TS1-TS7)
3. Job 2: Worker deployed to Cloudflare, migrations run, secrets set
4. Job 3: Frontend built and deployed to Cloudflare Pages
5. Job 4: 10 automated acceptance gates run against the live deployment
6. Results appear in GitHub Actions → Summary

## Remaining Human Gates After CI Passes

- Physical mobile device test (camera capture)
- Three-receipt single-photo test
- Accountant portal review sign-off

## Current Status

Test suite: RUNNING (triggered on every push)
Deployment: PENDING (secrets not yet set)
Acceptance gates 1-10: PENDING (deployment required)
Acceptance gates 11-40: PENDING (physical device + Gemini required)
