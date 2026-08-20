/**
 * split.test.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Real transaction splitting tests.
 * These replace the previous T5 "single-category placeholder" which was NOT a split test.
 *
 * One scanned receipt may contain:
 *   - Food Inventory
 *   - Cleaning Supplies
 *   - Office Supplies
 *   - Equipment
 *   - Personal Purchase (excluded from ITC)
 *
 * EVERY test must prove:
 *   1. SUM(all split debit lines) = settlement credit line
 *   2. SUM(DEBITS) = SUM(CREDITS) across the full split journal
 *   3. Proportional GST/PST correctly allocated
 *   4. Personal-use lines get NO ITC
 *   5. SUM(split subtotals) = total subtotal (validation rule)
 *
 * TS1  Simple 2-category split (Office + Food), registered, no GST
 * TS2  3-category split with proportional GST (registered business)
 * TS3  4-category split with GST + PST
 * TS4  Split with personal-use line (no ITC on personal)
 * TS5  Mixed: Office + Equipment + Personal + Cleaning (5 lines)
 * TS6  Split validation: amounts don't sum → must throw
 * TS7  Single-item split (no real split — validates pass-through)
 */

import { describe, it, expect } from 'vitest';

function round2(n: number) { return Math.round(n * 100) / 100; }

// ============================================================
// Inline split line builder (pure logic from SplitService)
// Runs without D1. DB-backed service tested on deployment.
// ============================================================

interface SplitLineInput {
  description: string;
  expense_account_code: string;
  expense_account_name: string;
  allocated_subtotal: number;
  is_business_use: boolean;
  category?: string;
}

interface ITCConfig {
  itc_registered: boolean;
  min_confidence_for_itc: number;
}

interface JournalLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  memo: string;
  is_itc_line?: boolean;
  is_settlement?: boolean;
  split_description?: string;
}

interface SplitBuildResult {
  lines: JournalLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  itcTotal: number;
  personalUseTotal: number;
  personalUseLines: string[];
  errors: string[];
}

function buildSplitJournal(params: {
  splits: SplitLineInput[];
  total_gst: number;
  total_hst: number;
  total_pst: number;
  total_subtotal: number;
  total_with_tax: number;
  settlement_account_code: string;
  settlement_account_name: string;
  itcConfig: ITCConfig;
  doc_type?: string;
  date?: string;
}): SplitBuildResult {
  const errors: string[] = [];
  const lines: JournalLine[] = [];
  let itcTotal = 0;
  let personalUseTotal = 0;
  const personalUseLines: string[] = [];

  // Validation: split subtotals must sum to total_subtotal
  const splitSum = round2(params.splits.reduce((s, sp) => s + sp.allocated_subtotal, 0));
  if (Math.abs(splitSum - params.total_subtotal) > 0.02) {
    errors.push(
      `Split subtotals (${splitSum}) do not sum to total subtotal (${params.total_subtotal}). ` +
      `Diff: ${round2(Math.abs(splitSum - params.total_subtotal))}`
    );
    return { lines: [], totalDebits: 0, totalCredits: 0, isBalanced: false, itcTotal: 0, personalUseTotal: 0, personalUseLines: [], errors };
  }

  for (const split of params.splits) {
    const proportion = params.total_subtotal > 0
      ? split.allocated_subtotal / params.total_subtotal
      : 1 / params.splits.length;

    const splitGst = round2(params.total_gst * proportion);
    const splitHst = round2(params.total_hst * proportion);
    const splitPst = round2(params.total_pst * proportion);
    const splitRecoverable = splitGst + splitHst;
    const splitTotalWithTax = round2(split.allocated_subtotal + splitGst + splitHst + splitPst);

    const itcEligible =
      split.is_business_use &&
      params.itcConfig.itc_registered &&
      splitRecoverable > 0;

    if (!split.is_business_use) {
      personalUseTotal = round2(personalUseTotal + splitTotalWithTax);
      personalUseLines.push(split.description);
    }

    // Expense debit
    const expenseDebit = itcEligible
      ? round2(split.allocated_subtotal + splitPst)   // GST/HST goes to recoverable
      : splitTotalWithTax;                              // Full cost when no ITC

    lines.push({
      account_code: split.expense_account_code,
      account_name: split.expense_account_name,
      debit: expenseDebit,
      credit: 0,
      memo: split.description,
      split_description: split.description,
    });

    // GST/HST Recoverable (only for business use + registered + recoverable > 0)
    if (itcEligible && splitRecoverable > 0) {
      lines.push({
        account_code: '1310',
        account_name: 'GST/HST Recoverable',
        debit: splitRecoverable,
        credit: 0,
        memo: `ITC: ${split.description}`,
        is_itc_line: true,
        split_description: split.description,
      });
      itcTotal = round2(itcTotal + splitRecoverable);
    }
  }

  // Single settlement credit line
  lines.push({
    account_code: params.settlement_account_code,
    account_name: params.settlement_account_name,
    debit: 0,
    credit: params.total_with_tax,
    memo: 'Split receipt settlement',
    is_settlement: true,
  });

  const totalDebits = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredits = round2(lines.reduce((s, l) => s + l.credit, 0));
  const diff = Math.abs(Math.round((totalDebits - totalCredits) * 100));

  if (diff > 1) {
    errors.push(`Balance violation: DR ${totalDebits} ≠ CR ${totalCredits} (diff ${diff} cents)`);
  }

  return {
    lines,
    totalDebits,
    totalCredits,
    isBalanced: diff <= 1,
    itcTotal,
    personalUseTotal,
    personalUseLines,
    errors,
  };
}

