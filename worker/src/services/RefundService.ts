/**
 * RefundService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Proper refund and credit-note accounting.
 *
 * HARD RULES:
 *   REFUND != DELETE ORIGINAL
 *   REFUND != ZERO JOURNAL
 *   REFUND != SILENT NEGATIVE
 *
 * Every refund creates a NEW ledger_entry + NEW journal_entry
 * that reverses (in full or in part) the original entry.
 *
 * The original entry is PRESERVED. Both documents exist in the audit trail.
 * The refund entry carries reversal_of = original ledger_entry_id.
 *
 * Journal direction:
 *   Original:  DR Expense [/ DR GST Recoverable]  CR Bank/Card/AP
 *   Reversal:  DR Bank/Card/AP [/ DR GST Payable]  CR Expense [/ CR GST Recoverable]
 *
 * That is: EVERY line in the original is reversed (debit↔credit).
 * Partial refund: proportional reversal based on refund_amount / original_amount.
 *
 * Supported refund types:
 *   FULL        — full reversal of all original lines
 *   PARTIAL     — proportional reversal of refund_amount / original_amount
 *   CREDIT_NOTE — AP reduction: DR Accounts Payable / CR Expense [/ CR GST Recoverable]
 *   CARD_REFUND — settlement account receives the refund (DR 1040-CC or 1020-Bank)
 *
 * Tax position:
 *   GST/HST recoverable previously claimed — reversed on full refund.
 *   PST non-recoverable — reversed as expense credit only.
 *   Partial refund: proportional tax reversal.
 *
 * All cases: SUM(DR) = SUM(CR)
 */

import { BusinessConfig } from './LedgerService';

function generateId() { return crypto.randomUUID(); }
function generateRefNumber() { return Math.random().toString(16).slice(2, 8).toUpperCase(); }
function round2(n: number) { return Math.round(n * 100) / 100; }

export type RefundType = 'FULL' | 'PARTIAL' | 'CREDIT_NOTE' | 'CARD_REFUND';

export interface RefundInput {
  originalLedgerEntryId: string;
  refundType: RefundType;
  refundAmount: number;        // Gross refund amount (with tax)
  refundDate: string;          // ISO date YYYY-MM-DD
  creditNoteId?: string;       // Supplier credit note number (CREDIT_NOTE only)
  settlementAccount?: string;  // '1010'|'1020'|'1040'|'2010' — where refund was received
  memo?: string;
  runId?: string;
}

export interface RefundResult {
  refundLedgerEntryId: string;
  refundJournalEntryId: string;
  refNumber: string;
  lineCount: number;
  isBalanced: boolean;
  refundAmount: number;
  taxReversed: { gst: number; hst: number; pst: number };
}

export class RefundService {
  private db: D1Database;
  private config: BusinessConfig;

  constructor(db: D1Database, config: BusinessConfig) {
    this.db = db;
    this.config = config;
  }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    // 1. Load original ledger entry
    const originalLE = await this.db.prepare(
      'SELECT * FROM ledger_entries WHERE id = ?'
    ).bind(input.originalLedgerEntryId).first() as any;

    if (!originalLE) {
      throw new Error(`Original ledger entry not found: ${input.originalLedgerEntryId}`);
    }

