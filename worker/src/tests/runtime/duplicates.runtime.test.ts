import { describe, expect, it } from 'vitest';
import { LedgerService } from '../../services/LedgerService';
import { createTestDb, seedOriginalEntry } from './db-harness';

describe('Likely duplicate warnings', () => {
  it('matches vendor/date/cents, strengthens same-source matches, excludes self, and never blocks approval', async () => {
    const db = createTestDb();
    const service = new LedgerService(db as unknown as D1Database);
    const seed = { amount: 86.14, subtotal: 86.14, gst: 0, hst: 0, pst: 0, vendor: 'Real Canadian Superstore', date: '2026-09-08', category: 'Food', paymentMethod: 'Cash' };
    const first = await seedOriginalEntry(db, seed);
    const row = (await service.getLedgerEntryById(first.ledgerEntryId))!;
    const candidate = { vendor: ' real canadian superstore ', date: seed.date, total: seed.amount };
    expect(await service.findLikelyDuplicates(candidate)).toHaveLength(1);
    expect(await service.findLikelyDuplicates({ ...candidate, date: '2026-09-07' })).toHaveLength(0);
    expect(await service.findLikelyDuplicates({ ...candidate, total: 86.15 })).toHaveLength(0);
    expect(await service.findLikelyDuplicates({ ...candidate, ledgerEntryId: first.ledgerEntryId })).toHaveLength(0);
    expect((await service.findLikelyDuplicates({ ...candidate, documentId: row.document_id! }))[0]?.sameDocument).toBe(true);
    const second = await seedOriginalEntry(db, seed);
    await service.approveLedgerEntry(second.ledgerEntryId);
    expect((await service.getLedgerEntryById(second.ledgerEntryId))?.status).toBe('APPROVED');
    expect(await service.getRunningTotal({})).toBe(172.28);
    expect(await service.getLedgerEntries({})).toHaveLength(2);
  });
});
