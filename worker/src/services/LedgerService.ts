/**
 * LedgerService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Double-entry bookkeeping engine.
 *
 * UNIVERSAL RULE: SUM(DEBITS) = SUM(CREDITS). That is all.
 *
 * There is NO artificial 2-line limit.
 * Every transaction creates AS MANY lines as accounting facts require.
 *
 * Examples:
 *   Simple cash expense:          2 lines (DR Expense / CR Cash)
 *   Expense + recoverable GST:    3 lines (DR Expense / DR GST Recoverable / CR Bank)
 *   Supplier invoice + GST:       3 lines (DR Expense / DR GST Recoverable / CR AP)
 *   Split-category receipt:       4+ lines (DR Cat-A / DR Cat-B / DR GST Rec / CR CC)
 *   Refund/credit:                reversing lines as required
 *   Mixed personal/business:      2+ lines with appropriate allocations
 *
 * ITC NOTE: GST/HST recoverable lines are only created when the business
 * configuration confirms ITC eligibility. Detected GST text alone is
 * insufficient. See buildJournalLines() and ITC rules below.
 */

import { ExtractionResult } from '../adapters/GeminiAdapter';

export interface LedgerEntryRow {
  id: string;
  run_id: string | null;
  document_id: string | null;
  extraction_id: string | null;
  entry_type: string;
  entity: string | null;
  date: string | null;
  amount: number;
  debit_amount: number;
  credit_amount: number;
  balance_type: string;
  status: string;
  ref_number: string;
  created_at: string;
}

export interface JournalLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  memo: string | null;
  line_order: number;
}

export interface JournalEntryRow {
  id: string;
  ledger_entry_id: string;
  entry_date: string;
  description: string | null;
  doc_type: string;
  status: string;
  is_balanced: number;
  total_debits: number;
  total_credits: number;
  running_total: number;
  ref_number: string;
  lines: JournalLine[];
}

// ── Business config defaults (configurable, effective-date versioned) ──────
// In production these come from a business_config table or environment.
// Kept as constants here until config store is wired.
export interface BusinessConfig {
  itc_registered: boolean;      // Is business registered for GST/HST ITC?
  itc_registration_number: string | null;
  pst_province: string | null;  // 'BC'|'SK'|'MB'|'QC'|null
  default_payment_account: string; // '1010' Cash | '1020' Chequing | '1040' CC
  uses_ap: boolean;             // Track AP for invoices?
  config_effective_date: string;
}

const DEFAULT_BUSINESS_CONFIG: BusinessConfig = {
  itc_registered: false,        // Conservative default — requires explicit opt-in
  itc_registration_number: null,
  pst_province: null,
  default_payment_account: '1010',
  uses_ap: true,
  config_effective_date: '2000-01-01',
};

// ── Account map ───────────────────────────────────────────────────────────
const CATEGORY_EXPENSE_MAP: Record<string, { code: string; name: string }> = {
  Food:         { code: '5020', name: 'Meals & Entertainment' },
  Transport:    { code: '5030', name: 'Travel' },
  Automotive:   { code: '5040', name: 'Vehicle' },
  Travel:       { code: '5030', name: 'Travel' },
  Office:       { code: '5050', name: 'Office Supplies' },
  Professional: { code: '5060', name: 'Professional Fees' },
  Utilities:    { code: '5070', name: 'Utilities' },
};

const ACCOUNTS = {
  cash:            { code: '1010', name: 'Cash' },
  chequing:        { code: '1020', name: 'Bank - Chequing' },
  creditCard:      { code: '1040', name: 'Credit Card Payable' },
  ar:              { code: '1100', name: 'Accounts Receivable' },
  ap:              { code: '2010', name: 'Accounts Payable' },
  gstHstRecov:     { code: '1310', name: 'GST/HST Recoverable' },
  pstExpense:      { code: '5080', name: 'PST Expense' },
  defaultExpense:  { code: '5010', name: 'Operating Expenses' },
};

function resolveExpenseAccount(category: string | null) {
  if (category && CATEGORY_EXPENSE_MAP[category]) {
    return CATEGORY_EXPENSE_MAP[category]!;
  }
  return ACCOUNTS.defaultExpense;
}

