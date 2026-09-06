/**
 * index.ts - FME Mission 001 - Snap It & Forget It
 *
 * DIAGNOSTIC: POST /api/diagnostic/date-test
 * Exact-text-only date read. No normalization. Character order preserved.
 * NO D1 WRITES. NO LEDGER CHANGES.
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
    status, headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}
function err(msg: string, status = 400, origin = '*') {
  return json({ error: msg }, status, origin);
}
function getAllowedOrigin(request: Request, env: Env): string {
  const origin  = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim());
  return allowed.includes(origin) ? origin : (allowed[0] ?? '*');
}
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function getContentType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 8192;
  let result = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(result);
}

/**
 * Exact-text date prompt.
 * - Copy characters left-to-right as printed. No reordering. No normalization.
 * - For multi-document images: focus only on the receipt for the named vendor.
 * - Return raw character groups only.
 */
function buildExactTextPrompt(vendorHint: string): string {
  return `You are reading a physical receipt or document. Your ONLY task is to find the transaction date and copy its printed characters EXACTLY as they appear, left to right, without reordering or interpreting.

${vendorHint ? `Focus on the receipt/document from: ${vendorHint}. If multiple documents are visible, ignore all others.` : ''}

Return ONLY this JSON object:
{
  "exact_date_text": "<characters exactly as printed, e.g. 13/08/26 or 2026-08-13>",
  "character_groups": ["<group1>", "<group2>", "<group3>"],
  "separator": "</ or - or space or other>",
  "location_description": "<where on the document, e.g. top right, near total>",
  "confidence": <0.0-1.0>
}

RULES:
1. Copy printed characters LEFT TO RIGHT in the exact order they appear on the paper.
2. Do NOT reorder the groups.
3. Do NOT convert to YYYY-MM-DD.
4. Do NOT interpret what the date means.
5. If you cannot find a date, return exact_date_text: null.
6. character_groups must contain the individual numeric groups as printed.

Return ONLY the JSON. No markdown. No explanation.`;
}

