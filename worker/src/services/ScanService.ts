/**
 * ScanService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Orchestrates the full scan pipeline:
 * 1. Create a scan run
 * 2. Upload document image to R2
 * 3. Call Gemini for extraction
 * 4. Persist extraction to D1
 * 5. Create ledger + journal entry
 * 6. Update run stats
 *
 * Stateful: each document tracks its own status.
 * A failed document does not abort the run.
 */

import { GeminiAdapter, ExtractionResult } from '../adapters/GeminiAdapter';
import { LedgerService } from './LedgerService';

function generateId(): string {
  return crypto.randomUUID();
}

function generateRefNumber(): string {
  return Math.random().toString(16).slice(2, 8).toUpperCase();
}

export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS: string;
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
    this.ledger = new LedgerService(env.DB);
  }

  async createRun(documentCount: number): Promise<string> {
    const runId = generateId();
    await this.db.prepare(`
      INSERT INTO scan_runs (id, document_count, status, created_at)
      VALUES (?,?,'PROCESSING',datetime('now'))
    `).bind(runId, documentCount).run();
    return runId;
  }

  async processDocument(params: {
    runId: string;
    sequence: number;
    imageBase64: string;
    mimeType: string;
    fileName?: string;
  }): Promise<{
    documentId: string;
    extractionId: string;
    ledgerEntryId: string;
    journalEntryId: string;
    refNumber: string;
    extraction: ExtractionResult;
    status: 'DONE' | 'FAILED';
    error?: string;
  }> {
    const documentId = generateId();
    const fileName = params.fileName ?? `doc-${params.sequence}-${Date.now()}.jpg`;
    const r2Key = `runs/${params.runId}/${documentId}/${fileName}`;

    // 1. Register document
    await this.db.prepare(`
      INSERT INTO documents (id, run_id, sequence, r2_key, file_name, mime_type, status, created_at)
      VALUES (?,?,?,?,?,?,'PROCESSING',datetime('now'))
    `).bind(documentId, params.runId, params.sequence, r2Key, fileName, params.mimeType).run();

    try {
      // 2. Upload to R2
      const imageBytes = Uint8Array.from(atob(params.imageBase64), c => c.charCodeAt(0));
      await this.r2.put(r2Key, imageBytes, {
        httpMetadata: { contentType: params.mimeType }
      });

      // 3. Update R2 URL on document
      await this.db.prepare(
        'UPDATE documents SET r2_key=?, file_size=? WHERE id=?'
      ).bind(r2Key, imageBytes.length, documentId).run();

      // 4. Gemini extraction
      const extraction = await this.gemini.extractDocument(params.imageBase64, params.mimeType);

      // 5. Persist extraction
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
        extraction.doc_type,
        extraction.vendor,
        extraction.date,
        extraction.total,
        extraction.subtotal,
        extraction.tax,
        extraction.tax_gst,
        extraction.tax_hst,
        extraction.tax_pst,
        extraction.payment_method,
        extraction.category,
        extraction.description,
        extraction.issuer,
        JSON.stringify(extraction.line_items),
        JSON.stringify(extraction.raw_fields),
        extraction.confidence_vendor,
        extraction.confidence_date,
        extraction.confidence_total,
        extraction.confidence_category,
        extraction.gemini_model
      ).run();

      // 6. Create ledger + journal entry
      const { ledgerEntryId, journalEntryId, refNumber } =
        await this.ledger.createFromExtraction(extraction, extractionId, documentId, params.runId);

      // 7. Mark document done
      await this.db.prepare(
        "UPDATE documents SET status='DONE', processed_at=datetime('now') WHERE id=?"
      ).bind(documentId).run();

      // 8. Update run stats
      await this.db.prepare(`
        UPDATE scan_runs
        SET processed_count = processed_count + 1,
            total_amount = total_amount + ?
        WHERE id=?
      `).bind(extraction.total ?? 0, params.runId).run();

      return { documentId, extractionId, ledgerEntryId, journalEntryId, refNumber, extraction, status: 'DONE' };

    } catch (err: any) {
      // Mark document failed — do NOT abort the run
      await this.db.prepare(
        "UPDATE documents SET status='FAILED', error=?, processed_at=datetime('now') WHERE id=?"
      ).bind(err.message ?? 'Unknown error', documentId).run();
      await this.db.prepare(`
        UPDATE scan_runs SET failed_count = failed_count + 1 WHERE id=?
      `).bind(params.runId).run();

      return {
        documentId,
        extractionId: '',
        ledgerEntryId: '',
        journalEntryId: '',
        refNumber: '',
        extraction: {} as ExtractionResult,
        status: 'FAILED',
        error: err.message
      };
    }
  }

  async finalizeRun(runId: string): Promise<void> {
    await this.db.prepare(`
      UPDATE scan_runs
      SET status='COMPLETE', completed_at=datetime('now')
      WHERE id=?
    `).bind(runId).run();
  }

  async getRun(runId: string) {
    return await this.db.prepare('SELECT * FROM scan_runs WHERE id=?').bind(runId).first();
  }
}