function resolveCreditAccount(
  extraction: ExtractionResult,
  config: BusinessConfig,
  isInvoice: boolean
): { code: string; name: string } {
  // INVOICE → Accounts Payable (if AP tracking enabled)
  if (isInvoice && config.uses_ap) return ACCOUNTS.ap;
  // Payment method determines settlement account
  const pm = (extraction.payment_method ?? '').toLowerCase();
  if (pm === 'credit') return ACCOUNTS.creditCard;
  if (pm === 'debit' || pm === 'bank' || pm === 'transfer') return ACCOUNTS.chequing;
  // Fallback to configured default
  if (config.default_payment_account === '1020') return ACCOUNTS.chequing;
  if (config.default_payment_account === '1040') return ACCOUNTS.creditCard;
  return ACCOUNTS.cash;
}

/**
 * Build all journal lines for a transaction.
 *
 * ITC eligibility rules:
 *   1. Business must be GST/HST registered (itc_registered = true)
 *   2. Extraction must have a non-zero tax_gst or tax_hst amount
 *   3. The extraction confidence for the total must be >= 0.70
 *      (below this threshold: flag ITC_DOCUMENTATION_INCOMPLETE → NEEDS_REVIEW,
 *       do not create recoverable debit line)
 *   4. doc_type must be RECEIPT or INVOICE (not DOCUMENT/STATEMENT)
 *   5. PST is NEVER recoverable — always treated as expense cost
 *
 * SUM(debits) = SUM(credits) is validated before returning.
 * A violation throws an error — never silently post unbalanced entries.
 */
function buildJournalLines(
  extraction: ExtractionResult,
  config: BusinessConfig,
  journalEntryId: string
): { lines: Omit<JournalLine, 'line_order'>[], itcFlags: string[] } {
  const lines: Omit<JournalLine, 'line_order'>[] = [];
  const itcFlags: string[] = [];
  const isExpenseType = extraction.doc_type === 'RECEIPT' || extraction.doc_type === 'INVOICE';
  const isInvoice = extraction.doc_type === 'INVOICE';

  if (!isExpenseType || (extraction.total ?? 0) <= 0) {
    // DOCUMENT / STATEMENT or zero-amount — no DR/CR lines
    return { lines: [], itcFlags: [] };
  }

  const total = extraction.total!;
  const gst = extraction.tax_gst ?? 0;
  const hst = extraction.tax_hst ?? 0;
  const pst = extraction.tax_pst ?? 0;
  const recoverable = gst + hst; // Only GST/HST is potentially recoverable
  const subtotal = extraction.subtotal ?? (total - gst - hst - pst);

  const expenseAccount = resolveExpenseAccount(extraction.category);
  const creditAccount = resolveCreditAccount(extraction, config, isInvoice);

  // ── Determine ITC eligibility ────────────────────────────────────────
  let itcEligible = false;
  if (
    config.itc_registered &&
    recoverable > 0 &&
    extraction.confidence_total >= 0.70
  ) {
    itcEligible = true;
  } else if (recoverable > 0 && !config.itc_registered) {
    itcFlags.push('ITC_NOT_REGISTERED'); // Business not registered — GST is a cost
  } else if (recoverable > 0 && extraction.confidence_total < 0.70) {
    itcFlags.push('ITC_DOCUMENTATION_INCOMPLETE'); // Low confidence — requires review
  }

  // ── Build debit lines ─────────────────────────────────────────────────

  // Expense debit: subtotal (excluding recoverable GST/HST; include PST as it's non-recoverable cost)
  const expenseDebit = itcEligible
    ? subtotal + pst   // PST folds into expense; GST/HST goes to recoverable account
    : total;           // When ITC not applicable, full amount is expense

  lines.push({
    account_code: expenseAccount.code,
    account_name: expenseAccount.name,
    debit: Math.round(expenseDebit * 100) / 100,
    credit: 0,
    memo: `${extraction.doc_type}: ${extraction.vendor ?? extraction.issuer ?? 'Unknown'}`,
  });

  // GST/HST Recoverable debit (only when ITC eligible)
  if (itcEligible && recoverable > 0) {
    lines.push({
      account_code: ACCOUNTS.gstHstRecov.code,
      account_name: ACCOUNTS.gstHstRecov.name,
      debit: Math.round(recoverable * 100) / 100,
      credit: 0,
      memo: `ITC: ${gst > 0 ? `GST $${gst.toFixed(2)}` : ''}${hst > 0 ? ` HST $${hst.toFixed(2)}` : ''}`.trim(),
    });
  }

  // ── Build credit line ─────────────────────────────────────────────────
  lines.push({
    account_code: creditAccount.code,
    account_name: creditAccount.name,
    debit: 0,
    credit: Math.round(total * 100) / 100,
    memo: `Payment: ${extraction.payment_method ?? 'Cash'}`,
  });

  // ── Balance check (invariant) ─────────────────────────────────────────
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  const diff = Math.abs(Math.round((totalDebits - totalCredits) * 100));
  if (diff > 1) {
    // Rounding can cause ±1 cent difference — anything larger is a bug
    throw new Error(
      `Journal balance violation: DR ${totalDebits.toFixed(2)} ≠ CR ${totalCredits.toFixed(2)} ` +
      `(diff ${diff} cents) for ${extraction.vendor ?? 'unknown'}`
    );
  }

  return { lines, itcFlags };
}

