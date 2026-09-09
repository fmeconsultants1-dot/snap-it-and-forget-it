import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapters/GeminiAdapter';
import { validateApprovalReadiness } from '../services/LedgerService';

afterEach(() => vi.unstubAllGlobals());
describe('Date review candidates', () => {
  it.each([[0.95, '2026-09-08'], [0.70, '2026-09-08'], [0.70, '09/08/2026'], [0.95, '1900-01-01'], [0.95, '2026-02-30']])('validates %s / %s', async (confidence, date) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ doc_type: 'RECEIPT', date, confidence_date: confidence }) }] } }] }) }));
    const result = await new GeminiAdapter('test').extractDocument('test');
    const valid = date === '2026-09-08';
    expect(result.date).toBe(valid ? date : null);
    expect(result.confidence_date).toBe(valid ? confidence : 0);
  });
  it('requires dates for receipts, invoices and statements while DOCUMENT remains optional', () => {
    for (const type of ['RECEIPT','INVOICE','STATEMENT']) expect(validateApprovalReadiness(type, 'Vendor', null, 10, false)).not.toBeNull();
    expect(validateApprovalReadiness('DOCUMENT', null, null, 0, false)).toBeNull();
  });
});