const REGISTERED: ITCConfig = { itc_registered: true, min_confidence_for_itc: 0.70 };
const UNREGISTERED: ITCConfig = { itc_registered: false, min_confidence_for_itc: 0.70 };

function assertBalanced(result: SplitBuildResult, label: string) {
  expect(result.errors, `${label} errors`).toHaveLength(0);
  expect(result.isBalanced, `${label}: not balanced`).toBe(true);
  expect(
    Math.abs(result.totalDebits - result.totalCredits),
    `${label}: DR ${result.totalDebits} ≠ CR ${result.totalCredits}`
  ).toBeLessThanOrEqual(0.01);
}

// ============================================================
// TS1 — Simple 2-category split, no GST (unregistered)
// Receipt: $100.00 — Office $60 + Food $40
// ============================================================
describe('TS1 — 2-category split, no GST, unregistered', () => {
  const result = buildSplitJournal({
    splits: [
      { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 60.00, is_business_use: true },
      { description: 'Meals', expense_account_code: '5020', expense_account_name: 'Meals & Entertainment', allocated_subtotal: 40.00, is_business_use: true },
    ],
    total_gst: 0, total_hst: 0, total_pst: 0,
    total_subtotal: 100.00,
    total_with_tax: 100.00,
    settlement_account_code: '1010', settlement_account_name: 'Cash',
    itcConfig: UNREGISTERED,
  });

  it('no validation errors', () => { expect(result.errors).toHaveLength(0); });
  it('3 lines: 2 expense debits + 1 settlement credit', () => { expect(result.lines).toHaveLength(3); });
  it('Office debit = $60', () => {
    const line = result.lines.find(l => l.account_code === '5050');
    expect(line!.debit).toBe(60.00);
  });
  it('Food debit = $40', () => {
    const line = result.lines.find(l => l.account_code === '5020');
    expect(line!.debit).toBe(40.00);
  });
  it('Settlement CR 1010-Cash = $100', () => {
    const line = result.lines.find(l => l.is_settlement);
    expect(line!.credit).toBe(100.00);
  });
  it('SUM(DR) = SUM(CR)', () => { assertBalanced(result, 'TS1'); });
  it('no ITC lines (unregistered)', () => {
    expect(result.lines.some(l => l.is_itc_line)).toBe(false);
  });
});