async function runExactTextTest(imageBase64: string, mimeType: string, apiKey: string, vendorHint: string): Promise<any> {
  const model  = 'gemini-3.5-flash';
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const prompt = buildExactTextPrompt(vendorHint);
  const body   = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: mimeType, data: imageBase64 } },
    ]}],
    generationConfig: { temperature: 0.0, maxOutputTokens: 256 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.text();
    return { error: `Gemini ${res.status}: ${e.slice(0, 200)}` };
  }
  const data = await res.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) return { error: 'no text', finish: data?.candidates?.[0]?.finishReason };
  // Extract JSON
  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch {
    const match = text.match(/\{[\s\S]+?\}/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch { return { error: 'parse fail', raw: text.slice(0, 300) }; } }
    else { return { error: 'no JSON', raw: text.slice(0, 300) }; }
  }
  return parsed;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = getAllowedOrigin(request, env);

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    if (!path.startsWith('/api/') && path !== '/health' && path !== '/health/full' && path !== '/version') {
      let filePath = path === '/' ? '/index.html' : path;
      const obj = await env.DOCUMENTS.get(`frontend${filePath}`);
      if (obj) {
        const blob = await obj.arrayBuffer();
        const ct = getContentType(filePath);
        const cache = filePath.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable';
        return new Response(blob, { status: 200, headers: { 'Content-Type': ct, 'Cache-Control': cache, ...cors(origin) } });
      }
      if (!filePath.includes('.')) {
        const idx = await env.DOCUMENTS.get('frontend/index.html');
        if (idx) {
          const blob = await idx.arrayBuffer();
          return new Response(blob, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin) } });
        }
      }
    }

    try {
      if (path === '/version' && method === 'GET') {
        return json({ git_sha: (env as any).GIT_SHA ?? 'unknown', ts: new Date().toISOString() }, 200, origin);
      }
      if (path === '/health' && method === 'GET') {
        const ok = await env.DB.prepare('SELECT 1 as ok').first();
        return json({ status: 'ok', db: !!ok, ts: new Date().toISOString() }, 200, origin);
      }
      if (path === '/health/full' && method === 'GET') {
        const w = new WatchdogService(env.DB, env.DOCUMENTS, env.GEMINI_API_KEY);
        const report = await w.check();
        return json(report, report.status === 'ok' ? 200 : report.status === 'degraded' ? 207 : 503, origin);
      }
      if (path === '/api/scan/run' && method === 'POST') {
        const body = await request.json() as any;
        return json({ runId: await new ScanService(env).createRun(Number(body.documentCount ?? 1)) }, 201, origin);
      }
      if (path === '/api/scan/document' && method === 'POST') {
        const body = await request.json() as any;
        if (!body.runId || !body.imageBase64) return err('runId and imageBase64 required', 400, origin);
        const result = await new ScanService(env).processDocument({
          runId: body.runId, sequence: Number(body.sequence ?? 1),
          imageBase64: body.imageBase64, mimeType: body.mimeType ?? 'image/jpeg', fileName: body.fileName,
        });
        return json(result, result.results[0]?.status === 'DONE' ? 200 : 422, origin);
      }
      const finalizeMatch = path.match(/^\/api\/scan\/run\/([^/]+)\/finalize$/);
      if (finalizeMatch && method === 'POST') {
        const svc = new ScanService(env);
        await svc.finalizeRun(finalizeMatch[1]!);
        return json(await svc.getRun(finalizeMatch[1]!), 200, origin);
      }
      const runGetMatch = path.match(/^\/api\/scan\/run\/([^/]+)$/);
      if (runGetMatch && method === 'GET') {
        const run = await new ScanService(env).getRun(runGetMatch[1]!);
        if (!run) return err('Run not found', 404, origin);
        return json(run, 200, origin);
      }
      if (path === '/api/ledger' && method === 'GET') {
        const filter = {
          runId: url.searchParams.get('runId') ?? undefined,
          dateFilter: url.searchParams.get('dateFilter') ?? undefined,
          entryType: url.searchParams.get('entryType') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          dateFrom: url.searchParams.get('dateFrom') ?? undefined,
          dateTo: url.searchParams.get('dateTo') ?? undefined,
          limit: Number(url.searchParams.get('limit') ?? 100),
          offset: Number(url.searchParams.get('offset') ?? 0),
        };
        const ledger = new LedgerService(env.DB);
        const entries = await ledger.getLedgerEntries(filter);
        const runningTotal = await ledger.getRunningTotal(filter);
        return json({ entries, runningTotal }, 200, origin);
      }
      if (path === '/api/ledger/journal' && method === 'GET') {
        const entries = await new LedgerService(env.DB).getJournalEntries({
          runId: url.searchParams.get('runId') ?? undefined,
          dateFilter: url.searchParams.get('dateFilter') ?? undefined,
          entryType: url.searchParams.get('entryType') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          dateFrom: url.searchParams.get('dateFrom') ?? undefined,
          dateTo: url.searchParams.get('dateTo') ?? undefined,
        });
        return json({ entries }, 200, origin);
      }
      const ledgerGetMatch = path.match(/^\/api\/ledger\/([^/]+)$/);
      if (ledgerGetMatch && method === 'GET') {
        const entry = await new LedgerService(env.DB).getLedgerEntryById(ledgerGetMatch[1]!);
        if (!entry) return err('Ledger entry not found', 404, origin);
        return json(entry, 200, origin);
      }
      if (ledgerGetMatch && method === 'PATCH') {
        const body = await request.json() as any;
        const { isBalanced, itcFlags } = await new LedgerService(env.DB).updateAndApprove(ledgerGetMatch[1]!, body);
        return json({ success: true, isBalanced, itcFlags }, 200, origin);
      }
      const approveMatch = path.match(/^\/api\/ledger\/([^/]+)\/approve$/);
      if (approveMatch && method === 'POST') {
        await new LedgerService(env.DB).approveLedgerEntry(approveMatch[1]!);
        return json({ success: true }, 200, origin);
      }
      const sourceMatch = path.match(/^\/api\/ledger\/([^/]+)\/source$/);
      if (sourceMatch && method === 'GET') {
        const row = await env.DB.prepare(
          'SELECT d.r2_key FROM ledger_entries le JOIN documents d ON le.document_id=d.id WHERE le.id=?'
        ).bind(sourceMatch[1]!).first() as any;
        if (!row?.r2_key) return err('Source not found', 404, origin);
        const obj = await env.DOCUMENTS.get(row.r2_key);
        if (!obj) return err('Not in storage', 404, origin);
        const blob = await obj.arrayBuffer();
        return new Response(blob, { status: 200, headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg', ...cors(origin) } });
      }
      if (path === '/api/import/bank' && method === 'POST') {
        const body = await request.json() as any;
        const ids: string[] = [];
        for (const row of (body.rows ?? [])) {
          const id = crypto.randomUUID();
          await env.DB.prepare("INSERT INTO bank_imports (id,source,transaction_date,description,amount,account_code,raw_row,imported_at) VALUES (?,?,?,?,?,?,?,datetime('now'))")
            .bind(id, body.source ?? 'csv', row.date, row.description, row.amount, row.account_code ?? '1020', JSON.stringify(row)).run();
          ids.push(id);
        }
        return json({ imported: ids.length, ids }, 201, origin);
      }
      if (path === '/api/export/ledger' && method === 'GET') {
        const entries = await new LedgerService(env.DB).getLedgerEntries({ limit: 10000 });
        const header = 'ref_number,date,entity,entry_type,amount,status\n';
        const rows = entries.map(e => `${e.ref_number},${e.date ?? ''},"${(e.entity ?? '').replace(/"/g, '""')}",${e.entry_type},${e.amount},${e.status}`).join('\n');
        return new Response(header + rows, { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="snap-it-ledger.csv"', ...cors(origin) } });
      }
      if (path === '/api/audit' && method === 'GET') {
        const result = await env.DB.prepare('SELECT * FROM audit_log ORDER BY performed_at DESC LIMIT ?').bind(Number(url.searchParams.get('limit') ?? 100)).all();
        return json({ entries: result.results }, 200, origin);
      }
      const extractionDiagMatch = path.match(/^\/api\/diagnostic\/extraction\/([^/]+)$/);
      if (extractionDiagMatch && method === 'GET') {
        const row = await env.DB.prepare('SELECT id, date, raw_fields, gemini_model, extracted_at FROM extractions WHERE id = ?').bind(extractionDiagMatch[1]!).first() as any;
        if (!row) return err('Extraction not found', 404, origin);
        let rawFields: any = {};
        try { rawFields = JSON.parse(row.raw_fields ?? '{}'); } catch {}
        return json({ extraction_id: row.id, extraction_date: row.date, raw_fields_date: rawFields.date ?? null, gemini_model: row.gemini_model, extracted_at: row.extracted_at }, 200, origin);
      }

      // DIAGNOSTIC: POST /api/diagnostic/date-test
      // Exact-text-only date read. vendor_hint targets specific receipt in multi-doc image.
      // NO D1 WRITES. NO LEDGER CHANGES.
      if (path === '/api/diagnostic/date-test' && method === 'POST') {
        const body       = await request.json() as any;
        const entryId    = body.ledgerEntryId as string;
        const vendorHint = (body.vendorHint as string) ?? '';
        if (!entryId)            return err('ledgerEntryId required', 400, origin);
        if (!env.GEMINI_API_KEY) return err('GEMINI_API_KEY not configured', 500, origin);

        const row = await env.DB.prepare(
          'SELECT d.r2_key, d.mime_type, le.entity, le.entry_type FROM ledger_entries le JOIN documents d ON le.document_id=d.id WHERE le.id=?'
        ).bind(entryId).first() as any;
        if (!row?.r2_key) return err('Source document not found', 404, origin);

        const obj = await env.DOCUMENTS.get(row.r2_key);
        if (!obj)         return err('Document not in R2', 404, origin);

        const blob     = await obj.arrayBuffer();
        const mimeType = row.mime_type ?? obj.httpMetadata?.contentType ?? 'image/jpeg';
        const b64      = arrayBufferToBase64(blob);
        const result   = await runExactTextTest(b64, mimeType, env.GEMINI_API_KEY, vendorHint || row.entity);

        return json({
          ledger_entry_id: entryId,
          entity:          row.entity,
          entry_type:      row.entry_type,
          r2_key:          row.r2_key,
          vendor_hint:     vendorHint || row.entity,
          result,
        }, 200, origin);
      }

      const extended = await handleExtended(request, env as any, origin);
      if (extended) return extended;
      return err('Not found', 404, origin);

    } catch (e: any) {
      console.error('[snap-it]', e);
      return err(e.message ?? 'Internal server error', 500, origin);
    }
  },
};
