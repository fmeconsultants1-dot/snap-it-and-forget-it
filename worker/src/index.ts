/**
 * index.ts - FME Mission 001 - Snap It & Forget It
 * Cloudflare Worker entry point. 26 routes total.
 * index.ts: 14 | extended.ts: 12
 */
import { ScanService, Env } from './services/ScanService';
import { LedgerService } from './services/LedgerService';
import { WatchdogService } from './services/WatchdogService';
import { handleExtended } from './routes/extended';

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

function err(msg: string, status = 400, origin = '*') {
  return json({ error: msg }, status, origin);
}

function getAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim());
  return allowed.includes(origin) ? origin : (allowed[0] ?? '*');
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function getContentType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = getAllowedOrigin(request, env);

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // ── STATIC FILE SERVING (frontend) ──
    if (!path.startsWith('/api/') && path !== '/health' && path !== '/health/full') {
      let filePath = path === '/' ? '/index.html' : path;
      const key = `frontend${filePath}`;
      const obj = await env.DOCUMENTS.get(key);
      if (obj) {
        const blob = await obj.arrayBuffer();
        const ct = getContentType(filePath);
        const cache = filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
        return new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': ct,
            'Cache-Control': cache,
            ...cors(origin),
          },
        });
      }
      // SPA fallback
      if (!filePath.includes('.')) {
        const idx = await env.DOCUMENTS.get('frontend/index.html');
        if (idx) {
          const blob = await idx.arrayBuffer();
          return new Response(blob, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...cors(origin) },
          });
        }
      }
    }

    try {

      // 1. GET /health
      if (path === '/health' && method === 'GET') {
        const ok = await env.DB.prepare('SELECT 1 as ok').first();
        return json({ status: 'ok', db: !!ok, ts: new Date().toISOString() }, 200, origin);
      }

      // 2. GET /health/full
      if (path === '/health/full' && method === 'GET') {
        const w = new WatchdogService(env.DB, env.DOCUMENTS, env.GEMINI_API_KEY);
        const report = await w.check();
        const status = report.status === 'ok' ? 200 : report.status === 'degraded' ? 207 : 503;
        return json(report, status, origin);
      }

      // 3. POST /api/scan/run
      if (path === '/api/scan/run' && method === 'POST') {
        const body = await request.json() as any;
        const svc = new ScanService(env);
        const runId = await svc.createRun(Number(body.documentCount ?? 1));
        return json({ runId }, 201, origin);
      }

      // 4. POST /api/scan/document
      if (path === '/api/scan/document' && method === 'POST') {
        const body = await request.json() as any;
        if (!body.runId) return err('runId required', 400, origin);
        if (!body.imageBase64) return err('imageBase64 required', 400, origin);
        const svc = new ScanService(env);
        const result = await svc.processDocument({
          runId: body.runId,
          sequence: Number(body.sequence ?? 1),
          imageBase64: body.imageBase64,
          mimeType: body.mimeType ?? 'image/jpeg',
          fileName: body.fileName,
        });
        return json(result, result.results[0]?.status === 'DONE' ? 200 : 422, origin);
      }

      // 5. POST /api/scan/run/:runId/finalize
      const finalizeMatch = path.match(/^\/api\/scan\/run\/([^/]+)\/finalize$/);
      if (finalizeMatch && method === 'POST') {
        const svc = new ScanService(env);
        await svc.finalizeRun(finalizeMatch[1]!);
        return json(await svc.getRun(finalizeMatch[1]!), 200, origin);
      }

      // 6. GET /api/scan/run/:runId
      const runGetMatch = path.match(/^\/api\/scan\/run\/([^/]+)$/);
      if (runGetMatch && method === 'GET') {
        const svc = new ScanService(env);
        const run = await svc.getRun(runGetMatch[1]!);
        if (!run) return err('Run not found', 404, origin);
        return json(run, 200, origin);
      }

      // 7. GET /api/ledger
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
        const runningTotal = await ledger.getRunningTotal(url.searchParams.get('runId') ?? undefined);
        return json({ entries, runningTotal }, 200, origin);
      }

      // 8. GET /api/ledger/journal
      if (path === '/api/ledger/journal' && method === 'GET') {
        const ledger = new LedgerService(env.DB);
        const entries = await ledger.getJournalEntries({
          runId: url.searchParams.get('runId') ?? undefined,
          dateFilter: url.searchParams.get('dateFilter') ?? undefined,
          entryType: url.searchParams.get('entryType') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
        });
        return json({ entries }, 200, origin);
      }

      // 9. GET /api/ledger/:id
      // Must come AFTER /api/ledger/journal to avoid prefix collision
      const ledgerGetMatch = path.match(/^\/api\/ledger\/([^/]+)$/);
      if (ledgerGetMatch && method === 'GET') {
        const ledger = new LedgerService(env.DB);
        const entry = await ledger.getLedgerEntryById(ledgerGetMatch[1]!);
        if (!entry) return err('Ledger entry not found', 404, origin);
        return json(entry, 200, origin);
      }

      // 10. PATCH /api/ledger/:id  — Stage 6: user corrects + approves in one call
      if (ledgerGetMatch && method === 'PATCH') {
        const body = await request.json() as any;
        const ledger = new LedgerService(env.DB);
        const { isBalanced, itcFlags } = await ledger.updateAndApprove(ledgerGetMatch[1]!, body);
        return json({ success: true, isBalanced, itcFlags }, 200, origin);
      }

      // 11. POST /api/ledger/:id/approve
      const approveMatch = path.match(/^\/api\/ledger\/([^/]+)\/approve$/);
      if (approveMatch && method === 'POST') {
        const ledger = new LedgerService(env.DB);
        await ledger.approveLedgerEntry(approveMatch[1]!);
        return json({ success: true }, 200, origin);
      }

      // 12. GET /api/ledger/:id/source
      const sourceMatch = path.match(/^\/api\/ledger\/([^/]+)\/source$/);
      if (sourceMatch && method === 'GET') {
        const row = await env.DB.prepare(
          'SELECT d.r2_key FROM ledger_entries le JOIN documents d ON le.document_id=d.id WHERE le.id=?'
        ).bind(sourceMatch[1]!).first() as any;
        if (!row?.r2_key) return err('Source not found', 404, origin);
        const obj = await env.DOCUMENTS.get(row.r2_key);
        if (!obj) return err('Document not in storage', 404, origin);
        const blob = await obj.arrayBuffer();
        return new Response(blob, {
          status: 200,
          headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg', ...cors(origin) },
        });
      }

      // 13. POST /api/import/bank
      if (path === '/api/import/bank' && method === 'POST') {
        const body = await request.json() as any;
        const rows = body.rows ?? [];
        const ids: string[] = [];
        for (const row of rows) {
          const id = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO bank_imports (id,source,transaction_date,description,amount,account_code,raw_row,imported_at) VALUES (?,?,?,?,?,?,?,datetime('now'))"
          ).bind(id, body.source ?? 'csv', row.date, row.description, row.amount, row.account_code ?? '1020', JSON.stringify(row)).run();
          ids.push(id);
        }
        return json({ imported: ids.length, ids }, 201, origin);
      }

      // 14. GET /api/export/ledger
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
            ...cors(origin),
          },
        });
      }

      // 15. GET /api/audit
      if (path === '/api/audit' && method === 'GET') {
        const result = await env.DB.prepare(
          'SELECT * FROM audit_log ORDER BY performed_at DESC LIMIT ?'
        ).bind(Number(url.searchParams.get('limit') ?? 100)).all();
        return json({ entries: result.results }, 200, origin);
      }

      // 16-27. Extended routes (reconcile, tax, AP, export, refund, split, runs)
      const extended = await handleExtended(request, env as any, origin);
      if (extended) return extended;

      return err('Not found', 404, origin);

    } catch (e: any) {
      console.error('[snap-it]', e);
      return err(e.message ?? 'Internal server error', 500, origin);
    }
  },
};
