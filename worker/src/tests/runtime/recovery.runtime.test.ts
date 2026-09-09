import { describe, expect, it, vi } from 'vitest';
import { ScanService, type Env } from '../../services/ScanService';
import { LedgerService } from '../../services/LedgerService';
import { ExportService } from '../../services/ExportService';
import { createTestDb, seedOriginalEntry, countRows } from './db-harness';

async function setup() {
  const db = createTestDb();
  await db.prepare("INSERT INTO scan_runs(id,status) VALUES('run','COMPLETE')").run();
  await db.prepare("INSERT INTO documents(id,run_id,r2_key,status,error) VALUES('failed','run','original/image.jpg','FAILED','Unreadable')").run();
  const put = vi.fn(() => { throw new Error('Must not change original R2 object'); });
  const env = { DB: db, DOCUMENTS: { put }, GEMINI_API_KEY: 'test' } as unknown as Env;
  return { db, scan: new ScanService(env), ledger: new LedgerService(env.DB), put };
}
const valid = { doc_type: 'RECEIPT', vendor: 'Manual vendor', date: '2026-09-08', total: 112,
  subtotal: 100, tax_gst: 5, tax_hst: 0, tax_pst: 7, category: 'Office', payment_method: 'Credit' };

describe('Bug E recovery and editing', () => {
  it('recovers once, reuses IDs on retry, preserves original document and R2', async () => {
    const { db, scan, put } = await setup();
    const original = await db.prepare("SELECT * FROM documents WHERE id='failed'").first();
    const first = await scan.manualRecover('failed', valid);
    const retry = await scan.manualRecover('failed', valid);
    expect(first.status).toBe('APPROVED');
    expect(retry.ledgerEntryId).toBe(first.ledgerEntryId);
    expect(retry.idempotent).toBe(true);
    expect(await countRows(db, 'ledger_entries', 'document_id=?', 'failed')).toBe(1);
    expect(await db.prepare("SELECT * FROM documents WHERE id='failed'").first()).toEqual(original);
    expect(put).not.toHaveBeenCalled();
  });
  it.each([
    { vendor: '' }, { date: '2026-02-30' }, { total: -1 }, { total: 0 },
    { total: null }, { tax_gst: -2 }, { tax_pst: 200 }, { doc_type: 'REFUND' },
  ])('rejects invalid recovery before writing: %j', async change => {
    const { db, scan } = await setup();
    await expect(scan.manualRecover('failed', { ...valid, ...change })).rejects.toThrow();
    expect(await countRows(db, 'extractions', 'document_id=?', 'failed')).toBe(0);
    expect(await countRows(db, 'ledger_entries', 'document_id=?', 'failed')).toBe(0);
  });
  it('does not create duplicate ledger records when recoveries race', async () => {
    const { db, scan } = await setup();
    await Promise.allSettled([scan.manualRecover('failed', valid), scan.manualRecover('failed', valid)]);
    const retry = await scan.manualRecover('failed', valid);
    expect(retry.status).toBe('APPROVED');
    expect(await countRows(db, 'ledger_entries', 'document_id=?', 'failed')).toBe(1);
    expect(await countRows(db, 'extractions', 'document_id=?', 'failed')).toBe(1);
  });
  it('permits an undated reference document without inventing a document date', async () => {
    const { scan, ledger } = await setup();
    const result = await scan.manualRecover('failed', { doc_type: 'DOCUMENT', total: 0 });
    expect((await ledger.getLedgerEntryById(result.ledgerEntryId))?.date).toBeNull();
  });
  it('persists skips idempotently without creating a ledger or altering the source key', async () => {
    const { db, scan, put } = await setup();
    await scan.skipDocument('failed'); await scan.skipDocument('failed');
    const row = await db.prepare("SELECT * FROM documents WHERE id='failed'").first();
    expect(row?.status).toBe('SKIPPED'); expect(row?.r2_key).toBe('original/image.jpg');
    expect(await countRows(db, 'ledger_entries', 'document_id=?', 'failed')).toBe(0);
    expect(await countRows(db, 'audit_log', "entity_id=? AND action='SKIPPED'", 'failed')).toBe(1);
    expect(put).not.toHaveBeenCalled();
  });
  it('skips a pending ledger item, excludes its total and rejects skipping approved items', async () => {
    const { db, scan, ledger } = await setup();
    const { ledgerEntryId } = await seedOriginalEntry(db, { amount: 10, subtotal: 10, gst: 0, hst: 0, pst: 0, vendor: 'Pending', date: '2026-09-08', category: 'Office', paymentMethod: 'Cash' });
    const entry = (await ledger.getLedgerEntryById(ledgerEntryId))!;
    await scan.skipDocument(entry.document_id!, ledgerEntryId);
    expect(await ledger.getRunningTotal({})).toBe(0);
    expect((await ledger.getJournalEntries({}))[0]?.status).toBe('SKIPPED');
    const approved = await scan.manualRecover('failed', valid);
    await expect(scan.skipDocument('failed', approved.ledgerEntryId)).rejects.toThrow();
  });
  it('reopens corrections, preserves tax/category/payment on partial edits, exports corrected values', async () => {
    const { db, scan, ledger } = await setup();
    const first = await scan.manualRecover('failed', valid);
    const extraction = await db.prepare('SELECT * FROM extractions WHERE id=?').bind(first.extractionId).first();
    await ledger.updateAndApprove(first.ledgerEntryId, { vendor: 'Corrected vendor', category: 'Travel' });
    await ledger.updateAndApprove(first.ledgerEntryId, { vendor: 'Final vendor' });
    const review = await ledger.getReviewCorrections(first.ledgerEntryId);
    expect(review).toMatchObject({ vendor: 'Final vendor', category: 'Travel', payment_method: 'Credit', tax_gst: 5, tax_pst: 7, total: 112 });
    const journal = (await ledger.getJournalEntries({}))[0]!;
    expect(journal.lines.some(l => l.account_code === '5030')).toBe(true);
    expect(journal.lines.some(l => l.account_code === '1040')).toBe(true);
    expect(await new ExportService(db as unknown as D1Database).exportLedgerCSV({})).toContain('Final vendor');
    expect(await db.prepare('SELECT * FROM extractions WHERE id=?').bind(first.extractionId).first()).toEqual(extraction);
  });
});
