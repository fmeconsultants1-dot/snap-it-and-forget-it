import { afterEach, expect, it, vi } from 'vitest';
import { ScanService, type Env } from '../../services/ScanService';
import { GeminiAdapter, type ExtractionResult } from '../../adapters/GeminiAdapter';
import { createTestDb } from './db-harness';
afterEach(() => vi.restoreAllMocks());
it('retries multi-document once, preserves all five results, and preserves source on two failures or empty detection', async () => {
  const multi = vi.spyOn(GeminiAdapter.prototype, 'extractDocuments');
  const single = vi.spyOn(GeminiAdapter.prototype, 'extractDocument');
  const five = Array.from({ length: 5 }, (_, i) => ({ doc_type: 'RECEIPT', vendor: `Vendor ${i}`, date: '2026-09-08', total: 10, subtotal: 10, tax: 0, tax_gst: 0, tax_hst: 0, tax_pst: 0, payment_method: 'Cash', category: 'Office', description: null, issuer: null, line_items: [], raw_fields: {}, confidence_vendor: 1, confidence_date: 1, confidence_total: 1, confidence_category: 1, gemini_model: 'test' } as ExtractionResult));
  for (const mode of ['retry-success', 'two-failures', 'empty']) {
    multi.mockReset();
    if (mode === 'retry-success') multi.mockRejectedValueOnce(new Error('first failure')).mockResolvedValueOnce(five);
    else if (mode === 'two-failures') multi.mockRejectedValueOnce(new Error('first failure')).mockRejectedValueOnce(new Error('second real error'));
    else multi.mockResolvedValueOnce([]);
    const db = createTestDb();
    const put = vi.fn().mockResolvedValue({}); const remove = vi.fn();
    const scan = new ScanService({ DB: db, DOCUMENTS: { put, delete: remove }, GEMINI_API_KEY: 'test' } as unknown as Env);
    const runId = await scan.createRun(1);
    const result = await scan.processDocument({ runId, sequence: 1, imageBase64: 'aA==', mimeType: 'image/jpeg' });
    expect(multi).toHaveBeenCalledTimes(mode === 'empty' ? 1 : 2);
    expect(single).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
    if (mode === 'retry-success') {
      expect(result.detectedCount).toBe(5); expect(result.results).toHaveLength(5);
      expect(result.results.every(r => r.status === 'DONE')).toBe(true);
      expect(new Set(result.results.map(r => r.ledgerEntryId)).size).toBe(5);
    } else {
      expect(result.detectedCount).toBe(0);
      expect(result.results.every(r => r.status === 'FAILED' && !r.ledgerEntryId)).toBe(true);
      expect(result.results[0]?.error).toContain(mode === 'empty' ? 'No documents detected' : 'second real error');
      const source = await db.prepare('SELECT r2_key,status,error FROM documents WHERE id=?').bind(result.results[0]!.documentId).first();
      expect(source?.r2_key).toBeTruthy(); expect(source?.status).toBe('FAILED');
      expect(source?.error).toBe(result.results[0]?.error);
    }
  }
});
