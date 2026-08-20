/**
 * SplitService.ts - FME Mission 001 - Snap It & Forget It
 * Real transaction splitting with deterministic money arithmetic, atomicity, personal accounting.
 */
import { splitProportional, toCents, toDollars, verifySumExact } from '../lib/money';
import { determineITC, ITCConfig } from './GSTService';
import type { BusinessConfig } from './LedgerService';

function generateId() { return crypto.randomUUID(); }
function round2(n: number) { return Math.round(n * 100) / 100; }

export interface SplitLineInput {
  description: string;
  expense_account_code: string;
  expense_account_name: string;
  allocated_subtotal: number;
  is_business_use: boolean;
  category?: string;
  memo?: string;
}

export interface SplitInput {
  ledgerEntryId: string;
  splits: SplitLineInput[];
  total_gst: number;
  total_hst: number;
  total_pst: number;
  total_subtotal: number;
  total_with_tax: number;
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
  personalUseCount: number;
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
    if (!input.splits || input.splits.length < 1) throw new Error('Split requires at least 1 line');

    const le = await this.db.prepare('SELECT * FROM ledger_entries WHERE id = ?').bind(input.ledgerEntryId).first() as any;
    if (!le) throw new Error(`Ledger entry not found: ${input.ledgerEntryId}`);
    if (le.status === 'APPROVED') throw new Error('Cannot split an approved entry. Void and re-enter.');

    // Validate subtotals sum
    const splitSubtotalSum = round2(input.splits.reduce((s, sp) => s + sp.allocated_subtotal, 0));
    const diff = Math.abs(toCents(splitSubtotalSum) - toCents(input.total_subtotal));
    if (diff > 1) {
      throw new Error(`Split subtotals (${splitSubtotalSum}) do not sum to total subtotal (${input.total_subtotal}). Difference: ${diff} cents.`);
    }

    const je = await this.db.prepare('SELECT * FROM journal_entries WHERE ledger_entry_id = ? ORDER BY created_at DESC LIMIT 1').bind(input.ledgerEntryId).first() as any;
    if (!je) throw new Error(`No journal entry for ledger entry: ${input.ledgerEntryId}`);

    // Proportional tax allocation using deterministic cents
    const weights = input.splits.map(s => s.allocated_subtotal);
    const gstParts = splitProportional(input.total_gst, weights);
    const hstParts = splitProportional(input.total_hst, weights);
    const pstParts = splitProportional(input.total_pst, weights);

    // Verify sums
    for (const [parts, total, name] of [[gstParts, input.total_gst, 'GST'], [hstParts, input.total_hst, 'HST'], [pstParts, input.total_pst, 'PST']] as [number[], number, string][]) {
      const check = verifySumExact(parts, total);
      if (!check.valid) throw new Error(`${name} allocation mismatch: ${check.actual} != ${check.expected} (${check.diffCents} cents)`);
    }

    const journalLines: Array<{ account_code: string; account_name: string; debit: number; credit: number; memo: string }> = [];
    const splitLineResults: SplitLineResult[] = [];
    let itcTotal = 0;
    let personalUseTotal = 0;
    let personalUseCount = 0;

    for (let i = 0; i < input.splits.length; i++) {
      const split = input.splits[i]!;
      const splitGst = gstParts[i]!;
      const splitHst = hstParts[i]!;
      const splitPst = pstParts[i]!;
      const splitRecoverable = round2(splitGst + splitHst);
      const splitTotalWithTax = round2(split.allocated_subtotal + splitGst + splitHst + splitPst);

      const itcDetermination = split.is_business_use
        ? determineITC({
            doc_type: le.entry_type,
            tax_gst: splitGst, tax_hst: splitHst, tax_pst: splitPst,
            confidence_total: 0.90,
            date: input.date,
            category: split.category ?? null,
          }, this.itcConfig)
        : { eligible: false, flags: ['PERSONAL_USE_NOT_ITC_ELIGIBLE'] as any[], recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: splitPst, review_required: false };

      const eligibleITC = itcDetermination.eligible ? round2(itcDetermination.recoverable_gst + itcDetermination.recoverable_hst) : 0;

      // PERSONAL PURCHASE: full cost posts to expense account, is_business_use=0, no ITC
      if (!split.is_business_use) { personalUseTotal = round2(personalUseTotal + splitTotalWithTax); personalUseCount++; }

      const expenseDebit = itcDetermination.eligible ? round2(split.allocated_subtotal + splitPst) : splitTotalWithTax;

      journalLines.push({ account_code: split.expense_account_code, account_name: split.expense_account_name, debit: expenseDebit, credit: 0, memo: split.description + (split.is_business_use ? '' : ' [PERSONAL]') });

      if (itcDetermination.eligible && splitRecoverable > 0) {
        journalLines.push({ account_code: '1310', account_name: 'GST/HST Recoverable', debit: splitRecoverable, credit: 0, memo: `ITC: ${split.description}` });
        itcTotal = round2(itcTotal + splitRecoverable);
      }

      const splitLineId = generateId();
      splitLineResults.push({ id: splitLineId, description: split.description, expense_account_code: split.expense_account_code, allocated_amount: split.allocated_subtotal, gst_portion: splitGst, hst_portion: splitHst, pst_portion: splitPst, total_with_tax: splitTotalWithTax, is_business_use: split.is_business_use, itc_eligible: eligibleITC });
    }