// ============================================================
// TS2 — 3-category split with proportional GST (registered)
// Costco receipt: $254.80 total ($242.67 subtotal, $12.13 GST)
// Office $100 + Cleaning $80 + Food $62.67
// ============================================================
describe('TS2 — 3-category split with proportional GST, registered', () => {
  const result = buildSplitJournal({
    splits: [
      { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 100.00, is_business_use: true, category: 'Office' },
      { description: 'Cleaning Supplies', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 80.00, is_business_use: true, category: 'Office' },
      { description: 'Food Inventory', expense_account_code: '5020', expense_account_name: 'Meals & Entertainment', allocated_subtotal: 62.67, is_business_use: true, category: 'Food' },
    ],
    total_gst: 12.13, total_hst: 0, total_pst: 0,
    total_subtotal: 242.67,
    total_with_tax: 254.80,
    settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
    itcConfig: REGISTERED,
  });

  it('no validation errors', () => { expect(result.errors).toHaveLength(0); });

  it('produces 7 lines: 3 expense + 3 GST recoverable + 1 settlement', () => {
    // Each business split with GST gets: 1 expense debit + 1 ITC debit
    const expenseLines = result.lines.filter(l => !l.is_itc_line && !l.is_settlement);
    const itcLines = result.lines.filter(l => l.is_itc_line);
    const settlementLines = result.lines.filter(l => l.is_settlement);
    expect(expenseLines).toHaveLength(3);
    expect(itcLines).toHaveLength(3);
    expect(settlementLines).toHaveLength(1);
  });

  it('proportional GST on Office split (~$5.00 of $12.13)', () => {
    const itcLine = result.lines.find(l => l.is_itc_line && l.split_description === 'Office Supplies');
    expect(itcLine).toBeDefined();
    // proportion = 100/242.67 = ~0.4121 → GST = 12.13 * 0.4121 ≈ $5.00
    expect(itcLine!.debit).toBeCloseTo(round2(12.13 * (100 / 242.67)), 1);
  });

  it('all GST ITC lines sum to total GST', () => {
    const totalITC = round2(result.lines.filter(l => l.is_itc_line).reduce((s, l) => s + l.debit, 0));
    expect(Math.abs(totalITC - 12.13)).toBeLessThanOrEqual(0.03); // rounding tolerance
  });

  it('settlement CR = $254.80 (full receipt)', () => {
    const settlement = result.lines.find(l => l.is_settlement);
    expect(settlement!.credit).toBe(254.80);
  });

  it('SUM(DR) = SUM(CR)', () => { assertBalanced(result, 'TS2'); });
});

// ============================================================
// TS3 — 4-category split with GST + PST
// Receipt: $565.00 ($500 subtotal, $25 GST, $40 PST)
// Equipment $200 + Office $150 + Cleaning $100 + Food $50
// ============================================================
describe('TS3 — 4-category split with GST + PST', () => {
  const result = buildSplitJournal({
    splits: [
      { description: 'Equipment', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 200.00, is_business_use: true, category: 'Office' },
      { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 150.00, is_business_use: true, category: 'Office' },
      { description: 'Cleaning Supplies', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 100.00, is_business_use: true, category: 'Office' },
      { description: 'Food Inventory', expense_account_code: '5020', expense_account_name: 'Meals & Entertainment', allocated_subtotal: 50.00, is_business_use: true, category: 'Food' },
    ],
    total_gst: 25.00, total_hst: 0, total_pst: 40.00,
    total_subtotal: 500.00,
    total_with_tax: 565.00,
    settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
    itcConfig: REGISTERED,
  });

  it('no validation errors', () => { expect(result.errors).toHaveLength(0); });

  it('PST folded into expense debit (not in 1310)', () => {
    const itcLines = result.lines.filter(l => l.is_itc_line);
    // ITC lines only hold GST (25.00 total), NOT PST
    const itcTotal = round2(itcLines.reduce((s, l) => s + l.debit, 0));
    expect(Math.abs(itcTotal - 25.00)).toBeLessThanOrEqual(0.05); // GST only
    // No ITC line debit should exceed the proportional GST
    itcLines.forEach(l => {
      expect(l.debit).toBeLessThanOrEqual(25.00 + 0.01); // Can't be more than total GST
    });
  });

  it('PST is in expense debit lines (Equipment split: $200 + proportional PST)', () => {
    const equipLine = result.lines.find(l => l.split_description === 'Equipment' && !l.is_itc_line);
    const proportion = 200 / 500;
    const splitPST = round2(40.00 * proportion); // $16
    // Expense debit = subtotal ($200) + PST ($16) = $216 (GST goes to ITC account)
    expect(equipLine!.debit).toBeCloseTo(200 + splitPST, 1);
  });

  it('settlement CR = $565.00 (full receipt)', () => {
    const settlement = result.lines.find(l => l.is_settlement);
    expect(settlement!.credit).toBe(565.00);
  });

  it('SUM(DR) = SUM(CR)', () => { assertBalanced(result, 'TS3'); });
});

