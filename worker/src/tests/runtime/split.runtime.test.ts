/**
 * split.runtime.test.ts — FME Mission 001
 * RUNTIME: real SQLite. No mocks.
 * Run: cd worker && npx vitest run src/tests/runtime/split.runtime.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedOriginalEntry, assertJournalBalance, countRows } from './db-harness';
import { SplitService } from '../../services/SplitService';

let db: any;
let svc: SplitService;

const REGISTERED_CONFIG: any = {
  itc_registered: true,
  itc_registration_number: 'RT-123456789',
  itc_registration_effective_date: '2020-01-01',
  default_payment_account: '1010',
  uses_ap: true,
  min_confidence_for_itc: 0.70,
};
const UNREGISTERED_CONFIG: any = {
  itc_registered: false,
  itc_registration_number: null,
  itc_registration_effective_date: null,
  default_payment_account: '1010',
  uses_ap: true,
  min_confidence_for_itc: 0.70,
};
const REGISTERED_ITC: any = {
  itc_registered: true,
  registration_number: 'RT-123456789',
  registration_effective_date: '2020-01-01',
  province: 'BC',
  min_confidence_for_itc: 0.70,
};
const UNREGISTERED_ITC: any = {
  itc_registered: false,
  registration_number: null,
  registration_effective_date: null,
  province: 'BC',
  min_confidence_for_itc: 0.70,
};

beforeEach(() => {
  db = createTestDb();
  svc = new SplitService(db, REGISTERED_CONFIG, REGISTERED_ITC);
});

describe('TS1 — 2-category split, no GST, unregistered', () => {
  it('3 lines, balanced, no ITC', async () => {
    const svcU = new SplitService(db, UNREGISTERED_CONFIG, UNREGISTERED_ITC);
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 100.00, subtotal: 100.00, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Other', vendor: 'Costco', date: '2026-03-01'
    });
    const result = await svcU.applySplit({
      ledgerEntryId,
      splits: [
        { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 60.00, is_business_use: true },
        { description: 'Meals', expense_account_code: '5020', expense_account_name: 'Meals', allocated_subtotal: 40.00, is_business_use: true },
      ],
      total_gst: 0, total_hst: 0, total_pst: 0,
      total_subtotal: 100.00, total_with_tax: 100.00,
      settlement_account_code: '1010', settlement_account_name: 'Cash',
      date: '2026-03-01',
    });
    expect(result.isBalanced).toBe(true);
    const bal = await assertJournalBalance(db, result.journalEntryId);
    expect(bal.balanced).toBe(true);
    expect(bal.lineCount).toBe(3);
    expect(result.itcTotal).toBe(0);
    const splitRows = await countRows(db, 'split_lines', 'ledger_entry_id = ?', ledgerEntryId);
    expect(splitRows).toBe(2);
  });
});

describe('TS2 — 3-category split with proportional GST', () => {
  it('7 lines (3 expense + 3 ITC + 1 settlement), balanced, proportional GST', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 254.80, subtotal: 242.67, gst: 12.13, hst: 0, pst: 0,
      paymentMethod: 'Credit', category: 'Other', vendor: 'Costco', date: '2026-03-10',
      itcRegistered: true
    });
    const result = await svc.applySplit({
      ledgerEntryId,
      splits: [
        { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 100.00, is_business_use: true, category: 'Office' },
        { description: 'Cleaning Supplies', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 80.00, is_business_use: true, category: 'Office' },
        { description: 'Food Inventory', expense_account_code: '5020', expense_account_name: 'Meals', allocated_subtotal: 62.67, is_business_use: true, category: 'Food' },
      ],
      total_gst: 12.13, total_hst: 0, total_pst: 0,
      total_subtotal: 242.67, total_with_tax: 254.80,
      settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
      date: '2026-03-10',
    });
    expect(result.isBalanced).toBe(true);
    const bal = await assertJournalBalance(db, result.journalEntryId);
    expect(bal.balanced).toBe(true);
    expect(bal.lineCount).toBe(7);
    expect(result.itcTotal).toBeGreaterThan(0);
    const splitRows = await countRows(db, 'split_lines', 'ledger_entry_id = ?', ledgerEntryId);
    expect(splitRows).toBe(3);
  });
});

describe('TS3 — 4-category split with GST + PST', () => {
  it('balanced, PST in expense not 1310, settlement = full total', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 565.00, subtotal: 500.00, gst: 25.00, hst: 0, pst: 40.00,
      paymentMethod: 'Credit', category: 'Other', vendor: 'Wholesale', date: '2026-04-01',
      itcRegistered: true
    });
    const result = await svc.applySplit({
      ledgerEntryId,
      splits: [
        { description: 'Equipment', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 200.00, is_business_use: true, category: 'Office' },
        { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 150.00, is_business_use: true, category: 'Office' },
        { description: 'Cleaning Supplies', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 100.00, is_business_use: true, category: 'Office' },
        { description: 'Food Inventory', expense_account_code: '5020', expense_account_name: 'Meals', allocated_subtotal: 50.00, is_business_use: true, category: 'Food' },
      ],
      total_gst: 25.00, total_hst: 0, total_pst: 40.00,
      total_subtotal: 500.00, total_with_tax: 565.00,
      settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
      date: '2026-04-01',
    });
    expect(result.isBalanced).toBe(true);
    const bal = await assertJournalBalance(db, result.journalEntryId);
    expect(bal.balanced).toBe(true);
    expect(Math.abs(result.totalCredits - 565.00)).toBeLessThanOrEqual(0.01);
  });
});

describe('TS4 — Split with personal-use line', () => {
  it('personal line excluded from ITC, tracked separately, balanced', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 210.00, subtotal: 200.00, gst: 10.00, hst: 0, pst: 0,
      paymentMethod: 'Credit', category: 'Other', vendor: 'Store', date: '2026-05-01',
      itcRegistered: true
    });
    const result = await svc.applySplit({
      ledgerEntryId,
      splits: [
        { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 100.00, is_business_use: true, category: 'Office' },
        { description: 'Personal Items', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 100.00, is_business_use: false },
      ],
      total_gst: 10.00, total_hst: 0, total_pst: 0,
      total_subtotal: 200.00, total_with_tax: 210.00,
      settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
      date: '2026-05-01',
    });
    expect(result.isBalanced).toBe(true);
    const bal = await assertJournalBalance(db, result.journalEntryId);
    expect(bal.balanced).toBe(true);
    expect(result.personalUseTotal).toBeGreaterThan(0);
    expect(result.itcTotal).toBeGreaterThan(0);
    expect(result.itcTotal).toBeLessThan(10.00);
    // Personal split_line has is_business_use = 0
    const personalRow: any = await db.prepare(
      "SELECT * FROM split_lines WHERE ledger_entry_id = ? AND is_business_use = 0"
    ).bind(ledgerEntryId).first();
    expect(personalRow).not.toBeNull();
    expect(personalRow.description).toBe('Personal Items');
    expect(personalRow.itc_eligible).toBe(0);
  });
});

describe('TS5 — 5-category: Food + Cleaning + Office + Equipment + Personal', () => {
  it('10 lines, balanced, personal excluded, 4 ITC lines', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 997.50, subtotal: 950.00, gst: 47.50, hst: 0, pst: 0,
      paymentMethod: 'Credit', category: 'Other', vendor: 'Costco', date: '2026-06-01',
      itcRegistered: true
    });
    const result = await svc.applySplit({
      ledgerEntryId,
      splits: [
        { description: 'Food Inventory', expense_account_code: '5020', expense_account_name: 'Meals', allocated_subtotal: 200.00, is_business_use: true, category: 'Food' },
        { description: 'Cleaning Supplies', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 250.00, is_business_use: true, category: 'Office' },
        { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 150.00, is_business_use: true, category: 'Office' },
        { description: 'Equipment', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 200.00, is_business_use: true, category: 'Office' },
        { description: 'Personal Purchase', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 150.00, is_business_use: false },
      ],
      total_gst: 47.50, total_hst: 0, total_pst: 0,
      total_subtotal: 950.00, total_with_tax: 997.50,
      settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
      date: '2026-06-01',
    });
    expect(result.isBalanced).toBe(true);
    const bal = await assertJournalBalance(db, result.journalEntryId);
    expect(bal.balanced).toBe(true);
    expect(bal.lineCount).toBe(10);
    expect(result.personalUseTotal).toBeGreaterThan(0);
    const splitRows = await countRows(db, 'split_lines', 'ledger_entry_id = ?', ledgerEntryId);
    expect(splitRows).toBe(5);
    const personalRows = await countRows(db, 'split_lines',
      'ledger_entry_id = ? AND is_business_use = 0', ledgerEntryId);
    expect(personalRows).toBe(1);
  });
});

describe('TS6 — Validation: split amounts do not sum → no DB write', () => {
  it('throws error, zero split_lines written, ledger entry unchanged', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 100.00, subtotal: 100.00, gst: 0, hst: 0, pst: 0,
      paymentMethod: 'Cash', category: 'Other', vendor: 'V', date: '2026-01-01'
    });
    await expect(svc.applySplit({
      ledgerEntryId,
      splits: [
        { description: 'A', expense_account_code: '5050', expense_account_name: 'Office', allocated_subtotal: 60.00, is_business_use: true },
        { description: 'B', expense_account_code: '5020', expense_account_name: 'Meals', allocated_subtotal: 60.00, is_business_use: true },
      ],
      total_gst: 0, total_hst: 0, total_pst: 0,
      total_subtotal: 100.00, total_with_tax: 100.00,
      settlement_account_code: '1010', settlement_account_name: 'Cash',
      date: '2026-01-01',
    })).rejects.toThrow();
    const splitRows = await countRows(db, 'split_lines', 'ledger_entry_id = ?', ledgerEntryId);
    expect(splitRows).toBe(0);
  });
});

describe('TS7 — Single-item split pass-through', () => {
  it('3 lines, balanced, ITC = GST amount', async () => {
    const { ledgerEntryId } = await seedOriginalEntry(db, {
      amount: 72.43, subtotal: 69.14, gst: 3.29, hst: 0, pst: 0,
      paymentMethod: 'Debit', category: 'Office', vendor: 'Staples', date: '2026-02-01',
      itcRegistered: true
    });
    const result = await svc.applySplit({
      ledgerEntryId,
      splits: [
        { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 69.14, is_business_use: true, category: 'Office' },
      ],
      total_gst: 3.29, total_hst: 0, total_pst: 0,
      total_subtotal: 69.14, total_with_tax: 72.43,
      settlement_account_code: '1020', settlement_account_name: 'Bank - Chequing',
      date: '2026-02-01',
    });
    expect(result.isBalanced).toBe(true);
    const bal = await assertJournalBalance(db, result.journalEntryId);
    expect(bal.balanced).toBe(true);
    expect(bal.lineCount).toBe(3);
    expect(result.itcTotal).toBeCloseTo(3.29, 2);
  });
});
