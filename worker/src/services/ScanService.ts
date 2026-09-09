/**
 * ScanService.ts - FME Mission 001 - Snap It & Forget It
 *
 * BUG E PHASE 2B:
 * Added manualRecover(documentId, corrections):
 *   - Loads the original document from D1 (never touches R2)
 *   - Idempotency: reuses existing MANUAL_ENTRY extraction+ledger
 *   - Conflict guard: returns 409 if a non-manual ledger already exists
 *   - Creates a manual extraction row (gemini_model='MANUAL_ENTRY')
 *   - Delegates entirely to existing LedgerService accounting engine
 *   - Bug A/B validation enforced by updateAndApprove()
 *   - Audit record on successful recovery
 */
import { GeminiAdapter, ExtractionResult } from '../adapters/GeminiAdapter';
import { LedgerService, BusinessConfig, ReviewCorrections, validateApprovalReadiness } from './LedgerService';

function generateId(): string { return crypto.randomUUID(); }

export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS: string;
  ITC_REGISTERED?: string;
  ITC_REGISTRATION_NUMBER?: string;
  ITC_REGISTRATION_DATE?: string;
  PROVINCE?: string;
}

export class ManualConflictError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ManualConflictError'; }
}

function buildBusinessConfig(env: Env): BusinessConfig {
  return {
    itc_registered: env.ITC_REGISTERED === 'true',
    itc_registration_number: env.ITC_REGISTRATION_NUMBER ?? null,
    itc_registration_effective_date: env.ITC_REGISTRATION_DATE ?? null,
    default_payment_account: '1010',
    uses_ap: true,
    min_confidence_for_itc: 0.70,
  };
}

export class ScanService {
  private db: D1Database;
  private r2: R2Bucket;
  private gemini: GeminiAdapter;
  private ledger: LedgerService;

  constructor(env: Env) {
    this.db = env.DB;
    this.r2 = env.DOCUMENTS;
    this.gemini = new GeminiAdapter(env.GEMINI_API_KEY);
    this.ledger = new LedgerService(env.DB, buildBusinessConfig(env));
  }

