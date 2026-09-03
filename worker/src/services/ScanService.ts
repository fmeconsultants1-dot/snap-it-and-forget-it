/**
 * ScanService.ts - FME Mission 001 - Snap It & Forget It
 * Orchestrates: R2 upload -> Gemini extraction -> D1 persist -> Ledger creation
 * Stateful: failed documents do not abort the run.
 */
import { GeminiAdapter, ExtractionResult } from '../adapters/GeminiAdapter';
import { LedgerService, BusinessConfig } from './LedgerService';

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
      // Upload to R2
      const imageBytes = Uint8Array.from(atob(params.imageBase64), c => c.charCodeAt(0));
      await this.r2.put(r2Key, imageBytes, { httpMetadata: { contentType: params.mimeType } });

      // Gemini multi-document detection + extraction
      let extractions: ExtractionResult[] = [];
      try {
        extractions = await this.gemini.extractDocuments(params.imageBase64, params.mimeType);
      } catch (multiDocErr: any) {
        // Fallback: if multi-doc detection fails, treat entire image as one document
        console.warn(`[ScanService] Multi-doc detection failed (${multiDocErr.message}), falling back to single-document extraction`);
        const single = await this.gemini.extractDocument(params.imageBase64, params.mimeType);
        extractions = [single];
      }

      // Fallback: if no documents detected, treat entire image as one document
      const docsToProcess = extractions.length > 0 ? extractions : [await this.gemini.extractDocument(params.imageBase64, params.mimeType)];

      const results: Awaited<ReturnType<ScanService['processDocument']>>['results'] = [];
      let totalAmount = 0;

      for (let idx = 0; idx < docsToProcess.length; idx++) {
        const extraction = docsToProcess[idx]!;
        totalAmount += extraction.total ?? 0;

        // Persist extraction
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

        // Create ledger + journal
        const { ledgerEntryId, journalEntryId, refNumber, lineCount, itcFlags } =
          await this.ledger.createFromExtraction(extraction, extractionId, documentId, params.runId);

        results.push({
          documentId, extractionId, ledgerEntryId, journalEntryId,
          refNumber, lineCount, itcFlags, extraction, status: 'DONE' as const
        });
      }

      // Mark document done
      await this.db.prepare(
        "UPDATE documents SET status='DONE', processed_at=datetime('now') WHERE id=?"
      ).bind(documentId).run();

      // Update run stats with detected count and total
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
    const failed = run.failed_count ?? 0;
    const total = processed + failed;

    // Don't falsely claim completion if nothing succeeded
    const status = processed === 0 && failed > 0 ? 'FAILED' : 'COMPLETE';

    await this.db.prepare(
      "UPDATE scan_runs SET document_count=?, status=?, completed_at=datetime('now') WHERE id=?"
    ).bind(total, status, runId).run();
  }

  async getRun(runId: string) {
    return this.db.prepare('SELECT * FROM scan_runs WHERE id=?').bind(runId).first();
  }
}