    // Single settlement credit
    journalLines.push({ account_code: input.settlement_account_code, account_name: input.settlement_account_name, debit: 0, credit: input.total_with_tax, memo: 'Split receipt settlement' });

    // Balance check BEFORE any write
    const totalDebits = round2(journalLines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = round2(journalLines.reduce((s, l) => s + l.credit, 0));
    const balDiff = Math.abs(Math.round((totalDebits - totalCredits) * 100));
    if (balDiff > 1) throw new Error(`Split balance violation: DR ${totalDebits.toFixed(2)} != CR ${totalCredits.toFixed(2)} (${balDiff} cents). No write performed.`);

    // ATOMIC WRITE via D1 batch()
    const stmts: D1PreparedStatement[] = [];
    stmts.push(this.db.prepare('DELETE FROM journal_lines WHERE journal_entry_id = ?').bind(je.id));
    stmts.push(this.db.prepare('DELETE FROM split_lines WHERE ledger_entry_id = ?').bind(input.ledgerEntryId));

    for (let i = 0; i < input.splits.length; i++) {
      const split = input.splits[i]!;
      const r = splitLineResults[i]!;
      stmts.push(this.db.prepare(`INSERT INTO split_lines (id,ledger_entry_id,journal_entry_id,line_order,description,expense_account_code,expense_account_name,allocated_amount,gst_portion,hst_portion,pst_portion,total_with_tax,is_business_use,itc_eligible,category,memo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(r.id, input.ledgerEntryId, je.id, i + 1, split.description, split.expense_account_code, split.expense_account_name, split.allocated_subtotal, r.gst_portion, r.hst_portion, r.pst_portion, r.total_with_tax, split.is_business_use ? 1 : 0, r.itc_eligible, split.category ?? null, split.memo ?? null));
    }

    for (let i = 0; i < journalLines.length; i++) {
      const l = journalLines[i]!;
      stmts.push(this.db.prepare(`INSERT INTO journal_lines (id,journal_entry_id,account_code,account_name,debit,credit,memo,line_order) VALUES (?,?,?,?,?,?,?,?)`).bind(generateId(), je.id, l.account_code, l.account_name, l.debit, l.credit, l.memo, i + 1));
    }

    stmts.push(this.db.prepare(`UPDATE journal_entries SET total_debits=?,total_credits=?,is_balanced=1,description=? WHERE id=?`).bind(totalDebits, totalCredits, `Split (${input.splits.length} lines, personal: ${personalUseCount}): ${le.entity}`, je.id));
    stmts.push(this.db.prepare(`UPDATE ledger_entries SET review_note=? WHERE id=?`).bind(`SPLIT:${input.splits.length} lines | ITC:${itcTotal.toFixed(2)} | Personal:${personalUseTotal.toFixed(2)} (${personalUseCount} items)`, input.ledgerEntryId));
    stmts.push(this.db.prepare(`INSERT INTO audit_log (entity_type,entity_id,action,after_state,performed_at) VALUES ('ledger_entries',?,?,?,datetime('now'))`).bind(input.ledgerEntryId, 'SPLIT_APPLIED', JSON.stringify({ split_count: input.splits.length, total_debits: totalDebits, total_credits: totalCredits, itc_total: itcTotal, personal_use_total: personalUseTotal, personal_use_count: personalUseCount, balance_check: 'PASSED' })));

    await this.db.batch(stmts);

    return { ledgerEntryId: input.ledgerEntryId, journalEntryId: je.id, splitLines: splitLineResults, totalDebits, totalCredits, isBalanced: balDiff <= 1, itcTotal, personalUseTotal, personalUseCount };
  }
}
