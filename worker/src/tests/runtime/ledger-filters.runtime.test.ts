import { describe, expect, it } from 'vitest';
import { ExportService } from '../../services/ExportService';
import { LedgerService, type LedgerFilter } from '../../services/LedgerService';
import { createTestDb, seedOriginalEntry } from './db-harness';

describe('Ledger filters and totals', () => {
  it('uses the same filters for the register, journal and full filtered total', async () => {
    const db = createTestDb();
    const service = new LedgerService(db as unknown as D1Database);
    const seeds = [
      ['RECEIPT', 10.10, 'APPROVED', '2026-09-01'],
      ['INVOICE', 20.20, 'NEEDS_REVIEW', '2026-09-02'],
      ['REFUND', 3.03, 'APPROVED', '2026-09-03'],
      ['STATEMENT', 9999, 'NEEDS_REVIEW', '2026-09-04'],
      ['DOCUMENT', 8888, 'NEEDS_REVIEW', '2026-09-05'],
    ] as const;
    const ids: string[] = [];
    for (const [type, amount, status, date] of seeds) {
      const entry = await seedOriginalEntry(db, { amount, subtotal: amount, gst: 0, hst: 0, pst: 0,
        paymentMethod: 'Cash', category: 'Office', vendor: type, date });
      ids.push(entry.ledgerEntryId);
      await db.prepare('UPDATE ledger_entries SET entry_type=?, status=? WHERE id=?')
        .bind(type, status, entry.ledgerEntryId).run();
    }
    const first = await service.getLedgerEntryById(ids[0]!);
    const cases: [LedgerFilter, number, number][] = [
      [{}, 27.27, 5], [{ entryType: 'RECEIPT' }, 10.10, 1],
      [{ entryType: 'STATEMENT' }, 0, 1], [{ entryType: 'REFUND' }, -3.03, 1],
      [{ status: 'NEEDS_REVIEW' }, 20.20, 3], [{ status: 'APPROVED' }, 7.07, 2],
      [{ dateFilter: 'today' }, 27.27, 5], [{ runId: first!.run_id! }, 10.10, 1],
      [{ dateFrom: '2026-09-02', dateTo: '2026-09-03' }, 17.17, 2],
      [{ status: 'APPROVED', dateFrom: '2026-09-02' }, -3.03, 1],
      [{ runId: 'missing' }, 0, 0],
    ];
    for (const [filter, total, count] of cases) {
      expect(await service.getRunningTotal(filter)).toBe(total);
      expect(await service.getLedgerEntries(filter)).toHaveLength(count);
      expect(await service.getJournalEntries(filter)).toHaveLength(count);
      const csv = await new ExportService(db as unknown as D1Database).exportLedgerCSV(filter);
      expect(csv.trim().split('\n')).toHaveLength(count + 1);
    }
    expect(await service.getLedgerEntries({ limit: 1 })).toHaveLength(1);
    expect(await service.getRunningTotal({ limit: 1 })).toBe(27.27);
  });
});