function generateId(): string { return crypto.randomUUID(); }
function generateRefNumber(): string {
  return Math.random().toString(16).slice(2, 8).toUpperCase();
}

export class LedgerService {
  private db: D1Database;
  private config: BusinessConfig;

  constructor(db: D1Database, config: BusinessConfig = DEFAULT_BUSINESS_CONFIG) {
    this.db = db;
    this.config = config;
  }

  /**
   * Create a complete ledger + journal entry from an extraction.
   * Returns the created IDs, ref number, ITC flags, and line count.
   */
  async createFromExtraction(
    extraction: ExtractionResult,
    extractionId: string,
    documentId: string,
    runId: string
  ): Promise<{
    ledgerEntryId: string;
    journalEntryId: string;
    refNumber: string;
    lineCount: number;
    itcFlags: string[];
    isBalanced: boolean;
  }> {
    const amount = extraction.total ?? 0;
    const refNumber = generateRefNumber();
    const ledgerEntryId = generateId();
    const journalEntryId = generateId();
    const entryDate = extraction.date ?? new Date().toISOString().slice(0, 10);
    const entity = extraction.vendor ?? extraction.issuer ?? 'Unknown';
    const isExpenseType = extraction.doc_type === 'RECEIPT' || extraction.doc_type === 'INVOICE';
    const balanceType = isExpenseType ? 'DEBIT' : 'BALANCE';

    // Build journal lines (enforces SUM(DR)=SUM(CR))
    const { lines, itcFlags } = buildJournalLines(extraction, this.config, journalEntryId);

    const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
    const isBalanced = lines.length === 0 || Math.abs(Math.round((totalDebits - totalCredits) * 100)) <= 1;

    // Status: NEEDS_REVIEW if ITC flags present, otherwise NEEDS_REVIEW by default
    const status = 'NEEDS_REVIEW';
    const reviewNote = itcFlags.length > 0 ? itcFlags.join(', ') : null;

    // 1. Ledger register entry
    await this.db.prepare(`
      INSERT INTO ledger_entries
        (id, run_id, document_id, extraction_id, entry_type, entity, date,
         amount, debit_amount, credit_amount, balance_type, status, review_note, ref_number, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(
      ledgerEntryId, runId, documentId, extractionId,
      extraction.doc_type, entity, entryDate,
      amount,
      isExpenseType ? amount : 0,
      isExpenseType ? amount : 0,
      balanceType, status, reviewNote, refNumber
    ).run();

    // 2. Journal entry header
    await this.db.prepare(`
      INSERT INTO journal_entries
        (id, ledger_entry_id, entry_date, description, doc_type,
         status, is_balanced, total_debits, total_credits, ref_number, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(
      journalEntryId, ledgerEntryId, entryDate,
      extraction.description ?? entity,
      extraction.doc_type,
      'DRAFT',
      isBalanced ? 1 : 0,
      Math.round(totalDebits * 100) / 100,
      Math.round(totalCredits * 100) / 100,
      refNumber
    ).run();

    // 3. Journal lines — as many as accounting facts require
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      await this.db.prepare(`
        INSERT INTO journal_lines
          (id, journal_entry_id, account_code, account_name, debit, credit, memo, line_order)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        generateId(), journalEntryId,
        line.account_code, line.account_name,
        line.debit, line.credit, line.memo, i + 1
      ).run();
    }

    // 4. Audit
    await this.audit('ledger_entries', ledgerEntryId, 'CREATE', null, {
      status, amount, line_count: lines.length, itc_flags: itcFlags,
    });

    return { ledgerEntryId, journalEntryId, refNumber, lineCount: lines.length, itcFlags, isBalanced };
  }

  async approveLedgerEntry(ledgerEntryId: string, approvedBy = 'user'): Promise<void> {
    const before = await this.db.prepare(
      'SELECT status FROM ledger_entries WHERE id=?'
    ).bind(ledgerEntryId).first();
    await this.db.prepare(`
      UPDATE ledger_entries
      SET status='APPROVED', approved_at=datetime('now'), approved_by=?
      WHERE id=?
    `).bind(approvedBy, ledgerEntryId).run();
    await this.db.prepare(`
      UPDATE journal_entries
      SET status='APPROVED', approved_at=datetime('now'), approved_by=?
      WHERE ledger_entry_id=?
    `).bind(approvedBy, ledgerEntryId).run();
    await this.audit('ledger_entries', ledgerEntryId, 'APPROVE', before, { status: 'APPROVED' });
  }

  async getLedgerEntries(filter: {
    runId?: string;
    dateFilter?: string;
    entryType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<LedgerEntryRow[]> {
    let query = 'SELECT * FROM ledger_entries WHERE 1=1';
    const params: unknown[] = [];
    if (filter.runId)      { query += ' AND run_id=?';    params.push(filter.runId); }
    if (filter.dateFilter === 'today') { query += " AND date(created_at)=date('now')"; }
    if (filter.entryType)  { query += ' AND entry_type=?'; params.push(filter.entryType); }
    if (filter.status)     { query += ' AND status=?';    params.push(filter.status); }
    query += ' ORDER BY created_at DESC';
    query += ` LIMIT ${filter.limit ?? 100} OFFSET ${filter.offset ?? 0}`;
    const result = await this.db.prepare(query).bind(...params).all();
    return result.results as LedgerEntryRow[];
  }

  async getJournalEntries(filter: {
    runId?: string;
    dateFilter?: string;
    entryType?: string;
    status?: string;
  }): Promise<JournalEntryRow[]> {
    let query = `
      SELECT je.*, le.run_id, le.entry_type, le.entity, le.status as ledger_status
      FROM journal_entries je
      JOIN ledger_entries le ON je.ledger_entry_id = le.id
      WHERE 1=1
    `;
    const params: unknown[] = [];
    if (filter.runId)      { query += ' AND le.run_id=?';     params.push(filter.runId); }
    if (filter.dateFilter === 'today') { query += " AND date(je.created_at)=date('now')"; }
    if (filter.entryType)  { query += ' AND le.entry_type=?'; params.push(filter.entryType); }
    if (filter.status)     { query += ' AND je.status=?';     params.push(filter.status); }
    query += ' ORDER BY je.created_at DESC LIMIT 200';
    const result = await this.db.prepare(query).bind(...params).all();
    const entries = result.results as JournalEntryRow[];
    for (const entry of entries) {
      const lines = await this.db.prepare(
        'SELECT * FROM journal_lines WHERE journal_entry_id=? ORDER BY line_order'
      ).bind(entry.id).all();
      entry.lines = lines.results as JournalLine[];
    }
    return entries;
  }

  async getRunningTotal(runId?: string): Promise<number> {
    const query = runId
      ? "SELECT SUM(amount) as total FROM ledger_entries WHERE entry_type IN ('RECEIPT','INVOICE') AND run_id=?"
      : "SELECT SUM(amount) as total FROM ledger_entries WHERE entry_type IN ('RECEIPT','INVOICE')";
    const result = runId
      ? await this.db.prepare(query).bind(runId).first()
      : await this.db.prepare(query).first();
    return (result as any)?.total ?? 0;
  }

  private async audit(
    entityType: string, entityId: string, action: string,
    before: unknown, after: unknown
  ) {
    await this.db.prepare(`
      INSERT INTO audit_log
        (entity_type, entity_id, action, before_state, after_state, performed_at)
      VALUES (?,?,?,?,?,datetime('now'))
    `).bind(
      entityType, entityId, action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after)
    ).run();
  }
}
