/**
 * index.ts
 * FME Mission 001 — Snap It & Forget It
 * Cloudflare Worker — Main Entry Point
 */

import { ScanService, Env } from './services/ScanService';
import { LedgerService } from './services/LedgerService';

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status = 200, originHeader = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...cors(originHeader),
    },
  });
}

function error(message: string, status = 400, originHeader = '*') {
  return json({ error: message }, status, originHeader);
}

function getAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim());
  return allowed.includes(origin) ? origin : allowed[0] ?? '*';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const originHeader = getAllowedOrigin(request, env);

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(originHeader) });
    }

    try {
      // ── Health ─────────────────────────────────────────────────────────────
      if (path === '/health' && method === 'GET') {
        const dbCheck = await env.DB.prepare('SELECT 1 as ok').first();
        return json({ status: 'ok', db: !!dbCheck, ts: new Date().toISOString() }, 200, originHeader);
      }

      // ── Scan: start a new run ───────────────────────────────────────────────
      // POST /api/scan/run  { documentCount: number }
      if (path === '/api/scan/run' && method === 'POST') {
        const body = await request.json() as any;
        const documentCount = Number(body.documentCount ?? 1);
        const svc = new ScanService(env);
        const runId = await svc.createRun(documentCount);
        return json({ runId }, 201, originHeader);
      }

      // ── Scan: process one document ─────────────────────────────────────────
      // POST /api/scan/document  { runId, sequence, imageBase64, mimeType, fileName }
      if (path === '/api/scan/document' && method === 'POST') {
        const body = await request.json() as any;
        if (!body.runId) return error('runId required', 400, originHeader);
        if (!body.imageBase64) return error('imageBase64 required', 400, originHeader);
        const svc = new ScanService(env);
        const result = await svc.processDocument({
          runId: body.runId,
          sequence: Number(body.sequence ?? 1),
          imageBase64: body.imageBase64,
          mimeType: body.mimeType ?? 'image/jpeg',
          fileName: body.fileName,
        });
        return json(result, result.status === 'DONE' ? 200 : 422, originHeader);
      }

      // ── Scan: finalize run ─────────────────────────────────────────────────
      // POST /api/scan/run/:runId/finalize
      const finalizeMatch = path.match(/^\/api\/scan\/run\/([^/]+)\/finalize$/);
      if (finalizeMatch && method === 'POST') {
        const runId = finalizeMatch[1];
        const svc = new ScanService(env);
        await svc.finalizeRun(runId);
        const run = await svc.getRun(runId);
        return json(run, 200, originHeader);
      }

      // ── Scan: get run ──────────────────────────────────────────────────────
      // GET /api/scan/run/:runId
      const runGetMatch = path.match(/^\/api\/scan\/run\/([^/]+)$/);
      if (runGetMatch && method === 'GET') {
        const runId = runGetMatch[1];
        const svc = new ScanService(env);
        const run = await svc.getRun(runId);
        if (!run) return error('Run not found', 404, originHeader);
        return json(run, 200, originHeader);
      }

      // ── Ledger: register view ──────────────────────────────────────────────
      // GET /api/ledger?runId=&dateFilter=today|all|this_run&entryType=RECEIPT|INVOICE|STATEMENT&status=NEEDS_REVIEW
      if (path === '/api/ledger' && method === 'GET') {
        const ledger = new LedgerService(env.DB);
        const entries = await ledger.getLedgerEntries({
          runId: url.searchParams.get('runId') ?? undefined,
          dateFilter: url.searchParams.get('dateFilter') ?? undefined,
          entryType: url.searchParams.get('entryType') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          limit: Number(url.searchParams.get('limit') ?? 100),
          offset: Number(url.searchParams.get('offset') ?? 0),
        });
        const runningTotal = await ledger.getRunningTotal(
          url.searchParams.get('runId') ?? undefined
        );
        return json({ entries, runningTotal }, 200, originHeader);
      }

      // ── Ledger: accounting journal view ────────────────────────────────────
      // GET /api/ledger/journal?runId=&dateFilter=&entryType=&status=
      if (path === '/api/ledger/journal' && method === 'GET') {
        const ledger = new LedgerService(env.DB);
        const entries = await ledger.getJournalEntries({
          runId: url.searchParams.get('runId') ?? undefined,
          dateFilter: url.searchParams.get('dateFilter') ?? undefined,
          entryType: url.searchParams.get('entryType') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
        });
        return json({ entries }, 200, originHeader);
      }

      // ── Ledger: approve entry ──────────────────────────────────────────────
      // POST /api/ledger/:id/approve
      const approveMatch = path.match(/^\/api\/ledger\/([^/]+)\/approve$/);
      if (approveMatch && method === 'POST') {
        const ledgerEntryId = approveMatch[1];
        const ledger = new LedgerService(env.DB);
        await ledger.approveLedgerEntry(ledgerEntryId);
        return json({ success: true, ledgerEntryId }, 200, originHeader);
      }

      // ── Ledger: source document (R2 signed URL) ────────────────────────────
      // GET /api/ledger/:id/source
      const sourceMatch = path.match(/^\/api\/ledger\/([^/]+)\/source$/);
      if (sourceMatch && method === 'GET') {
        const ledgerEntryId = sourceMatch[1];
        const row = await env.DB.prepare(`
          SELECT d.r2_key FROM ledger_entries le
          JOIN documents d ON le.document_id = d.id
          WHERE le.id = ?
        `).bind(ledgerEntryId).first() as any;
        if (!row?.r2_key) return error('Source not found', 404, originHeader);
        // Generate signed URL (1 hour)
        const obj = await env.DOCUMENTS.get(row.r2_key);
        if (!obj) return error('Document not in storage', 404, originHeader);
        // Return as blob
        const blob = await obj.arrayBuffer();
        return new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg',
            ...cors(originHeader),
          },
        });
      }

      // ── Bank import ────────────────────────────────────────────────────────
      // POST /api/import/bank  { rows: [{date, description, amount, account_code}] }
      if (path === '/api/import/bank' && method === 'POST') {
        const body = await request.json() as any;
        const rows = body.rows ?? [];
        const inserted: string[] = [];
        for (const row of rows) {
          const id = crypto.randomUUID();
          await env.DB.prepare(`
            INSERT INTO bank_imports (id, source, transaction_date, description, amount, account_code, raw_row, imported_at)
            VALUES (?,?,?,?,?,?,?,datetime('now'))
          `).bind(id, body.source ?? 'csv', row.date, row.description, row.amount, row.account_code ?? '1020', JSON.stringify(row)).run();
          inserted.push(id);
        }
        return json({ imported: inserted.length, ids: inserted }, 201, originHeader);
      }

      // ── Export ─────────────────────────────────────────────────────────────
      // GET /api/export/ledger?format=csv&dateFrom=&dateTo=
      if (path === '/api/export/ledger' && method === 'GET') {
        const ledger = new LedgerService(env.DB);
        const entries = await ledger.getLedgerEntries({ limit: 10000 });
        const header = 'ref_number,date,entity,entry_type,amount,status\n';
        const rows = entries.map(e =>
          `${e.ref_number},${e.date ?? ''},"${(e.entity ?? '').replace(/"/g, '""')}",${e.entry_type},${e.amount},${e.status}`
        ).join('\n');
        return new Response(header + rows, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="snap-it-ledger.csv"',
            ...cors(originHeader),
          },
        });
      }

      // ── Audit log ──────────────────────────────────────────────────────────
      // GET /api/audit?entityType=&entityId=&limit=
      if (path === '/api/audit' && method === 'GET') {
        const result = await env.DB.prepare(`
          SELECT * FROM audit_log
          ORDER BY performed_at DESC
          LIMIT ?
        `).bind(Number(url.searchParams.get('limit') ?? 100)).all();
        return json({ entries: result.results }, 200, originHeader);
      }

      return error('Not found', 404, originHeader);

    } catch (err: any) {
      console.error('[snap-it-worker] Error:', err);
      return error(err.message ?? 'Internal server error', 500, originHeader);
    }
  },
};
