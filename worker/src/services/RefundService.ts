/**
 * RefundService.ts - FME Mission 001 - Snap It & Forget It
 *
 * HARD RULES:
 *   REFUND != DELETE ORIGINAL
 *   REFUND != ZERO JOURNAL
 *   REFUND != SILENT NEGATIVE
 *   NO CUMULATIVE REFUND MAY EXCEED ORIGINAL AMOUNT
 *   IDEMPOTENCY: second identical request returns existing, no double-post
 *   ATOMICITY: D1 batch() - partial failure = full rollback
 */
import { toCents, toDollars, allocateProportionally, verifySumExact } from '../lib/money';

function generateId() { return crypto.randomUUID(); }
function generateRef() { return Math.random().toString(16).slice(2, 8).toUpperCase(); }

export type RefundType = 'FULL' | 'PARTIAL' | 'CREDIT_NOTE' | 'CARD_REFUND';

export interface RefundInput {
  originalLedgerEntryId: string;
  refundType: RefundType;
  refundAmount: number;
  refundDate: string;
  idempotencyKey?: string;
  creditNoteId?: string;
  settlementAccount?: string;
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
  cumulativeRefunded: number;
  remainingRefundable: number;
  taxReversed: { gst: number; hst: number; pst: number };
  idempotent: boolean;
}

export interface OverRefundGuard {
  originalAmount: number;
  cumulativeRefunded: number;
  remainingRefundable: number;
  canRefund: boolean;
  maxAllowable: number;
}

export async function checkOverRefund(
  db: D1Database,
  originalLedgerEntryId: string,
  requestedAmount: number
): Promise<OverRefundGuard> {
  const le = await db.prepare('SELECT amount FROM ledger_entries WHERE id = ?').bind(originalLedgerEntryId).first() as any;
  if (!le) throw new Error(`Original ledger entry not found: ${originalLedgerEntryId}`);
  const originalCents = toCents(le.amount);
  const existing = await db.prepare(`
    SELECT COALESCE(SUM(refund_amount), 0) as total_refunded
    FROM ledger_entries WHERE reversal_of = ? AND entry_type = 'REFUND' AND status != 'REJECTED'
  `).bind(originalLedgerEntryId).first() as any;
  const cumulativeCents = toCents(existing?.total_refunded ?? 0);
  const requestedCents = toCents(requestedAmount);
  const remainingCents = originalCents - cumulativeCents;
  return {
    originalAmount: le.amount,
    cumulativeRefunded: toDollars(cumulativeCents),
    remainingRefundable: toDollars(remainingCents),
    canRefund: requestedCents <= remainingCents && remainingCents > 0,
    maxAllowable: toDollars(remainingCents),
  };
}

async function findByIdempotencyKey(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(
    "SELECT id FROM ledger_entries WHERE review_note LIKE ? AND entry_type = 'REFUND' LIMIT 1"
  ).bind(`%IDEMPOTENCY:${key}%`).first() as any;
  return row?.id ?? null;
}

const ACCOUNT_NAMES: Record<string, string> = {
  '1010': 'Cash', '1020': 'Bank - Chequing', '1030': 'Bank - Savings',
  '1040': 'Credit Card Payable', '2010': 'Accounts Payable', '1310': 'GST/HST Recoverable',
};
function accountName(code: string) { return ACCOUNT_NAMES[code] ?? `Account ${code}`; }

interface CentLine {
  accountCode: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  memo: string;
}

