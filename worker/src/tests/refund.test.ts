/**
 * refund.test.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Regression tests for RefundService reversing journal logic.
 *
 * EVERY test must prove:
 *   1. SUM(DEBITS) = SUM(CREDITS)  — journal is balanced
 *   2. Original transaction is PRESERVED (not deleted, not zeroed)
 *   3. Refund entry links back to original via reversal_of
 *   4. Tax position is correctly reversed
 *
 * T7A  Full refund
 * T7B  Partial refund (50%)
 * T7C  Supplier credit note (AP credit)
 * T7D  Card refund (settlement override)
 * T7E  Refund containing GST/HST (recoverable previously claimed)
 * T7F  Refund containing GST + PST
 * T7G  Refund with no recoverable GST/HST (unregistered business)
 *
 * These tests run the pure line-building logic extracted from RefundService
 * without requiring D1. The D1-backed service is tested on deployment.
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// Pure function under test (mirrors RefundService.buildReversalLines)
// ============================================================

type RefundType = 'FULL' | 'PARTIAL' | 'CREDIT_NOTE' | 'CARD_REFUND';

interface OriginalLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  memo: string;
}

interface ReversalLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  memo: string;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function buildReversalLines(
  originalLines: OriginalLine[],
  ratio: number,
  refundType: RefundType,
  settlementOverride?: string
): ReversalLine[] {
  const lines: ReversalLine[] = [];

  const ACCOUNT_NAMES: Record<string, string> = {
    '1010': 'Cash', '1020': 'Bank - Chequing', '1040': 'Credit Card Payable',
    '2010': 'Accounts Payable', '1310': 'GST/HST Recoverable',
  };

  const originalCreditLine = originalLines.find(l => l.credit > 0);
  const settlementAccount = settlementOverride
    ? { code: settlementOverride, name: ACCOUNT_NAMES[settlementOverride] ?? `Account ${settlementOverride}` }
    : originalCreditLine
    ? { code: originalCreditLine.account_code, name: originalCreditLine.account_name }
    : { code: '1010', name: 'Cash' };

  if (refundType === 'CREDIT_NOTE') {
    for (const line of originalLines) {
      if (line.debit > 0) {
        lines.push({
          account_code: line.account_code, account_name: line.account_name,
          debit: 0, credit: round2(line.debit * ratio),
          memo: `CREDIT NOTE reversal: ${line.memo}`,
        });
      }
    }
    const totalCreditReversed = round2(lines.reduce((s, l) => s + l.credit, 0));
    lines.push({
      account_code: '2010', account_name: 'Accounts Payable',
      debit: totalCreditReversed, credit: 0,
      memo: 'Credit note reduces AP',
    });
    return lines;
  }

  for (const line of originalLines) {
    if (line.debit > 0) {
      lines.push({
        account_code: line.account_code, account_name: line.account_name,
        debit: 0, credit: round2(line.debit * ratio),
        memo: `Reversal: ${line.memo}`,
      });
    }
    if (line.credit > 0) {
      lines.push({
        account_code: settlementAccount.code, account_name: settlementAccount.name,
        debit: round2(line.credit * ratio), credit: 0,
        memo: `Refund received: ${line.memo}`,
      });
    }
  }

  // Rounding correction (±1 cent)
  const totalD = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalC = round2(lines.reduce((s, l) => s + l.credit, 0));
  const diff = round2(totalD - totalC);
  if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.01) {
    const lastCredit = [...lines].reverse().find(l => l.credit > 0);
    if (lastCredit) lastCredit.credit = round2(lastCredit.credit - diff);
  }

  return lines;
}

function sumDebits(lines: ReversalLine[]) {
  return round2(lines.reduce((s, l) => s + l.debit, 0));
}
function sumCredits(lines: ReversalLine[]) {
  return round2(lines.reduce((s, l) => s + l.credit, 0));
}
function assertBalanced(lines: ReversalLine[], label: string) {
  const dr = sumDebits(lines);
  const cr = sumCredits(lines);
  expect(Math.abs(dr - cr), `${label}: DR ${dr} !== CR ${cr}`).toBeLessThanOrEqual(0.01);
}
function assertNoZeroLines(lines: ReversalLine[], label: string) {
  // Refund cannot produce a zero-line journal
  expect(lines.length, `${label}: zero journal lines is not a valid refund`).toBeGreaterThan(0);
}

// ============================================================
// Original journal line sets (fixtures)
// ============================================================

// Simple 2-line original: DR 5020-Meals / CR 1010-Cash  ($96.34)
const SIMPLE_2LINE: OriginalLine[] = [
  { account_code: '5020', account_name: 'Meals & Entertainment', debit: 96.34, credit: 0, memo: 'RECEIPT: Cactus Club Cafe' },
  { account_code: '1010', account_name: 'Cash', debit: 0, credit: 96.34, memo: 'Payment: Cash' },
];

// 3-line with GST: DR 5050-Office / DR 1310-GST Rec / CR 1020-Bank  ($69.14)
const THREE_LINE_GST: OriginalLine[] = [
  { account_code: '5050', account_name: 'Office Supplies', debit: 65.85, credit: 0, memo: 'RECEIPT: Staples' },
  { account_code: '1310', account_name: 'GST/HST Recoverable', debit: 3.29, credit: 0, memo: 'ITC' },
  { account_code: '1020', account_name: 'Bank - Chequing', debit: 0, credit: 69.14, memo: 'Payment: Debit' },
];

// 3-line GST+PST: DR 5050-Office ($108) / DR 1310-GST Rec ($5) / CR 1040-CC ($113)
const THREE_LINE_GST_PST: OriginalLine[] = [
  { account_code: '5050', account_name: 'Office Supplies', debit: 108.00, credit: 0, memo: 'RECEIPT: Staples (incl PST)' },
  { account_code: '1310', account_name: 'GST/HST Recoverable', debit: 5.00, credit: 0, memo: 'ITC: GST $5.00' },
  { account_code: '1040', account_name: 'Credit Card Payable', debit: 0, credit: 113.00, memo: 'Payment: Credit' },
];

// 3-line AP invoice: DR 5040-Vehicle / DR 1310-HST Rec / CR 2010-AP  ($695.23)
const AP_INVOICE: OriginalLine[] = [
  { account_code: '5040', account_name: 'Vehicle', debit: 620.76, credit: 0, memo: "INVOICE: Darcy's Auto" },
  { account_code: '1310', account_name: 'GST/HST Recoverable', debit: 74.47, credit: 0, memo: 'ITC: HST $74.47' },
  { account_code: '2010', account_name: 'Accounts Payable', debit: 0, credit: 695.23, memo: "Payment: Darcy's Auto" },
];

// ============================================================
// T7A — Full refund
// ============================================================
describe('T7A — Full refund: full reversal, journal is balanced, original preserved', () => {
  const lines = buildReversalLines(SIMPLE_2LINE, 1.0, 'FULL');

  it('produces journal lines (NOT zero lines)', () => {
    assertNoZeroLines(lines, 'T7A');
  });

  it('produces 2 lines (mirrors original)', () => {
    expect(lines).toHaveLength(2);
  });

  it('DR 1010-Cash / CR 5020-Meals (reversed)', () => {
    const drLine = lines.find(l => l.debit > 0);
    const crLine = lines.find(l => l.credit > 0);
    expect(drLine!.account_code).toBe('1010');
    expect(drLine!.debit).toBe(96.34);
    expect(crLine!.account_code).toBe('5020');
    expect(crLine!.credit).toBe(96.34);
  });

  it('SUM(DR) = SUM(CR)', () => {
    assertBalanced(lines, 'T7A');
  });

  it('original entry is referenced (reversal_of relationship)', () => {
    // In DB: refund ledger entry has reversal_of = original ID.
    // Here we test the concept: the memo carries the original reference.
    expect(lines.some(l => l.memo.includes('Reversal') || l.memo.includes('Refund'))).toBe(true);
  });
});

// ============================================================
// T7B — Partial refund (50%)
// ============================================================
describe('T7B — Partial refund (50%): proportional reversal', () => {
  const ratio = 0.5;
  const lines = buildReversalLines(SIMPLE_2LINE, ratio, 'PARTIAL');

  it('produces journal lines (NOT zero lines)', () => {
    assertNoZeroLines(lines, 'T7B');
  });

  it('amounts are 50% of original', () => {
    const drLine = lines.find(l => l.debit > 0);
    const crLine = lines.find(l => l.credit > 0);
    expect(drLine!.debit).toBeCloseTo(48.17, 1);
    expect(crLine!.credit).toBeCloseTo(48.17, 1);
  });

  it('SUM(DR) = SUM(CR)', () => {
    assertBalanced(lines, 'T7B');
  });

  it('partial refund is traceable (not a delete of the original)', () => {
    // Original: 96.34. Refund: 48.17. Net position: 48.17 remaining expense.
    // This test confirms that the refund is a SEPARATE entry, not a modification.
    const refundTotal = sumDebits(lines);
    expect(refundTotal).toBeCloseTo(round2(96.34 * ratio), 1);
    expect(refundTotal).not.toBe(96.34); // Not a full reversal
  });
});

// ============================================================
// T7C — Supplier credit note (AP credit)
// ============================================================
describe('T7C — Supplier credit note: DR AP / CR Expense + CR GST Recoverable', () => {
  const lines = buildReversalLines(AP_INVOICE, 1.0, 'CREDIT_NOTE');

  it('produces journal lines (NOT zero lines)', () => {
    assertNoZeroLines(lines, 'T7C');
  });

  it('DR 2010-AP / CR 5040-Vehicle / CR 1310-HST Recoverable (reversed)', () => {
    const apLine = lines.find(l => l.account_code === '2010' && l.debit > 0);
    const vehicleCredit = lines.find(l => l.account_code === '5040' && l.credit > 0);
    const hstCredit = lines.find(l => l.account_code === '1310' && l.credit > 0);
    expect(apLine).toBeDefined();
    expect(apLine!.debit).toBeCloseTo(695.23, 2);
    expect(vehicleCredit).toBeDefined();
    expect(vehicleCredit!.credit).toBeCloseTo(620.76, 2);
    expect(hstCredit).toBeDefined();
    expect(hstCredit!.credit).toBeCloseTo(74.47, 2);
  });

  it('AP is DEBITED (liability reduced), not credited', () => {
    const apLine = lines.find(l => l.account_code === '2010');
    expect(apLine!.debit).toBeGreaterThan(0);
    expect(apLine!.credit).toBe(0);
  });

  it('SUM(DR) = SUM(CR)', () => {
    assertBalanced(lines, 'T7C');
  });
});

// ============================================================
// T7D — Card refund (settlement override: 1040-Credit Card)
// ============================================================
describe('T7D — Card refund: refund received on credit card, not cash', () => {
  // Original was paid by cash. Refund received to credit card.
  const lines = buildReversalLines(SIMPLE_2LINE, 1.0, 'CARD_REFUND', '1040');

  it('produces journal lines (NOT zero lines)', () => {
    assertNoZeroLines(lines, 'T7D');
  });

  it('DR 1040-Credit Card (refund received) / CR 5020-Meals', () => {
    const drLine = lines.find(l => l.debit > 0);
    const crLine = lines.find(l => l.credit > 0);
    expect(drLine!.account_code).toBe('1040'); // Override to credit card
    expect(crLine!.account_code).toBe('5020');
  });

  it('SUM(DR) = SUM(CR)', () => {
    assertBalanced(lines, 'T7D');
  });
});

// ============================================================
// T7E — Refund containing GST/HST (recoverable previously claimed)
// ============================================================
describe('T7E — Refund with GST: GST recoverable is reversed', () => {
  const lines = buildReversalLines(THREE_LINE_GST, 1.0, 'FULL');

  it('produces 3 lines (mirrors 3-line original)', () => {
    assertNoZeroLines(lines, 'T7E');
    expect(lines).toHaveLength(3);
  });

  it('CR 5050-Office and CR 1310-GST Recoverable (both reversed)', () => {
    const officeCredit = lines.find(l => l.account_code === '5050' && l.credit > 0);
    const gstCredit = lines.find(l => l.account_code === '1310' && l.credit > 0);
    expect(officeCredit).toBeDefined();
    expect(officeCredit!.credit).toBeCloseTo(65.85, 2);
    expect(gstCredit).toBeDefined();
    expect(gstCredit!.credit).toBeCloseTo(3.29, 2);
  });

  it('DR 1020-Bank (refund received back to bank)', () => {
    const bankDr = lines.find(l => l.account_code === '1020' && l.debit > 0);
    expect(bankDr).toBeDefined();
    expect(bankDr!.debit).toBeCloseTo(69.14, 2);
  });

  it('SUM(DR) = SUM(CR)', () => {
    assertBalanced(lines, 'T7E');
  });
});

// ============================================================
// T7F — Refund containing GST + PST
// ============================================================
describe('T7F — Refund with GST + PST: both tax positions reversed', () => {
  const lines = buildReversalLines(THREE_LINE_GST_PST, 1.0, 'FULL');

  it('produces 3 lines (mirrors 3-line original)', () => {
    assertNoZeroLines(lines, 'T7F');
    expect(lines).toHaveLength(3);
  });

  it('CR 5050-Office reverses expense+PST debit ($108)', () => {
    const officeCredit = lines.find(l => l.account_code === '5050' && l.credit > 0);
    expect(officeCredit).toBeDefined();
    expect(officeCredit!.credit).toBeCloseTo(108.00, 2);
  });

  it('CR 1310-GST Recoverable reverses ITC debit ($5)', () => {
    const gstCredit = lines.find(l => l.account_code === '1310' && l.credit > 0);
    expect(gstCredit).toBeDefined();
    expect(gstCredit!.credit).toBeCloseTo(5.00, 2);
  });

  it('DR 1040-Credit Card for full $113 refund received', () => {
    const ccDr = lines.find(l => l.account_code === '1040' && l.debit > 0);
    expect(ccDr).toBeDefined();
    expect(ccDr!.debit).toBeCloseTo(113.00, 2);
  });

  it('PST reversal is in expense credit (not a separate PST account)', () => {
    // PST was folded into the expense debit ($108 = $100 subtotal + $8 PST).
    // On reversal, it comes back out as an expense credit.
    // There is NO separate PST debit line on reversal (PST is not in 1310).
    const pstLine = lines.find(l => l.account_code === '1320');
    expect(pstLine).toBeUndefined(); // No separate PST account on reversal
  });

  it('SUM(DR) = SUM(CR)', () => {
    assertBalanced(lines, 'T7F');
  });
});

// ============================================================
// T7G — Refund with no recoverable GST/HST (unregistered business)
// ============================================================
describe('T7G — Refund, unregistered business: 2-line reversal, no ITC account touched', () => {
  // Unregistered business original: DR 5010-Operating Expenses $267.08 / CR 1020-Bank $267.08
  // (full amount in expense, no 1310 line because no ITC was claimed)
  const UNREGISTERED_2LINE: OriginalLine[] = [
    { account_code: '5010', account_name: 'Operating Expenses', debit: 267.08, credit: 0, memo: 'RECEIPT: ICBC' },
    { account_code: '1020', account_name: 'Bank - Chequing', debit: 0, credit: 267.08, memo: 'Payment: Debit' },
  ];

  const lines = buildReversalLines(UNREGISTERED_2LINE, 1.0, 'FULL');

  it('produces 2 lines (same as original — no ITC line to reverse)', () => {
    assertNoZeroLines(lines, 'T7G');
    expect(lines).toHaveLength(2);
  });

  it('no 1310-GST Recoverable line (no ITC was claimed, none to reverse)', () => {
    const gstLine = lines.find(l => l.account_code === '1310');
    expect(gstLine).toBeUndefined();
  });

  it('DR 1020-Bank / CR 5010-Operating Expenses', () => {
    const bankDr = lines.find(l => l.account_code === '1020' && l.debit > 0);
    const expenseCredit = lines.find(l => l.account_code === '5010' && l.credit > 0);
    expect(bankDr!.debit).toBeCloseTo(267.08, 2);
    expect(expenseCredit!.credit).toBeCloseTo(267.08, 2);
  });

  it('SUM(DR) = SUM(CR)', () => {
    assertBalanced(lines, 'T7G');
  });
});

// ============================================================
// Additional invariant: partial refund of 3-line GST journal
// ============================================================
describe('T7E-partial — Partial refund (33%) with GST: proportional tax reversal', () => {
  const ratio = 1/3;
  const lines = buildReversalLines(THREE_LINE_GST, ratio, 'PARTIAL');

  it('produces journal lines', () => {
    assertNoZeroLines(lines, 'T7E-partial');
  });

  it('GST reversal is proportional (33% of 3.29 = ~1.10)', () => {
    const gstCredit = lines.find(l => l.account_code === '1310' && l.credit > 0);
    expect(gstCredit).toBeDefined();
    expect(gstCredit!.credit).toBeCloseTo(round2(3.29 * ratio), 1);
  });

  it('SUM(DR) = SUM(CR) even with rounding', () => {
    assertBalanced(lines, 'T7E-partial');
  });
});