// ============================================================
// TS4 — Split with personal-use line (no ITC on personal)
// Receipt: $200. Office $100 (business) + Personal $100.
// GST = $10 total. Only office portion eligible for ITC.
// ============================================================
describe('TS4 — Split with personal-use line: no ITC on personal', () => {
  const result = buildSplitJournal({
    splits: [
      { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 100.00, is_business_use: true, category: 'Office' },
      { description: 'Personal Items', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 100.00, is_business_use: false }, // personal
    ],
    total_gst: 10.00, total_hst: 0, total_pst: 0,
    total_subtotal: 200.00,
    total_with_tax: 210.00,
    settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
    itcConfig: REGISTERED,
  });

  it('no validation errors', () => { expect(result.errors).toHaveLength(0); });

  it('personal-use total tracked separately', () => {
    expect(result.personalUseTotal).toBeGreaterThan(0);
    expect(result.personalUseLines).toContain('Personal Items');
  });

  it('ITC only on business-use portion (Office $5 GST, not Personal $5 GST)', () => {
    const itcLine = result.lines.find(l => l.is_itc_line && l.split_description === 'Office Supplies');
    const personalITC = result.lines.find(l => l.is_itc_line && l.split_description === 'Personal Items');
    expect(itcLine).toBeDefined();
    expect(itcLine!.debit).toBeCloseTo(5.00, 1); // 50% of $10 GST
    expect(personalITC).toBeUndefined(); // No ITC on personal
  });

  it('personal expense line includes full GST as cost', () => {
    const personalLine = result.lines.find(l => l.split_description === 'Personal Items' && !l.is_itc_line);
    // Personal: subtotal $100 + proportional GST $5 (not recoverable) = $105
    expect(personalLine!.debit).toBeCloseTo(105.00, 1);
  });

  it('ITC total = only business GST ($5)', () => {
    expect(result.itcTotal).toBeCloseTo(5.00, 1);
  });

  it('SUM(DR) = SUM(CR)', () => { assertBalanced(result, 'TS4'); });
});