function buildReversalLinesCents(
  originalLines: any[],
  refundAmountCents: number,
  refundType: RefundType,
  settlementOverride?: string
): { lines: CentLine[]; taxReversed: { gst: number; hst: number; pst: number } } {
  const lines: CentLine[] = [];
  let gstReversedCents = 0;
  let hstReversedCents = 0;

  const originalCreditLine = originalLines.find((l: any) => l.credit > 0);
  const settlementCode = settlementOverride ?? originalCreditLine?.account_code ?? '1010';
  const settlementNameStr = settlementOverride ? accountName(settlementOverride) : (originalCreditLine?.account_name ?? 'Cash');

  const debitLines = originalLines.filter((l: any) => l.debit > 0);

  if (refundType === 'CREDIT_NOTE') {
    const originalDebitCents = debitLines.map((l: any) => toCents(l.debit));
    const allocated = allocateProportionally(refundAmountCents, originalDebitCents);
    for (let i = 0; i < debitLines.length; i++) {
      const line = debitLines[i]!;
      const amt = allocated[i]!;
      if (amt === 0) continue;
      if (line.account_code === '1310') hstReversedCents += amt;
      lines.push({ accountCode: line.account_code, accountName: line.account_name, debitCents: 0, creditCents: amt, memo: `CREDIT NOTE reversal: ${line.memo ?? ''}` });
    }
    const totalCR = lines.reduce((s, l) => s + l.creditCents, 0);
    lines.push({ accountCode: '2010', accountName: 'Accounts Payable', debitCents: totalCR, creditCents: 0, memo: 'Credit note reduces AP' });
    return { lines, taxReversed: { gst: toDollars(gstReversedCents), hst: toDollars(hstReversedCents), pst: 0 } };
  }

  if (debitLines.length > 0) {
    const originalDebitCents = debitLines.map((l: any) => toCents(l.debit));
    const allocated = allocateProportionally(refundAmountCents, originalDebitCents);
    for (let i = 0; i < debitLines.length; i++) {
      const line = debitLines[i]!;
      const amt = allocated[i]!;
      if (amt === 0) continue;
      if (line.account_code === '1310') hstReversedCents += amt;
      lines.push({ accountCode: line.account_code, accountName: line.account_name, debitCents: 0, creditCents: amt, memo: `Reversal: ${line.memo ?? ''}` });
    }
  }

  const totalCR = lines.reduce((s, l) => s + l.creditCents, 0);
  lines.push({ accountCode: settlementCode, accountName: settlementNameStr, debitCents: totalCR, creditCents: 0, memo: `Refund received: ${refundType}` });

  // Rounding correction
  const totalD = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalC = lines.reduce((s, l) => s + l.creditCents, 0);
  const diff = totalD - totalC;
  if (Math.abs(diff) === 1) {
    const lastCredit = [...lines].reverse().find(l => l.creditCents > 0);
    if (lastCredit) lastCredit.creditCents -= diff;
  }

  return { lines, taxReversed: { gst: toDollars(gstReversedCents), hst: toDollars(hstReversedCents), pst: 0 } };
}

export class RefundService {
  private db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    // 1. Idempotency
    if (input.idempotencyKey) {
      const existingId = await findByIdempotencyKey(this.db, input.idempotencyKey);
      if (existingId) {
        const existingLE = await this.db.prepare('SELECT * FROM ledger_entries WHERE id=?').bind(existingId).first() as any;
        const existingJE = await this.db.prepare('SELECT id FROM journal_entries WHERE ledger_entry_id=? LIMIT 1').bind(existingId).first() as any;
        const lineCnt = await this.db.prepare('SELECT COUNT(*) as cnt FROM journal_lines WHERE journal_entry_id=?').bind(existingJE?.id ?? '').first() as any;
        const guard = await checkOverRefund(this.db, input.originalLedgerEntryId, 0);
        return { refundLedgerEntryId: existingId, refundJournalEntryId: existingJE?.id ?? '', refNumber: existingLE?.ref_number ?? '', lineCount: lineCnt?.cnt ?? 0, isBalanced: true, refundAmount: existingLE?.refund_amount ?? 0, cumulativeRefunded: guard.cumulativeRefunded, remainingRefundable: guard.remainingRefundable, taxReversed: { gst: 0, hst: 0, pst: 0 }, idempotent: true };
      }
    }

    // 2. Load original
    const originalLE = await this.db.prepare('SELECT * FROM ledger_entries WHERE id=?').bind(input.originalLedgerEntryId).first() as any;
    if (!originalLE) throw new Error(`Original ledger entry not found: ${input.originalLedgerEntryId}`);

    // 3. Over-refund check
    const guard = await checkOverRefund(this.db, input.originalLedgerEntryId, input.refundAmount);
    if (!guard.canRefund) throw new Error(`Over-refund rejected: requested $${input.refundAmount.toFixed(2)}, remaining refundable $${guard.remainingRefundable.toFixed(2)} (original $${guard.originalAmount.toFixed(2)}, already refunded $${guard.cumulativeRefunded.toFixed(2)})`);

    // 4. Load original journal + lines
    const originalJE = await this.db.prepare('SELECT * FROM journal_entries WHERE ledger_entry_id=? ORDER BY created_at DESC LIMIT 1').bind(input.originalLedgerEntryId).first() as any;
    if (!originalJE) throw new Error(`Original journal entry not found: ${input.originalLedgerEntryId}`);
    const linesResult = await this.db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id=? ORDER BY line_order').bind(originalJE.id).all();
    const originalLines = linesResult.results as any[];
    if (originalLines.length === 0) throw new Error(`Original journal entry has no lines: ${originalJE.id}`);

    // 5. Build reversal lines (cent-precise)
    const refundAmountCents = toCents(input.refundAmount);
    const { lines: reversalLines, taxReversed } = buildReversalLinesCents(originalLines, refundAmountCents, input.refundType, input.settlementAccount);

