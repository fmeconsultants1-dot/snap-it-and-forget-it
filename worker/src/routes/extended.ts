/**
 * extended.ts
 * FME Mission 001 — Snap It & Forget It
 * Extended API routes: reconciliation, tax, AP/AR, journal export
 * Import and call handleExtended(request, env) from index.ts if path not matched.
 */

import { ReconciliationService } from '../services/ReconciliationService';
import { GSTService } from '../services/GSTService';
import { APARService } from '../services/APARService';
import { ExportService } from '../services/ExportService';

function json(data: unknown, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    },
  });
}

export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS: string;
}

export async function handleExtended(
  request: Request,
  env: Env,
  originHeader: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // POST /api/reconcile — match bank imports to ledger entries
  if (path === '/api/reconcile' && method === 'POST') {
    const svc = new ReconciliationService(env.DB);
    const result = await svc.reconcileAll();
    return json(result, 200, originHeader);
  }

  // GET /api/reconcile/missing — bank imports with no receipt match
  if (path === '/api/reconcile/missing' && method === 'GET') {
    const svc = new ReconciliationService(env.DB);
    const missing = await svc.getMissingReceipts();
    return json({ missing, count: missing.length }, 200, originHeader);
  }

  // GET /api/tax/summary?dateFrom=&dateTo= — GST/HST/PST summary
  if (path === '/api/tax/summary' && method === 'GET') {
    const dateFrom = url.searchParams.get('dateFrom') ?? new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const dateTo = url.searchParams.get('dateTo') ?? new Date().toISOString().slice(0, 10);
    const svc = new GSTService(env.DB);
    const summary = await svc.getTaxSummary({ dateFrom, dateTo });
    return json(summary, 200, originHeader);
  }

  // GET /api/ap/summary — accounts payable aging
  if (path === '/api/ap/summary' && method === 'GET') {
    const svc = new APARService(env.DB);
    const summary = await svc.getAPSummary();
    return json(summary, 200, originHeader);
  }

  // GET /api/export/journal?format=csv&dateFrom=&dateTo= — journal export
  if (path === '/api/export/journal' && method === 'GET') {
    const svc = new ExportService(env.DB);
    const csv = await svc.exportJournalCSV({
      dateFrom: url.searchParams.get('dateFrom') ?? undefined,
      dateTo: url.searchParams.get('dateTo') ?? undefined,
    });
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="snap-it-journal.csv"',
        'Access-Control-Allow-Origin': originHeader,
      },
    });
  }

  // GET /api/export/json — full JSON export
  if (path === '/api/export/json' && method === 'GET') {
    const svc = new ExportService(env.DB);
    const data = await svc.exportJSON({});
    return json(data, 200, originHeader);
  }

  // GET /api/accounts — chart of accounts
  if (path === '/api/accounts' && method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT * FROM accounts WHERE is_active=1 ORDER BY code'
    ).all();
    return json({ accounts: result.results }, 200, originHeader);
  }

  // GET /api/runs — list recent scan runs
  if (path === '/api/runs' && method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT * FROM scan_runs ORDER BY created_at DESC LIMIT 50'
    ).all();
    return json({ runs: result.results }, 200, originHeader);
  }

  return null; // not handled
}
