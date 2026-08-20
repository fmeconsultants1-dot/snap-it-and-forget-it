/**
 * refund.runtime.test.ts — FME Mission 001
 * RUNTIME: real SQLite (D1-identical). No mocks.
 * STATUS: SQLITE RUNTIME VERIFIED / D1 PENDING (Human Gate 1)
 * Run: cd worker && npx vitest run src/tests/runtime/refund.runtime.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedOriginalEntry, assertJournalBalance,
  getJournalLines, getLedgerEntry, getLastAuditEntry, countRows } from './db-harness';
import { RefundService } from '../../services/RefundService';

let db: any;
let svc: RefundService;

beforeEach(() => {
  db = createTestDb();
  svc = new RefundService(db);
});

describe('T7A — Full refund', () => {
  it('balanced reversal, original preserved, audit written', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 96.34, subtotal: 91.75, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Food', vendor: 'Cactus Club', date: '2026-07-29'
    });
    const r = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'FULL', refundAmount: 96.34, refundDate: '2026-08-01' });
    const bal = await assertJournalBalance(db, r.refundJournalEntryId);
    expect(bal.balanced, `DR ${bal.totalDebits} CR ${bal.totalCredits}`).toBe(true);
    expect(bal.lineCount).toBeGreaterThan(0);
    const orig = await getLedgerEntry(db, ledgerEntryId) as any;
    expect(orig).not.toBeNull();
    expect(orig.amount).toBe(96.34);
    const refLE = await getLedgerEntry(db, r.refundLedgerEntryId) as any;
    expect(refLE.reversal_of).toBe(ledgerEntryId);
    expect(orig.review_note).toContain('REVERSED_BY');
    const audit = await getLastAuditEntry(db, r.refundLedgerEntryId) as any;
    expect(audit?.action).toBe('REFUND_CREATED');
    expect(r.cumulativeRefunded).toBeCloseTo(96.34, 2);
    expect(r.remainingRefundable).toBeCloseTo(0, 2);
    expect(r.isBalanced).toBe(true);
  });
});

describe('T7B — Partial refund 50%', () => {
  it('proportional reversal, remaining tracked', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 96.34, subtotal: 91.75, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Food', vendor: 'CC', date: '2026-07-29'
    });
    const r = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 48.17, refundDate: '2026-08-01' });
    const bal = await assertJournalBalance(db, r.refundJournalEntryId);
    expect(bal.balanced).toBe(true);
    expect(bal.lineCount).toBeGreaterThan(0);
    expect(r.remainingRefundable).toBeCloseTo(48.17, 2);
  });
});

describe('T7C — Supplier credit note', () => {
  it('DR AP / CR expense accounts, balanced', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 695.23, subtotal: 620.76, gst: 0, hst: 74.47, pst: 0,
      paymentMethod: 'Credit', category: 'Automotive', vendor: "Darcy's Auto",
      date: '2026-07-30', itcRegistered: true
    });
    const r = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'CREDIT_NOTE', refundAmount: 695.23, refundDate: '2026-08-05',
      creditNoteId: 'CN-2026-001' });
    const bal = await assertJournalBalance(db, r.refundJournalEntryId);
    expect(bal.balanced).toBe(true);
    const lines = await getJournalLines(db, r.refundJournalEntryId) as any[];
    const apLine = lines.find((l: any) => l.account_code === '2010' && l.debit > 0);
    expect(apLine).toBeDefined();
    expect(apLine.debit).toBeCloseTo(695.23, 2);
    const refLE = await getLedgerEntry(db, r.refundLedgerEntryId) as any;
    expect(refLE.credit_note_id).toBe('CN-2026-001');
  });
});

describe('T7D — Card refund settlement override', () => {
  it('refund received to 1040-CC, balanced', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 96.34, subtotal: 91.75, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Food', vendor: 'CC', date: '2026-07-29'
    });
    const r = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'CARD_REFUND', refundAmount: 96.34, refundDate: '2026-08-01',
      settlementAccount: '1040' });
    const bal = await assertJournalBalance(db, r.refundJournalEntryId);
    expect(bal.balanced).toBe(true);
    const lines = await getJournalLines(db, r.refundJournalEntryId) as any[];
    const ccLine = lines.find((l: any) => l.account_code === '1040' && l.debit > 0);
    expect(ccLine).toBeDefined();
  });
});

describe('T7E — Refund with GST reversal', () => {
  it('CR 1310 reversed, 3 lines, balanced', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 69.14, subtotal: 65.85, gst: 3.29, hst: 0, pst: 0,
      paymentMethod: 'Debit', category: 'Office', vendor: 'Staples',
      date: '2023-07-26', itcRegistered: true
    });
    const r = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'FULL', refundAmount: 69.14, refundDate: '2023-08-01' });
    const bal = await assertJournalBalance(db, r.refundJournalEntryId);
    expect(bal.balanced).toBe(true);
    expect(bal.lineCount).toBe(3);
    const lines = await getJournalLines(db, r.refundJournalEntryId) as any[];
    const gstCr = lines.find((l: any) => l.account_code === '1310' && l.credit > 0);
    expect(gstCr).toBeDefined();
    expect(gstCr.credit).toBeCloseTo(3.29, 2);
  });
});

describe('T7F — Refund with GST + PST', () => {
  it('GST in 1310 credit, PST in expense credit, no 1310 debit, balanced', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 113.00, subtotal: 100.00, gst: 5.00, hst: 0, pst: 8.00,
      paymentMethod: 'Credit', category: 'Office', vendor: 'Staples',
      date: '2026-01-15', itcRegistered: true
    });
    const r = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'FULL', refundAmount: 113.00, refundDate: '2026-02-01' });
    const bal = await assertJournalBalance(db, r.refundJournalEntryId);
    expect(bal.balanced).toBe(true);
    const lines = await getJournalLines(db, r.refundJournalEntryId) as any[];
    const gstCr = lines.find((l: any) => l.account_code === '1310' && l.credit > 0);
    expect(gstCr).toBeDefined();
    expect(gstCr.credit).toBeCloseTo(5.00, 2);
    const gstDr = lines.find((l: any) => l.account_code === '1310' && l.debit > 0);
    expect(gstDr).toBeUndefined();
  });
});

describe('T7G — Refund, unregistered', () => {
  it('2 lines, no 1310, balanced', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 267.08, subtotal: 267.08, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Debit', category: 'Other', vendor: 'ICBC',
      date: '2020-06-12'
    });
    const r = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'FULL', refundAmount: 267.08, refundDate: '2020-07-01' });
    const bal = await assertJournalBalance(db, r.refundJournalEntryId);
    expect(bal.balanced).toBe(true);
    expect(bal.lineCount).toBe(2);
    const lines = await getJournalLines(db, r.refundJournalEntryId) as any[];
    expect(lines.find((l: any) => l.account_code === '1310')).toBeUndefined();
  });
});

describe('REFUND-01 — Over-refund rejection', () => {
  it('rejects $50 when only $40 remains after $60 refunded', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 100.00, subtotal: 100.00, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Other', vendor: 'V', date: '2026-01-01'
    });
    await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 60.00, refundDate: '2026-02-01' });
    await expect(svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 50.00, refundDate: '2026-02-02' }))
      .rejects.toThrow('Over-refund rejected');
    const cnt = await countRows(db, 'ledger_entries',
      "reversal_of = ? AND entry_type = 'REFUND'", ledgerEntryId);
    expect(cnt).toBe(1);
  });
});

describe('REFUND-02 — Cumulative partial refunds', () => {
  it('$40+$30+$30 all succeed, cumulative=$100, remaining=$0', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 100.00, subtotal: 100.00, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Other', vendor: 'V', date: '2026-01-01'
    });
    const r1 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 40.00, refundDate: '2026-02-01' });
    const r2 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 30.00, refundDate: '2026-02-02' });
    const r3 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 30.00, refundDate: '2026-02-03' });
    expect(r1.remainingRefundable).toBeCloseTo(60.00, 2);
    expect(r2.remainingRefundable).toBeCloseTo(30.00, 2);
    expect(r3.remainingRefundable).toBeCloseTo(0.00, 2);
    expect(r3.cumulativeRefunded).toBeCloseTo(100.00, 2);
    for (const r of [r1, r2, r3]) {
      const b = await assertJournalBalance(db, r.refundJournalEntryId);
      expect(b.balanced).toBe(true);
    }
  });
});

describe('REFUND-03 — Reject after fully refunded', () => {
  it('rejects $0.01 after $100 already refunded', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 100.00, subtotal: 100.00, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Other', vendor: 'V', date: '2026-01-01'
    });
    await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'FULL', refundAmount: 100.00, refundDate: '2026-02-01' });
    await expect(svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 0.01, refundDate: '2026-02-02' }))
      .rejects.toThrow('Over-refund rejected');
  });
});

describe('Idempotency — duplicate request', () => {
  it('second call with same key returns existing, no new DB write', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 96.34, subtotal: 91.75, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Food', vendor: 'Test', date: '2026-07-29'
    });
    const key = 'idem-test-001';
    const r1 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'FULL', refundAmount: 96.34, refundDate: '2026-08-01', idempotencyKey: key });
    const r2 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'FULL', refundAmount: 96.34, refundDate: '2026-08-01', idempotencyKey: key });
    expect(r2.idempotent).toBe(true);
    expect(r2.refundLedgerEntryId).toBe(r1.refundLedgerEntryId);
    const cnt = await countRows(db, 'ledger_entries',
      "reversal_of = ? AND entry_type = 'REFUND'", ledgerEntryId);
    expect(cnt).toBe(1);
  });
});

describe('Atomicity — no orphans on failure', () => {
  it('fake ledger entry ID throws, zero records written', async () => {
    await expect(svc.createRefund({
      originalLedgerEntryId: 'nonexistent-id',
      refundType: 'FULL', refundAmount: 100.00, refundDate: '2026-08-01'
    })).rejects.toThrow();
    const cnt = await countRows(db, 'ledger_entries',
      "reversal_of = ?", 'nonexistent-id');
    expect(cnt).toBe(0);
  });
});

describe('Rounding — 33.33 + 33.33 + 33.34 = 100.00 exactly', () => {
  it('three partial refunds sum exactly to original, all balanced', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 100.00, subtotal: 100.00, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Other', vendor: 'V', date: '2026-01-01'
    });
    const r1 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 33.33, refundDate: '2026-02-01' });
    const r2 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 33.33, refundDate: '2026-02-02' });
    const r3 = await svc.createRefund({ originalLedgerEntryId: ledgerEntryId,
      refundType: 'PARTIAL', refundAmount: 33.34, refundDate: '2026-02-03' });
    for (const r of [r1, r2, r3]) {
      const b = await assertJournalBalance(db, r.refundJournalEntryId);
      expect(b.balanced).toBe(true);
    }
    expect(r3.cumulativeRefunded).toBeCloseTo(100.00, 2);
    expect(r3.remainingRefundable).toBeCloseTo(0.00, 2);
  });
});
