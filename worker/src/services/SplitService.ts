/**
 * SplitService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Real transaction splitting.
 *
 * One scanned receipt may contain multiple categories:
 *   - Food Inventory
 *   - Cleaning Supplies
 *   - Office Supplies
 *   - Equipment
 *   - Personal Purchase (non-business, excluded from ITC)
 *
 * Splitting rules:
 *   1. SUM(split_line.allocated_amount) = original ledger_entry.amount
 *      If the split amounts don’t sum exactly, the engine rejects the split.
 *   2. GST/PST is allocated proportionally across splits:
 *      split_gst_portion = (split_subtotal / total_subtotal) * total_gst
 *   3. Personal-use splits (is_business_use = 0) get NO ITC.
 *      Their GST portion goes to 5010-Operating Expenses (or category account),
 *      not to 1310-GST Recoverable.
 *   4. Each split produces its own pair of journal lines:
 *      DR [expense account for split]  [split amount incl non-recoverable tax]
 *      DR 1310-GST Recoverable         [ITC-eligible GST portion, if any]
 *      CR [settlement account]          [split total with tax]
 *      ———
 *      All split lines from a single receipt share ONE credit line
 *      to the settlement account (the full receipt total).
 *   5. The PARENT journal entry carries the settlement credit line.
 *      Individual split debit lines compose the expense side.
 *   6. SUM(all split debit lines) = settlement credit line. Must hold.
 *
 * Lifecycle:
 *   Phase 1: Scan creates a single-line ledger_entry (NEEDS_REVIEW)
 *   Phase 2: User (or accountant) applies a split via POST /api/ledger/:id/split
 *   Phase 3: SplitService replaces the original journal lines with split lines
 *            and inserts split_lines records
 *   Phase 4: Entry status moves from NEEDS_REVIEW to NEEDS_REVIEW (split pending approval)
 *   Phase 5: Approve action finalises the split
 */

import type { BusinessConfig } from './LedgerService';
import { determineITC, type ITCConfig } from './GSTService';

function generateId() { return crypto.randomUUID(); }
function round2(n: number) { return Math.round(n * 100) / 100; }

export interface SplitLineInput {
  description: string;
  expense_account_code: string;
  expense_account_name: string;
  allocated_subtotal: number;   // Pre-tax amount for this split
  is_business_use: boolean;     // false = personal, no ITC
  category?: string;
  memo?: string;
}

export interface SplitInput {
  ledgerEntryId: string;
  splits: SplitLineInput[];
  // Tax totals from original extraction (used for proportional allocation)
  total_gst: number;
  total_hst: number;
  total_pst: number;
  total_subtotal: number;   // Pre-tax total from extraction
  total_with_tax: number;   // Final receipt total (must match ledger_entry.amount)
  settlement_account_code: string;
  settlement_account_name: string;
  date: string;
}

export interface SplitLineResult {
  id: string;
  description: string;
  expense_account_code: string;
  allocated_amount: number;
  gst_portion: number;
  hst_portion: number;
  pst_portion: number;
  total_with_tax: number;
  is_business_use: boolean;
  itc_eligible: number;
  debit_lines: Array<{ account_code: string; account_name: string; amount: number; is_itc: boolean }>;
}

export interface SplitResult {
  ledgerEntryId: string;
  journalEntryId: string;
  splitLines: SplitLineResult[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  itcTotal: number;
  personalUseTotal: number;
}

export class SplitService {
  private db: D1Database;
  private config: BusinessConfig;
  private itcConfig: ITCConfig;

  constructor(db: D1Database, config: BusinessConfig, itcConfig: ITCConfig) {
    this.db = db;
    this.config = config;
    this.itcConfig = itcConfig;
  }