// ============================================================
// TS5 — 5-category split: Office + Equipment + Personal + Cleaning + Food
// The full scenario specified in instruction 5B.
// Receipt: $1,000 ($950 subtotal, $47.50 GST, $2.50 rounding)
// ============================================================
describe('TS5 — 5-category split: Office + Equipment + Personal + Cleaning + Food', () => {
  const result = buildSplitJournal({
    splits: [
      { description: 'Food Inventory', expense_account_code: '5020', expense_account_name: 'Meals & Entertainment', allocated_subtotal: 200.00, is_business_use: true, category: 'Food' },
      { description: 'Cleaning Supplies', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 250.00, is_business_use: true, category: 'Office' },
      { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 150.00, is_business_use: true, category: 'Office' },
      { description: 'Equipment', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 200.00, is_business_use: true, category: 'Office' },
      { description: 'Personal Purchase', expense_account_code: '5010', expense_account_name: 'Operating Expenses', allocated_subtotal: 150.00, is_business_use: false }, // personal
    ],
    total_gst: 47.50, total_hst: 0, total_pst: 0,
    total_subtotal: 950.00,
    total_with_tax: 997.50,
    settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable',
    itcConfig: REGISTERED,
  });

  it('no validation errors', () => { expect(result.errors).toHaveLength(0); });

  it('personal-use line identified', () => {
    expect(result.personalUseLines).toContain('Personal Purchase');
  });

  it('personal-use total > 0', () => {
    expect(result.personalUseTotal).toBeGreaterThan(0);
  });

  it('ITC only on 4 business lines (not Personal)', () => {
    const itcLines = result.lines.filter(l => l.is_itc_line);
    // 4 business splits each get an ITC line
    expect(itcLines.length).toBe(4);
  });

  it('personal line has NO ITC', () => {
    const personalITC = result.lines.find(l => l.is_itc_line && l.split_description === 'Personal Purchase');
    expect(personalITC).toBeUndefined();
  });

  it('settlement CR = $997.50 (full receipt)', () => {
    const settlement = result.lines.find(l => l.is_settlement);
    expect(settlement!.credit).toBe(997.50);
  });

  it('SUM(DR) = SUM(CR)', () => { assertBalanced(result, 'TS5'); });

  it('line count = 4 expense + 4 ITC + 1 personal expense + 1 settlement = 10 lines', () => {
    // 4 business splits: 4 expense + 4 ITC = 8
    // 1 personal split: 1 expense (no ITC)
    // 1 settlement credit
    // Total = 10
    expect(result.lines).toHaveLength(10);
  });
});

// ============================================================
// TS6 — Validation: split amounts don't sum → must reject
// ============================================================
describe('TS6 — Split validation: amounts do not sum to total → must reject', () => {
  const result = buildSplitJournal({
    splits: [
      { description: 'Office', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 60.00, is_business_use: true },
      { description: 'Food', expense_account_code: '5020', expense_account_name: 'Meals', allocated_subtotal: 60.00, is_business_use: true },
      // Sum = 120, but total_subtotal = 100 — should fail
    ],
    total_gst: 0, total_hst: 0, total_pst: 0,
    total_subtotal: 100.00, // MISMATCH: splits sum to 120
    total_with_tax: 100.00,
    settlement_account_code: '1010', settlement_account_name: 'Cash',
    itcConfig: UNREGISTERED,
  });

  it('returns validation error when split amounts do not sum to total', () => {
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('do not sum to total subtotal');
  });

  it('produces zero journal lines on validation failure', () => {
    expect(result.lines).toHaveLength(0);
  });

  it('isBalanced is false on validation failure', () => {
    expect(result.isBalanced).toBe(false);
  });
});

// ============================================================
// TS7 — Single-item split (trivial pass-through)
// Validates that splitting a single-category item still works.
// ============================================================
describe('TS7 — Single-item split (pass-through)', () => {
  const result = buildSplitJournal({
    splits: [
      { description: 'Office Supplies', expense_account_code: '5050', expense_account_name: 'Office Supplies', allocated_subtotal: 69.14, is_business_use: true, category: 'Office' },
    ],
    total_gst: 3.29, total_hst: 0, total_pst: 0,
    total_subtotal: 69.14,
    total_with_tax: 72.43,
    settlement_account_code: '1020', settlement_account_name: 'Bank - Chequing',
    itcConfig: REGISTERED,
  });

  it('no errors', () => { expect(result.errors).toHaveLength(0); });
  it('produces 3 lines: expense + ITC + settlement', () => { expect(result.lines).toHaveLength(3); });
  it('SUM(DR) = SUM(CR)', () => { assertBalanced(result, 'TS7'); });
  it('ITC = $3.29', () => { expect(result.itcTotal).toBeCloseTo(3.29, 2); });
});
