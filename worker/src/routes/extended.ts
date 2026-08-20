/**
 * extended.ts — FME Mission 001
 * Extended API routes: reconcile, tax, AP/AR, export, refund, split
 */

import { ReconciliationService } from '../services/ReconciliationService';
import { GSTService } from '../services/GSTService';
import { APARService } from '../services/APARService';
import { ExportService } from '../services/ExportService';
import { RefundService } from '../services/RefundService';
import { SplitService } from '../services/SplitService';

export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS: string;
  ITC_REGISTERED?: string;         // 'true'|'false'
  ITC_REGISTRATION_NUMBER?: string;
  ITC_REGISTRATION_DATE?: string;  // YYYY-MM-DD
  PROVINCE?: string;               // 'BC'|'ON'|etc.
}

function json(data: unknown, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin },
  });
}

function err(msg: string, status = 400, origin = '*') {
  return json({ error: msg }, status, origin);
}

function buildBusinessConfig(env: Env) {
  return {
    itc_registered: env.ITC_REGISTERED === 'true',
    itc_registration_number: env.ITC_REGISTRATION_NUMBER ?? null,
    itc_registration_effective_date: env.ITC_REGISTRATION_DATE ?? null,
    default_payment_account: '1010' as const,
    uses_ap: true,
    min_confidence_for_itc: 0.70,
  };
}

function buildITCConfig(env: Env) {
  return {
    itc_registered: env.ITC_REGISTERED === 'true',
    registration_number: env.ITC_REGISTRATION_NUMBER ?? null,
    registration_effective_date: env.ITC_REGISTRATION_DATE ?? null,
    province: env.PROVINCE ?? 'BC',
    min_confidence_for_itc: 0.70,
  };
}