    // 6. Balance check - hard stop before any write
    const totalDebitCents = reversalLines.reduce((s, l) => s + l.debitCents, 0);
    const totalCreditCents = reversalLines.reduce((s, l) => s + l.creditCents, 0);
    if (totalDebitCents !== totalCreditCents) throw new Error(`Refund balance violation: DR ${toDollars(totalDebitCents)} != CR ${toDollars(totalCreditCents)} (${totalDebitCents - totalCreditCents} cents). No write.`);
    if (reversalLines.length === 0) throw new Error('Refund produced zero journal lines. Cannot post.');

    // 7. Credit sum check
    const creditCheck = verifySumExact(reversalLines.filter(l => l.creditCents > 0).map(l => toDollars(l.creditCents)), input.refundAmount);
    if (!creditCheck.valid) throw new Error(`Refund line sum mismatch: credits ${creditCheck.actual} != refund ${creditCheck.expected} (${creditCheck.diffCents} cents). No write.`);

    // 8. ATOMIC WRITE via D1 batch()
    const refundLedgerEntryId = generateId();
    const refundJournalEntryId = generateId();
    const refNumber = generateRef();
    const runId = input.runId ?? originalLE.run_id;
    const idempotencyNote = input.idempotencyKey ? ` | IDEMPOTENCY:${input.idempotencyKey}` : '';
    const reviewNote = `Reversal of #${originalLE.ref_number} | ${input.refundType} | $${input.refundAmount.toFixed(2)}${input.memo ? ' | ' + input.memo : ''}${idempotencyNote}`;

    const stmts: D1PreparedStatement[] = [];
    stmts.push(this.db.prepare(`INSERT INTO ledger_entries (id,run_id,document_id,extraction_id,entry_type,entity,date,amount,debit_amount,credit_amount,balance_type,status,review_note,ref_number,reversal_of,related_to,credit_note_id,refund_type,refund_amount,settlement_account,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(refundLedgerEntryId, runId, originalLE.document_id, originalLE.extraction_id, 'REFUND', originalLE.entity, input.refundDate, input.refundAmount, 0, input.refundAmount, 'CREDIT', 'NEEDS_REVIEW', reviewNote, refNumber, input.originalLedgerEntryId, input.originalLedgerEntryId, input.creditNoteId ?? null, input.refundType, input.refundAmount, input.settlementAccount ?? null));
    stmts.push(this.db.prepare(`INSERT INTO journal_entries (id,ledger_entry_id,entry_date,description,doc_type,status,is_balanced,total_debits,total_credits,ref_number,reversal_of,reversal_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(refundJournalEntryId, refundLedgerEntryId, input.refundDate, `${input.refundType} refund: ${originalLE.entity} (reversal of #${originalLE.ref_number})`, 'REFUND', 'DRAFT', 1, toDollars(totalDebitCents), toDollars(totalCreditCents), refNumber, originalJE.id, input.refundType));
    for (let i = 0; i < reversalLines.length; i++) {
      const l = reversalLines[i]!;
      stmts.push(this.db.prepare(`INSERT INTO journal_lines (id,journal_entry_id,account_code,account_name,debit,credit,memo,line_order) VALUES (?,?,?,?,?,?,?,?)`).bind(generateId(), refundJournalEntryId, l.accountCode, l.accountName, toDollars(l.debitCents), toDollars(l.creditCents), l.memo, i + 1));
    }
    stmts.push(this.db.prepare(`UPDATE ledger_entries SET review_note=COALESCE(review_note||' | ','')|| ? WHERE id=?`).bind(`REVERSED_BY:#${refNumber}(${input.refundType})`, input.originalLedgerEntryId));
    stmts.push(this.db.prepare(`INSERT INTO audit_log (entity_type,entity_id,action,before_state,after_state,performed_at) VALUES ('ledger_entries',?,?,?,?,datetime('now'))`).bind(refundLedgerEntryId, 'REFUND_CREATED', JSON.stringify({ original_id: input.originalLedgerEntryId }), JSON.stringify({ refund_type: input.refundType, refund_amount: input.refundAmount, tax_reversed: taxReversed, line_count: reversalLines.length, balance_check: 'PASSED', idempotency_key: input.idempotencyKey ?? null })));

    await this.db.batch(stmts);

    const postGuard = await checkOverRefund(this.db, input.originalLedgerEntryId, 0);
    return { refundLedgerEntryId, refundJournalEntryId, refNumber, lineCount: reversalLines.length, isBalanced: true, refundAmount: input.refundAmount, cumulativeRefunded: postGuard.cumulativeRefunded, remainingRefundable: postGuard.remainingRefundable, taxReversed, idempotent: false };
  }
}