  // ---------------------------------------------------------------------------
  // manualRecover  (Bug E Phase 2B)
  // ---------------------------------------------------------------------------
  async manualRecover(
    documentId: string,
    corrections: ReviewCorrections
  ): Promise<{
    success: boolean;
    idempotent: boolean;
    documentId: string;
    extractionId: string;
    ledgerEntryId: string;
    journalEntryId: string;
    refNumber: string;
    status: string;
    isBalanced: boolean;
    itcFlags: string[];
  }> {
    if (!documentId || documentId.trim() === '') {
      throw new Error('documentId is required for manual recovery');
    }

    // 1. Load original document — must exist and have an R2 key
    const doc = await this.db
      .prepare('SELECT id, run_id, r2_key, file_name, mime_type, status, error FROM documents WHERE id=?')
      .bind(documentId).first() as any;
    if (!doc) throw new Error(`Document not found: ${documentId}`);
    if (!doc.r2_key) throw new Error(`Document ${documentId} has no R2 source`);

    // 2. Conflict guard — non-manual production ledger already exists?
    const nonManualLedger = await this.db.prepare(`
      SELECT le.id
      FROM ledger_entries le
      JOIN extractions ex ON le.extraction_id = ex.id
      WHERE le.document_id = ? AND ex.gemini_model != 'MANUAL_ENTRY'
      LIMIT 1
    `).bind(documentId).first() as any;
    if (nonManualLedger) {
      throw new ManualConflictError(
        `Document ${documentId} already has a production extraction and ledger entry. Manual recovery would create a duplicate. Use the existing record.`
      );
    }

    // 3. Idempotency — does a MANUAL_ENTRY extraction+ledger already exist?
    const existingManual = await this.db.prepare(`
      SELECT
        ex.id   AS extraction_id,
        le.id   AS ledger_entry_id,
        le.status AS ledger_status,
        je.id   AS journal_entry_id,
        le.ref_number
      FROM extractions ex
      JOIN ledger_entries le ON le.extraction_id = ex.id
      JOIN journal_entries je ON je.ledger_entry_id = le.id
      WHERE ex.document_id = ? AND ex.gemini_model = 'MANUAL_ENTRY'
      ORDER BY ex.extracted_at DESC
      LIMIT 1
    `).bind(documentId).first() as any;

    if (existingManual) {
      if (existingManual.ledger_status === 'APPROVED') {
        // Already approved — return same IDs, idempotent=true
        return {
          success: true, idempotent: true,
          documentId,
          extractionId:  existingManual.extraction_id,
          ledgerEntryId: existingManual.ledger_entry_id,
          journalEntryId: existingManual.journal_entry_id,
          refNumber: existingManual.ref_number ?? '',
          status: 'APPROVED', isBalanced: true, itcFlags: [],
        };
      }
      // NEEDS_REVIEW — reuse existing ledger, call updateAndApprove()
      const { isBalanced, itcFlags } = await this.ledger.updateAndApprove(
        existingManual.ledger_entry_id, corrections
      );
      // Audit
      await this.db.prepare(`
        INSERT INTO audit_log(entity_type,entity_id,action,before_state,after_state,performed_at)
        VALUES('documents',?,?,?,?,datetime('now'))
      `).bind(
        documentId, 'MANUAL_RECOVERY_APPROVED',
        JSON.stringify({ status: existingManual.ledger_status, extraction_id: existingManual.extraction_id }),
        JSON.stringify({ ledger_entry_id: existingManual.ledger_entry_id, idempotent_reuse: true })
      ).run();
      return {
        success: true, idempotent: true,
        documentId,
        extractionId:  existingManual.extraction_id,
        ledgerEntryId: existingManual.ledger_entry_id,
        journalEntryId: existingManual.journal_entry_id,
        refNumber: existingManual.ref_number ?? '',
        status: 'APPROVED', isBalanced, itcFlags,
      };
    }

    const validation = validateApprovalReadiness(corrections.doc_type ?? 'RECEIPT', corrections.vendor ?? null, corrections.date ?? null, corrections.total ?? null, corrections.confirm_zero_total === true);
    if (validation) throw new Error(validation);
    for (const key of ['subtotal', 'tax', 'tax_gst', 'tax_hst', 'tax_pst'] as const) {
      const value = corrections[key];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Amounts must be finite and non-negative.');
    }
    if ((corrections.tax_gst ?? 0) + (corrections.tax_hst ?? 0) + (corrections.tax_pst ?? 0) > (corrections.total ?? 0)) throw new Error('Tax cannot exceed total.');

    if (corrections.tax != null && Math.round(corrections.tax * 100) !== Math.round(((corrections.tax_gst ?? 0) + (corrections.tax_hst ?? 0) + (corrections.tax_pst ?? 0)) * 100)) throw new Error('GST, HST and PST must add up to the tax total.');

    // 4. No existing manual record — create extraction from user-supplied corrections
    const extractionId = `manual-extraction-${documentId}`;
    const docType      = corrections.doc_type ?? 'RECEIPT';
    const vendor       = corrections.vendor ?? null;
    const date         = corrections.date ?? null;
    const total        = corrections.total ?? 0;
    const rawFields    = JSON.stringify({
      source: 'MANUAL_ENTRY',
      original_error: doc.error ?? 'extraction failed',
      document_id: documentId,
      supplied_by: 'user',
    });

    await this.db.prepare(`
      INSERT OR IGNORE INTO extractions
        (id, document_id, doc_type, vendor, date, total, subtotal, tax,
         tax_gst, tax_hst, tax_pst, payment_method, category, description,
         issuer, line_items, raw_fields,
         confidence_vendor, confidence_date, confidence_total, confidence_category,
         gemini_model, extracted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(
      extractionId, documentId,
      docType, vendor, date, total,
      corrections.subtotal ?? null,
      corrections.tax ?? null,
      corrections.tax_gst ?? null,
      corrections.tax_hst ?? null,
      corrections.tax_pst ?? null,
      corrections.payment_method ?? null,
      corrections.category ?? null,
      corrections.description ?? null,
      null,                              // issuer
      JSON.stringify([]),                // line_items
      rawFields,
      vendor ? 1.0 : 0,                 // confidence_vendor
      date   ? 1.0 : 0,                 // confidence_date
      total  ? 1.0 : 0,                 // confidence_total
      corrections.category ? 1.0 : 0,  // confidence_category
      'MANUAL_ENTRY'
    ).run();

    // 5. Build synthetic ExtractionResult and delegate to existing accounting engine
    const syntheticExtraction: ExtractionResult = {
      doc_type: docType as ExtractionResult['doc_type'],
      vendor, date, total,
      subtotal: corrections.subtotal ?? null,
      tax:      corrections.tax ?? null,
      tax_gst:  corrections.tax_gst ?? null,
      tax_hst:  corrections.tax_hst ?? null,
      tax_pst:  corrections.tax_pst ?? null,
      payment_method: corrections.payment_method ?? null,
      category:       corrections.category ?? null,
      description:    corrections.description ?? null,
      issuer: null, line_items: [], raw_fields: {},
      confidence_vendor:   vendor ? 1.0 : 0,
      confidence_date:     date   ? 1.0 : 0,
      confidence_total:    total  ? 1.0 : 0,
      confidence_category: corrections.category ? 1.0 : 0,
      gemini_model: 'MANUAL_ENTRY',
    };

    // createFromExtraction uses run_id from doc, stores NEEDS_REVIEW first
    const { ledgerEntryId, journalEntryId, refNumber } =
      await this.ledger.createFromExtraction(
        syntheticExtraction, extractionId, documentId, doc.run_id
      );

    // 6. Approve through existing engine — Bug A/B validation enforced here
    const { isBalanced, itcFlags } = await this.ledger.updateAndApprove(
      ledgerEntryId, corrections
    );

    // 7. Audit
    await this.db.prepare(`
      INSERT INTO audit_log(entity_type,entity_id,action,before_state,after_state,performed_at)
      VALUES('documents',?,?,?,?,datetime('now'))
    `).bind(
      documentId, 'MANUAL_RECOVERY_APPROVED',
      JSON.stringify({ original_error: doc.error ?? 'extraction failed', extraction_id: null }),
      JSON.stringify({ extraction_id: extractionId, ledger_entry_id: ledgerEntryId, idempotent_reuse: false })
    ).run();

    return {
      success: true, idempotent: false,
      documentId, extractionId, ledgerEntryId, journalEntryId,
      refNumber, status: 'APPROVED', isBalanced, itcFlags,
    };
  }

  // ---------------------------------------------------------------------------
  // Existing methods unchanged
  // ---------------------------------------------------------------------------

  async skipDocument(documentId: string, ledgerEntryId?: string): Promise<void> {
    const doc = await this.db.prepare('SELECT * FROM documents WHERE id=?').bind(documentId).first() as any;
    if (!doc) throw new Error('Document not found');
    if (ledgerEntryId) {
      const entry = await this.db.prepare('SELECT * FROM ledger_entries WHERE id=? AND document_id=?').bind(ledgerEntryId, documentId).first() as any;
      if (!entry || !['NEEDS_REVIEW', 'DRAFT', 'SKIPPED'].includes(entry.status)) throw new Error('Only pending entries can be skipped');
      if (entry.status === 'SKIPPED') return;
      await this.db.batch([
        this.db.prepare("UPDATE ledger_entries SET status='SKIPPED' WHERE id=?").bind(ledgerEntryId),
        this.db.prepare("UPDATE journal_entries SET status='SKIPPED' WHERE ledger_entry_id=?").bind(ledgerEntryId),
        this.db.prepare("INSERT INTO audit_log(entity_type,entity_id,action,after_state) VALUES('ledger_entries',?,'SKIPPED',?)").bind(ledgerEntryId, JSON.stringify({ documentId })),
      ]);
    } else {
      const ledger = await this.db.prepare('SELECT id FROM ledger_entries WHERE document_id=? LIMIT 1').bind(documentId).first();
      if (ledger) throw new Error('Review the existing ledger entry before skipping this document');
      if (doc.status === 'SKIPPED') return;
      await this.db.batch([
        this.db.prepare("UPDATE documents SET status='SKIPPED' WHERE id=?").bind(documentId),
        this.db.prepare("INSERT INTO audit_log(entity_type,entity_id,action,after_state) VALUES('documents',?,'SKIPPED',?)").bind(documentId, JSON.stringify({ previousStatus: doc.status })),
      ]);
    }
  }

  async createRun(documentCount: number): Promise<string> {
    const runId = generateId();
    await this.db.prepare(
      "INSERT INTO scan_runs (id, document_count, status, created_at) VALUES (?,?,'PROCESSING',datetime('now'))"
    ).bind(runId, documentCount).run();
    return runId;
  }

  async processDocument(params: {
    runId: string; sequence: number;
    imageBase64: string; mimeType: string; fileName?: string;
  }): Promise<{
    results: {
      documentId: string; extractionId: string;
      ledgerEntryId: string; journalEntryId: string;
      refNumber: string; lineCount: number; itcFlags: string[];
      extraction: ExtractionResult;
      status: 'DONE' | 'FAILED'; error?: string;
    }[];
    detectedCount: number;
  }> {
    const documentId = generateId();
    const fileName = params.fileName ?? `doc-${params.sequence}-${Date.now()}.jpg`;
    const r2Key = `runs/${params.runId}/${documentId}/${fileName}`;

    await this.db.prepare(
      "INSERT INTO documents (id, run_id, sequence, r2_key, file_name, mime_type, status, created_at) VALUES (?,?,?,?,?,?,'PROCESSING',datetime('now'))"
    ).bind(documentId, params.runId, params.sequence, r2Key, fileName, params.mimeType).run();

    try {
      const imageBytes = Uint8Array.from(atob(params.imageBase64), c => c.charCodeAt(0));
      await this.r2.put(r2Key, imageBytes, { httpMetadata: { contentType: params.mimeType } });

      let extractions: ExtractionResult[] = [];
      try {
        extractions = await this.gemini.extractDocuments(params.imageBase64, params.mimeType);
      } catch (multiDocErr: any) {
        console.warn(`[ScanService] Multi-doc detection failed (${multiDocErr.message}), falling back to single-document extraction`);
        const single = await this.gemini.extractDocument(params.imageBase64, params.mimeType);
        extractions = [single];
      }

      const docsToProcess = extractions.length > 0
        ? extractions
        : [await this.gemini.extractDocument(params.imageBase64, params.mimeType)];

      const results: Awaited<ReturnType<ScanService['processDocument']>>['results'] = [];
      let totalAmount = 0;

      for (let idx = 0; idx < docsToProcess.length; idx++) {
        const extraction = docsToProcess[idx]!;
        totalAmount += extraction.total ?? 0;

        const extractionId = generateId();
        await this.db.prepare(`
          INSERT INTO extractions
            (id, document_id, doc_type, vendor, date, total, subtotal, tax,
             tax_gst, tax_hst, tax_pst, payment_method, category, description,
             issuer, line_items, raw_fields,
             confidence_vendor, confidence_date, confidence_total, confidence_category,
             gemini_model, extracted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        `).bind(
          extractionId, documentId,
          extraction.doc_type, extraction.vendor, extraction.date,
          extraction.total, extraction.subtotal, extraction.tax,
          extraction.tax_gst, extraction.tax_hst, extraction.tax_pst,
          extraction.payment_method, extraction.category, extraction.description,
          extraction.issuer,
          JSON.stringify(extraction.line_items),
          JSON.stringify(extraction.raw_fields),
          extraction.confidence_vendor, extraction.confidence_date,
          extraction.confidence_total, extraction.confidence_category,
          extraction.gemini_model
        ).run();

        const { ledgerEntryId, journalEntryId, refNumber, lineCount, itcFlags } =
          await this.ledger.createFromExtraction(extraction, extractionId, documentId, params.runId);

        results.push({
          documentId, extractionId, ledgerEntryId, journalEntryId,
          refNumber, lineCount, itcFlags, extraction, status: 'DONE' as const
        });
      }

      await this.db.prepare(
        "UPDATE documents SET status='DONE', processed_at=datetime('now') WHERE id=?"
      ).bind(documentId).run();
      await this.db.prepare(
        'UPDATE scan_runs SET processed_count=processed_count+?, total_amount=total_amount+? WHERE id=?'
      ).bind(docsToProcess.length, totalAmount, params.runId).run();

      return { results, detectedCount: docsToProcess.length };

    } catch (err: any) {
      await this.db.prepare(
        "UPDATE documents SET status='FAILED', error=?, processed_at=datetime('now') WHERE id=?"
      ).bind(err.message ?? 'Unknown error', documentId).run();
      await this.db.prepare(
        'UPDATE scan_runs SET failed_count=failed_count+1 WHERE id=?'
      ).bind(params.runId).run();
      return {
        results: [{
          documentId, extractionId: '', ledgerEntryId: '', journalEntryId: '',
          refNumber: '', lineCount: 0, itcFlags: [],
          extraction: {} as ExtractionResult,
          status: 'FAILED' as const, error: err.message,
        }],
        detectedCount: 0
      };
    }
  }

  async finalizeRun(runId: string): Promise<void> {
    const run = await this.db.prepare('SELECT * FROM scan_runs WHERE id=?').bind(runId).first() as any;
    if (!run) return;
    const processed = run.processed_count ?? 0;
    const failed    = run.failed_count ?? 0;
    const total     = processed + failed;
    const status    = processed === 0 && failed > 0 ? 'FAILED' : 'COMPLETE';
    await this.db.prepare(
      "UPDATE scan_runs SET document_count=?, status=?, completed_at=datetime('now') WHERE id=?"
    ).bind(total, status, runId).run();
  }

  async getRun(runId: string) {
    return this.db.prepare('SELECT * FROM scan_runs WHERE id=?').bind(runId).first();
  }
}