export async function handleExtended(
  request: Request,
  env: Env,
  originHeader: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // POST /api/reconcile
  if (path === '/api/reconcile' && method === 'POST') {
    const svc = new ReconciliationService(env.DB);
    return json(await svc.reconcileAll(), 200, originHeader);
  }

  // GET /api/reconcile/missing
  if (path === '/api/reconcile/missing' && method === 'GET') {
    const svc = new ReconciliationService(env.DB);
    const missing = await svc.getMissingReceipts();
    return json({ missing, count: missing.length }, 200, originHeader);
  }

  // GET /api/tax/summary
  if (path === '/api/tax/summary' && method === 'GET') {
    const dateFrom = url.searchParams.get('dateFrom') ?? new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const dateTo   = url.searchParams.get('dateTo')   ?? new Date().toISOString().slice(0, 10);
    const svc = new GSTService(env.DB, buildITCConfig(env) as any);
    return json(await svc.getTaxSummary({ dateFrom, dateTo }), 200, originHeader);
  }

  // GET /api/ap/summary
  if (path === '/api/ap/summary' && method === 'GET') {
    const svc = new APARService(env.DB);
    return json(await svc.getAPSummary(), 200, originHeader);
  }

  // GET /api/export/journal
  if (path === '/api/export/journal' && method === 'GET') {
    const svc = new ExportService(env.DB);
    const csv = await svc.exportJournalCSV({
      dateFrom: url.searchParams.get('dateFrom') ?? undefined,
      dateTo:   url.searchParams.get('dateTo')   ?? undefined,
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

  // GET /api/export/json
  if (path === '/api/export/json' && method === 'GET') {
    const svc = new ExportService(env.DB);
    return json(await svc.exportJSON({}), 200, originHeader);
  }

  // GET /api/accounts
  if (path === '/api/accounts' && method === 'GET') {
    const result = await env.DB.prepare('SELECT * FROM accounts WHERE is_active=1 ORDER BY code').all();
    return json({ accounts: result.results }, 200, originHeader);
  }

  // GET /api/runs
  if (path === '/api/runs' && method === 'GET') {
    const result = await env.DB.prepare('SELECT * FROM scan_runs ORDER BY created_at DESC LIMIT 50').all();
    return json({ runs: result.results }, 200, originHeader);
  }

  // POST /api/refund
  // Body: { originalLedgerEntryId, refundType, refundAmount, refundDate, idempotencyKey?, creditNoteId?, settlementAccount?, memo? }
  if (path === '/api/refund' && method === 'POST') {
    try {
      const body = await request.json() as any;
      if (!body.originalLedgerEntryId) return err('originalLedgerEntryId required', 400, originHeader);
      if (!body.refundType)            return err('refundType required (FULL|PARTIAL|CREDIT_NOTE|CARD_REFUND)', 400, originHeader);
      if (!body.refundAmount || body.refundAmount <= 0) return err('refundAmount must be > 0', 400, originHeader);
      if (!body.refundDate)            return err('refundDate required (YYYY-MM-DD)', 400, originHeader);
      const svc = new RefundService(env.DB);
      const result = await svc.createRefund({
        originalLedgerEntryId: body.originalLedgerEntryId,
        refundType: body.refundType,
        refundAmount: body.refundAmount,
        refundDate: body.refundDate,
        idempotencyKey: body.idempotencyKey,
        creditNoteId: body.creditNoteId,
        settlementAccount: body.settlementAccount,
        memo: body.memo,
        runId: body.runId,
      });
      const status = result.idempotent ? 200 : 201;
      return json(result, status, originHeader);
    } catch (e: any) {
      if (e.message?.includes('Over-refund')) return err(e.message, 422, originHeader);
      if (e.message?.includes('not found'))   return err(e.message, 404, originHeader);
      throw e;
    }
  }

  // GET /api/refund/guard/:ledgerEntryId  — check remaining refundable amount
  const guardMatch = path.match(/^\/api\/refund\/guard\/([^/]+)$/);
  if (guardMatch && method === 'GET') {
    const { checkOverRefund } = await import('../services/RefundService');
    const requested = Number(url.searchParams.get('amount') ?? 0);
    const guard = await checkOverRefund(env.DB, guardMatch[1]!, requested);
    return json(guard, 200, originHeader);
  }

  // POST /api/ledger/:id/split
  // Body: { splits[], total_gst, total_hst, total_pst, total_subtotal, total_with_tax, settlement_account_code, settlement_account_name, date }
  const splitMatch = path.match(/^\/api\/ledger\/([^/]+)\/split$/);
  if (splitMatch && method === 'POST') {
    try {
      const body = await request.json() as any;
      if (!body.splits || !Array.isArray(body.splits) || body.splits.length < 2) {
        return err('splits must be an array with at least 2 items', 400, originHeader);
      }
      const svc = new SplitService(env.DB, buildBusinessConfig(env) as any, buildITCConfig(env) as any);
      const result = await svc.applySplit({
        ledgerEntryId: splitMatch[1]!,
        splits: body.splits,
        total_gst: body.total_gst ?? 0,
        total_hst: body.total_hst ?? 0,
        total_pst: body.total_pst ?? 0,
        total_subtotal: body.total_subtotal,
        total_with_tax: body.total_with_tax,
        settlement_account_code: body.settlement_account_code,
        settlement_account_name: body.settlement_account_name,
        date: body.date,
      });
      return json(result, 200, originHeader);
    } catch (e: any) {
      if (e.message?.includes('sum'))      return err(e.message, 422, originHeader);
      if (e.message?.includes('approved')) return err(e.message, 409, originHeader);
      if (e.message?.includes('not found')) return err(e.message, 404, originHeader);
      throw e;
    }
  }

  // GET /api/ledger/:id/splits  — read split lines for an entry
  const splitsReadMatch = path.match(/^\/api\/ledger\/([^/]+)\/splits$/);
  if (splitsReadMatch && method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT * FROM split_lines WHERE ledger_entry_id = ? ORDER BY line_order'
    ).bind(splitsReadMatch[1]!).all();
    return json({ splits: result.results, count: result.results.length }, 200, originHeader);
  }

  return null;
}