    // 2. Load original journal entry + lines
    const originalJE = await this.db.prepare(
      'SELECT * FROM journal_entries WHERE ledger_entry_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(input.originalLedgerEntryId).first() as any;

    if (!originalJE) {
      throw new Error(`Original journal entry not found for ledger entry: ${input.originalLedgerEntryId}`);
    }

    const linesResult = await this.db.prepare(
      'SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_order'
    ).bind(originalJE.id).all();

    const originalLines = linesResult.results as any[];

    if (originalLines.length === 0) {
      throw new Error(`Original journal entry has no lines: ${originalJE.id}`);
    }

    // 3. Calculate refund ratio (PARTIAL)
    const originalAmount = originalLE.amount as number;
    const refundAmount = input.refundAmount;
    const ratio = input.refundType === 'FULL' ? 1.0 : round2(refundAmount / originalAmount);

    if (ratio <= 0 || ratio > 1.0000001) {
      throw new Error(
        `Invalid refund ratio ${ratio}: refund_amount ${refundAmount} vs original ${originalAmount}`
      );
    }

    // 4. Build reversing journal lines
    // Each original line is reversed: debit↔credit, amount * ratio
    // Settlement account: if provided, the refund receipt account replaces the original credit account
    const reversalLines = buildReversalLines(
      originalLines,
      ratio,
      input.refundType,
      input.settlementAccount
    );

    // 5. Validate balance (invariant)
    const totalDebits = round2(reversalLines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = round2(reversalLines.reduce((s, l) => s + l.credit, 0));
    const diff = Math.abs(Math.round((totalDebits - totalCredits) * 100));
    if (diff > 1) {
      throw new Error(
        `Refund journal balance violation: DR ${totalDebits} ≠ CR ${totalCredits} ` +
        `(diff ${diff} cents)`
      );
    }

    // 6. Calculate tax reversed (for reporting)
    const extraction = await this.db.prepare(
      'SELECT tax_gst, tax_hst, tax_pst FROM extractions WHERE document_id = ? LIMIT 1'
    ).bind(originalLE.document_id).first() as any;

    const taxReversed = {
      gst: round2((extraction?.tax_gst ?? 0) * ratio),
      hst: round2((extraction?.tax_hst ?? 0) * ratio),
      pst: round2((extraction?.tax_pst ?? 0) * ratio),
    };

    // 7. Persist refund ledger entry
    const refundLedgerEntryId = generateId();
    const refundJournalEntryId = generateId();
    const refNumber = generateRefNumber();
    const runId = input.runId ?? originalLE.run_id;

    await this.db.prepare(`
      INSERT INTO ledger_entries
        (id, run_id, document_id, extraction_id, entry_type, entity, date,
         amount, debit_amount, credit_amount, balance_type,
         status, review_note, ref_number,
         reversal_of, related_to, credit_note_id,
         refund_type, refund_amount, settlement_account,
         created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(
      refundLedgerEntryId,
      runId,
      originalLE.document_id,
      originalLE.extraction_id,
      'REFUND',
      originalLE.entity,
      input.refundDate,
      refundAmount,
      0,             // refund has no net debit at register level
      refundAmount,  // credit position recovered
      'CREDIT',
      'NEEDS_REVIEW',
      `Reversal of #${originalLE.ref_number}${input.memo ? ': ' + input.memo : ''}`,
      refNumber,
      input.originalLedgerEntryId,
      input.originalLedgerEntryId,
      input.creditNoteId ?? null,
      input.refundType,
      refundAmount,
      input.settlementAccount ?? null
    ).run();

    // 8. Persist refund journal entry
    await this.db.prepare(`
      INSERT INTO journal_entries
        (id, ledger_entry_id, entry_date, description, doc_type,
         status, is_balanced, total_debits, total_credits,
         ref_number, reversal_of, reversal_type, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(
      refundJournalEntryId,
      refundLedgerEntryId,
      input.refundDate,
      `${input.refundType} refund: ${originalLE.entity} (reversal of #${originalLE.ref_number})`,
      'REFUND',
      'DRAFT',
      1, // is_balanced
      totalDebits,
      totalCredits,
      refNumber,
      originalJE.id,
      input.refundType
    ).run();

    // 9. Persist reversal journal lines
    for (let i = 0; i < reversalLines.length; i++) {
      const line = reversalLines[i]!;
      await this.db.prepare(`
        INSERT INTO journal_lines
          (id, journal_entry_id, account_code, account_name, debit, credit, memo, line_order)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        generateId(),
        refundJournalEntryId,
        line.account_code,
        line.account_name,
        line.debit,
        line.credit,
        line.memo,
        i + 1
      ).run();
    }

    // 10. Mark original ledger entry as having a reversal (preserve original)
    await this.db.prepare(`
      UPDATE ledger_entries
      SET review_note = COALESCE(review_note || ' | ', '') || ?
      WHERE id = ?
    `).bind(
      `REVERSED_BY:#${refNumber}(${input.refundType})`,
      input.originalLedgerEntryId
    ).run();

    // 11. Audit trail
    await this.db.prepare(`
      INSERT INTO audit_log
        (entity_type, entity_id, action, before_state, after_state, performed_at)
      VALUES ('ledger_entries',?,?,?,?,datetime('now'))
    `).bind(
      refundLedgerEntryId,
      'REFUND_CREATED',
      JSON.stringify({ original_id: input.originalLedgerEntryId }),
      JSON.stringify({
        refund_type: input.refundType,
        refund_amount: refundAmount,
        ratio,
        tax_reversed: taxReversed,
        line_count: reversalLines.length,
      })
    ).run();

    return {
      refundLedgerEntryId,
      refundJournalEntryId,
      refNumber,
      lineCount: reversalLines.length,
      isBalanced: diff <= 1,
      refundAmount,
      taxReversed,
    };
  }
}

// ============================================================
// buildReversalLines
// ============================================================
// Takes the original journal lines and creates reversed counterparts.
// Rules:
//   - Every debit line → becomes a credit line (same account, amount * ratio)
//   - Every credit line → becomes a debit line (same account, amount * ratio)
//   - Exception for settlement account override (CARD_REFUND / CREDIT_NOTE):
//     The original settlement account credit line is replaced by the
//     configured settlement account as a DEBIT (money received back)
// ============================================================

interface ReversalLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  memo: string;
}

function buildReversalLines(
  originalLines: any[],
  ratio: number,
  refundType: RefundType,
  settlementOverride?: string
): ReversalLine[] {
  const lines: ReversalLine[] = [];

  // Identify the original settlement account (the credit line, typically Bank/CC/AP)
  // This is what we reverse: the business gets money BACK or AP is reduced.
  const originalCreditLine = originalLines.find((l: any) => l.credit > 0);
  const settlementAccount = settlementOverride
    ? { code: settlementOverride, name: resolveAccountName(settlementOverride) }
    : originalCreditLine
    ? { code: originalCreditLine.account_code, name: originalCreditLine.account_name }
    : { code: '1010', name: 'Cash' };

  // CREDIT_NOTE: AP credit note reduces Accounts Payable
  // The "debit" side of the refund journal is the AP account (we owe less)
  // The "credit" side is expense reversal (cost goes down)
  if (refundType === 'CREDIT_NOTE') {
    // Reverse all debit lines (expenses, recoverable) → become credits
    for (const line of originalLines) {
      if (line.debit > 0) {
        lines.push({
          account_code: line.account_code,
          account_name: line.account_name,
          debit: 0,
          credit: round2(line.debit * ratio),
          memo: `CREDIT NOTE reversal: ${line.memo ?? ''}`,
        });
      }
    }
    // AP is debited (we owe the supplier less)
    const totalCreditReversed = round2(lines.reduce((s, l) => s + l.credit, 0));
    lines.push({
      account_code: '2010',
      account_name: 'Accounts Payable',
      debit: totalCreditReversed,
      credit: 0,
      memo: `Credit note reduces AP`,
    });
    return lines;
  }

  // FULL / PARTIAL / CARD_REFUND:
  // Reverse every original line proportionally.
  // Settlement line (original credit) becomes a debit (money received back).

  let settlementDebit = 0;

  for (const line of originalLines) {
    if (line.debit > 0) {
      // Original debit (expense, GST recoverable) → reversed to credit
      lines.push({
        account_code: line.account_code,
        account_name: line.account_name,
        debit: 0,
        credit: round2(line.debit * ratio),
        memo: `Reversal: ${line.memo ?? ''}`,
      });
    }
    if (line.credit > 0) {
      // Original credit (Bank/CC/AP) → reversed to debit (refund received)
      const reversedAmount = round2(line.credit * ratio);
      lines.push({
        account_code: settlementAccount.code,
        account_name: settlementAccount.name,
        debit: reversedAmount,
        credit: 0,
        memo: `Refund received: ${line.memo ?? ''}`,
      });
      settlementDebit += reversedAmount;
    }
  }

  // Rounding correction: if debits and credits differ by ±1 cent due to ratio math,
  // adjust the last debit or credit line.
  const totalD = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalC = round2(lines.reduce((s, l) => s + l.credit, 0));
  const diff = round2(totalD - totalC);
  if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.01) {
    // Adjust last credit line
    const lastCredit = [...lines].reverse().find(l => l.credit > 0);
    if (lastCredit) lastCredit.credit = round2(lastCredit.credit - diff);
  }

  return lines;
}

function resolveAccountName(code: string): string {
  const map: Record<string, string> = {
    '1010': 'Cash',
    '1020': 'Bank - Chequing',
    '1030': 'Bank - Savings',
    '1040': 'Credit Card Payable',
    '2010': 'Accounts Payable',
    '1310': 'GST/HST Recoverable',
  };
  return map[code] ?? `Account ${code}`;
}