  async applySplit(input: SplitInput): Promise<SplitResult> {
    // 1. Load ledger entry
    const le = await this.db.prepare(
      'SELECT * FROM ledger_entries WHERE id = ?'
    ).bind(input.ledgerEntryId).first() as any;

    if (!le) throw new Error(`Ledger entry not found: ${input.ledgerEntryId}`);
    if (le.status === 'APPROVED') throw new Error('Cannot split an approved entry');

    // 2. Validate split amounts sum to total
    const splitSubtotalSum = round2(input.splits.reduce((s, sp) => s + sp.allocated_subtotal, 0));
    if (Math.abs(splitSubtotalSum - input.total_subtotal) > 0.02) {
      throw new Error(
        `Split subtotals (${splitSubtotalSum}) do not sum to total subtotal (${input.total_subtotal}). ` +
        `Difference: ${round2(Math.abs(splitSubtotalSum - input.total_subtotal))}`
      );
    }

    // 3. Load existing journal entry
    const je = await this.db.prepare(
      'SELECT * FROM journal_entries WHERE ledger_entry_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(input.ledgerEntryId).first() as any;

    if (!je) throw new Error(`No journal entry for ledger entry: ${input.ledgerEntryId}`);

    // 4. Delete existing journal lines (they will be replaced by split lines)
    await this.db.prepare(
      'DELETE FROM journal_lines WHERE journal_entry_id = ?'
    ).bind(je.id).run();

    // Also delete existing split_lines if re-splitting
    await this.db.prepare(
      'DELETE FROM split_lines WHERE ledger_entry_id = ?'
    ).bind(input.ledgerEntryId).run();

    // 5. Build split journal lines
    const allJournalLines: Array<{
      account_code: string; account_name: string;
      debit: number; credit: number; memo: string | null;
    }> = [];

    const splitLineResults: SplitLineResult[] = [];
    let lineOrder = 1;
    let itcTotal = 0;
    let personalUseTotal = 0;

    for (const split of input.splits) {
      // Proportional tax allocation
      const proportion = input.total_subtotal > 0
        ? split.allocated_subtotal / input.total_subtotal
        : 1 / input.splits.length;

      const splitGst = round2(input.total_gst * proportion);
      const splitHst = round2(input.total_hst * proportion);
      const splitPst = round2(input.total_pst * proportion);
      const splitRecoverable = splitGst + splitHst;
      const splitTotalWithTax = round2(split.allocated_subtotal + splitGst + splitHst + splitPst);

      // ITC eligibility for this split line
      const itcDetermination = split.is_business_use
        ? determineITC(
            {
              doc_type: le.entry_type,
              tax_gst: splitGst,
              tax_hst: splitHst,
              tax_pst: splitPst,
              confidence_total: 0.90, // split is manually entered — high confidence
              date: input.date,
              category: split.category ?? null,
            },
            this.itcConfig
          )
        : { eligible: false, flags: ['PERSONAL_USE'], recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: splitPst, review_required: false };

      const eligibleITC = itcDetermination.eligible
        ? round2(itcDetermination.recoverable_gst + itcDetermination.recoverable_hst)
        : 0;

      // Debit: expense line
      // If ITC eligible: expense debit = subtotal + PST (GST/HST goes to recoverable account)
      // If NOT ITC eligible: expense debit = full split total with tax (all tax is a cost)
      const expenseDebit = itcDetermination.eligible
        ? round2(split.allocated_subtotal + splitPst)
        : splitTotalWithTax;

      allJournalLines.push({
        account_code: split.expense_account_code,
        account_name: split.expense_account_name,
        debit: expenseDebit,
        credit: 0,
        memo: split.description,
      });

      // Debit: GST/HST Recoverable (only when ITC eligible)
      if (itcDetermination.eligible && splitRecoverable > 0) {
        allJournalLines.push({
          account_code: '1310',
          account_name: 'GST/HST Recoverable',
          debit: splitRecoverable,
          credit: 0,
          memo: `ITC: ${split.description}`,
        });
      }

      if (!split.is_business_use) personalUseTotal = round2(personalUseTotal + splitTotalWithTax);
      itcTotal = round2(itcTotal + eligibleITC);

      // 6. Insert split_lines record
      const splitLineId = generateId();
      await this.db.prepare(`
        INSERT INTO split_lines
          (id, ledger_entry_id, journal_entry_id, line_order, description,
           expense_account_code, expense_account_name,
           allocated_amount, gst_portion, hst_portion, pst_portion,
           total_with_tax, is_business_use, itc_eligible, category, memo, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      `).bind(
        splitLineId,
        input.ledgerEntryId,
        je.id,
        lineOrder++,
        split.description,
        split.expense_account_code,
        split.expense_account_name,
        split.allocated_subtotal,
        splitGst,
        splitHst,
        splitPst,
        splitTotalWithTax,
        split.is_business_use ? 1 : 0,
        eligibleITC,
        split.category ?? null,
        split.memo ?? null
      ).run();

      splitLineResults.push({
        id: splitLineId,
        description: split.description,
        expense_account_code: split.expense_account_code,
        allocated_amount: split.allocated_subtotal,
        gst_portion: splitGst,
        hst_portion: splitHst,
        pst_portion: splitPst,
        total_with_tax: splitTotalWithTax,
        is_business_use: split.is_business_use,
        itc_eligible: eligibleITC,
        debit_lines: [
          { account_code: split.expense_account_code, account_name: split.expense_account_name, amount: expenseDebit, is_itc: false },
          ...(itcDetermination.eligible && splitRecoverable > 0
            ? [{ account_code: '1310', account_name: 'GST/HST Recoverable', amount: splitRecoverable, is_itc: true }]
            : []),
        ],
      });
    }

    // 7. Single settlement credit line (full receipt total)
    allJournalLines.push({
      account_code: input.settlement_account_code,
      account_name: input.settlement_account_name,
      debit: 0,
      credit: input.total_with_tax,
      memo: 'Split receipt settlement',
    });

    // 8. Balance check (hard invariant)
    const totalDebits = round2(allJournalLines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = round2(allJournalLines.reduce((s, l) => s + l.credit, 0));
    const diff = Math.abs(Math.round((totalDebits - totalCredits) * 100));

    if (diff > 1) {
      throw new Error(
        `Split balance violation: DR ${totalDebits.toFixed(2)} ≠ CR ${totalCredits.toFixed(2)} ` +
        `(diff ${diff} cents). Check split amounts and tax allocations.`
      );
    }

    // 9. Insert all journal lines
    for (let i = 0; i < allJournalLines.length; i++) {
      const line = allJournalLines[i]!;
      await this.db.prepare(`
        INSERT INTO journal_lines
          (id, journal_entry_id, account_code, account_name, debit, credit, memo, line_order)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        generateId(), je.id,
        line.account_code, line.account_name,
        line.debit, line.credit, line.memo, i + 1
      ).run();
    }

    // 10. Update journal entry totals
    await this.db.prepare(`
      UPDATE journal_entries
      SET total_debits = ?, total_credits = ?, is_balanced = 1,
          description = ?
      WHERE id = ?
    `).bind(
      totalDebits, totalCredits,
      `Split receipt (${input.splits.length} lines): ${le.entity}`,
      je.id
    ).run();

    // 11. Update ledger entry review note
    await this.db.prepare(`
      UPDATE ledger_entries
      SET review_note = ?
      WHERE id = ?
    `).bind(
      `SPLIT:${input.splits.length} lines | ITC:${itcTotal.toFixed(2)} | Personal:${personalUseTotal.toFixed(2)}`,
      input.ledgerEntryId
    ).run();

    // 12. Audit
    await this.db.prepare(`
      INSERT INTO audit_log
        (entity_type, entity_id, action, after_state, performed_at)
      VALUES ('ledger_entries',?,?,?,datetime('now'))
    `).bind(
      input.ledgerEntryId,
      'SPLIT_APPLIED',
      JSON.stringify({
        split_count: input.splits.length,
        total_debits: totalDebits,
        total_credits: totalCredits,
        itc_total: itcTotal,
        personal_use_total: personalUseTotal,
      })
    ).run();

    return {
      ledgerEntryId: input.ledgerEntryId,
      journalEntryId: je.id,
      splitLines: splitLineResults,
      totalDebits,
      totalCredits,
      isBalanced: diff <= 1,
      itcTotal,
      personalUseTotal,
    };
  }
}
