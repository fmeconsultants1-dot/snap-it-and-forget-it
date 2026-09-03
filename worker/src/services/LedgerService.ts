/**
 * LedgerService.ts - FME Mission 001 - Snap It & Forget It
 *
 * Double-entry bookkeeping engine.
 * UNIVERSAL RULE: SUM(DEBITS) = SUM(CREDITS). No 2-line limit.
 * Uses deterministic cent arithmetic from money.ts.
 * BusinessConfig is exported for use by ScanService and SplitService.
 */

import { toCents, toDollars, splitProportional } from '../lib/money';
import type { ExtractionResult } from '../adapters/GeminiAdapter';
import { determineITC } from './GSTService';

// Exported so ScanService, SplitService, tests can import it
export interface BusinessConfig {
  itc_registered: boolean;
  itc_registration_number: string | null;
  itc_registration_effective_date: string | null;
  default_payment_account: '1010' | '1020' | '1040';
  uses_ap: boolean;
  min_confidence_for_itc: number;
}

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
  review_note: string | null;
  created_at: string;
  reversal_of: string | null;
  refund_type: string | null;
}

export interface JournalLineRow {
  id: string;
  journal_entry_id: string;
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
  lines: JournalLineRow[];
}

/** Fields the user may correct on the review screen before approving. */
export interface ReviewCorrections {
  vendor?: string | null;
  date?: string | null;
  category?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  tax_gst?: number | null;
  tax_hst?: number | null;
  tax_pst?: number | null;
  total?: number | null;
  payment_method?: string | null;
  description?: string | null;
  doc_type?: string | null;
}

const DEFAULT_CONFIG: BusinessConfig = {
  itc_registered: false,
  itc_registration_number: null,
  itc_registration_effective_date: null,
  default_payment_account: '1010',
  uses_ap: true,
  min_confidence_for_itc: 0.70,
};

const CATEGORY_ACCOUNT: Record<string, { code: string; name: string }> = {
  Food:         { code: '5020', name: 'Meals & Entertainment' },
  Transport:    { code: '5030', name: 'Travel' },
  Automotive:   { code: '5040', name: 'Vehicle' },
  Travel:       { code: '5030', name: 'Travel' },
  Office:       { code: '5050', name: 'Office Supplies' },
  Professional: { code: '5060', name: 'Professional Fees' },
  Utilities:    { code: '5070', name: 'Utilities' },
};

const ACCOUNTS = {
  cash:       { code: '1010', name: 'Cash' },
  chequing:   { code: '1020', name: 'Bank - Chequing' },
  creditCard: { code: '1040', name: 'Credit Card Payable' },
  ap:         { code: '2010', name: 'Accounts Payable' },
  gstRecov:   { code: '1310', name: 'GST/HST Recoverable' },
  defaultExp: { code: '5010', name: 'Operating Expenses' },
};

function expenseAccount(category: string | null) {
  return (category && CATEGORY_ACCOUNT[category]) ? CATEGORY_ACCOUNT[category]! : ACCOUNTS.defaultExp;
}

function settlementAccount(extraction: ExtractionResult, config: BusinessConfig, isInvoice: boolean) {
  if (isInvoice && config.uses_ap) return ACCOUNTS.ap;
  const pm = (extraction.payment_method ?? '').toLowerCase();
  if (pm === 'credit') return ACCOUNTS.creditCard;
  if (pm === 'debit' || pm === 'bank' || pm === 'transfer') return ACCOUNTS.chequing;
  if (config.default_payment_account === '1040') return ACCOUNTS.creditCard;
  if (config.default_payment_account === '1020') return ACCOUNTS.chequing;
  return ACCOUNTS.cash;
}

function buildJournalLines(
  extraction: ExtractionResult,
  config: BusinessConfig,
  itcConfig: any
): { lines: Array<{ code: string; name: string; debitCents: number; creditCents: number; memo: string }>; itcFlags: string[] } {
  const lines: Array<{ code: string; name: string; debitCents: number; creditCents: number; memo: string }> = [];
  const itcFlags: string[] = [];
  const isExpense = extraction.doc_type === 'RECEIPT' || extraction.doc_type === 'INVOICE';
  const isInvoice = extraction.doc_type === 'INVOICE';

  if (!isExpense || (extraction.total ?? 0) <= 0) return { lines: [], itcFlags: [] };

  const totalCents = toCents(extraction.total!);
  const gstCents = toCents(extraction.tax_gst ?? 0);
  const hstCents = toCents(extraction.tax_hst ?? 0);
  const pstCents = toCents(extraction.tax_pst ?? 0);
  const recoverableCents = gstCents + hstCents;
  const subtotalCents = totalCents - gstCents - hstCents - pstCents;

  const exp = expenseAccount(extraction.category);
  const settle = settlementAccount(extraction, config, isInvoice);

  const itcDet = itcConfig
    ? determineITC({
        doc_type: extraction.doc_type,
        tax_gst: toDollars(gstCents),
        tax_hst: toDollars(hstCents),
        tax_pst: toDollars(pstCents),
        confidence_total: extraction.confidence_total,
        date: extraction.date,
        category: extraction.category,
      }, itcConfig)
    : { eligible: false, flags: [] as string[], recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: toDollars(pstCents), review_required: false };

  if (!itcDet.eligible && recoverableCents > 0) {
    itcFlags.push(...(itcDet.flags as string[]));
  }

  const expDebitCents = itcDet.eligible
    ? subtotalCents + pstCents
    : totalCents;

  lines.push({ code: exp.code, name: exp.name, debitCents: expDebitCents, creditCents: 0, memo: `${extraction.doc_type}: ${extraction.vendor ?? extraction.issuer ?? 'Unknown'}` });

  if (itcDet.eligible && recoverableCents > 0) {
    lines.push({ code: ACCOUNTS.gstRecov.code, name: ACCOUNTS.gstRecov.name, debitCents: recoverableCents, creditCents: 0, memo: 'ITC' });
    itcFlags.push('ITC_ELIGIBLE');
  }

  lines.push({ code: settle.code, name: settle.name, debitCents: 0, creditCents: totalCents, memo: `Payment: ${extraction.payment_method ?? 'Cash'}` });

  const sumDR = lines.reduce((s, l) => s + l.debitCents, 0);
  const sumCR = lines.reduce((s, l) => s + l.creditCents, 0);
  if (Math.abs(sumDR - sumCR) > 1) {
    throw new Error(`Journal balance violation: DR ${toDollars(sumDR)} != CR ${toDollars(sumCR)} (${Math.abs(sumDR - sumCR)} cents)`);
  }

  return { lines, itcFlags };
}

function generateId() { return crypto.randomUUID(); }
function generateRef() { return Math.random().toString(16).slice(2, 8).toUpperCase(); }

export class LedgerService {
  private db: D1Database;
  private config: BusinessConfig;
  private itcConfig: any;

  constructor(db: D1Database, config: BusinessConfig = DEFAULT_CONFIG, itcConfig?: any) {
    this.db = db;
    this.config = config;
    this.itcConfig = itcConfig ?? null;
  }

  async createFromExtraction(
    extraction: ExtractionResult,
    extractionId: string,
    documentId: string,
    runId: string
  ): Promise<{ ledgerEntryId: string; journalEntryId: string; refNumber: string; lineCount: number; itcFlags: string[]; isBalanced: boolean }> {
    const amount = extraction.total ?? 0;
    const refNumber = generateRef();
    const leId = generateId();
    const jeId = generateId();
    const date = extraction.date ?? new Date().toISOString().slice(0, 10);
    const entity = extraction.vendor ?? extraction.issuer ?? 'Unknown';
    const isExpense = extraction.doc_type === 'RECEIPT' || extraction.doc_type === 'INVOICE';
    const balanceType = isExpense ? 'DEBIT' : 'BALANCE';

    const { lines, itcFlags } = buildJournalLines(extraction, this.config, this.itcConfig);
    const sumDRCents = lines.reduce((s, l) => s + l.debitCents, 0);
    const sumCRCents = lines.reduce((s, l) => s + l.creditCents, 0);
    const isBalanced = lines.length === 0 || Math.abs(sumDRCents - sumCRCents) <= 1;
    const reviewNote = itcFlags.filter(f => f !== 'ITC_ELIGIBLE').join(', ') || null;

    const stmts: D1PreparedStatement[] = [];

    stmts.push(this.db.prepare(`
      INSERT INTO ledger_entries
        (id,run_id,document_id,extraction_id,entry_type,entity,date,
         amount,debit_amount,credit_amount,balance_type,status,review_note,ref_number,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(leId, runId, documentId, extractionId,
      extraction.doc_type, entity, date,
      amount, isExpense ? amount : 0, isExpense ? amount : 0,
      balanceType, 'NEEDS_REVIEW', reviewNote, refNumber));

    stmts.push(this.db.prepare(`
      INSERT INTO journal_entries
        (id,ledger_entry_id,entry_date,description,doc_type,status,is_balanced,total_debits,total_credits,ref_number,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(jeId, leId, date, extraction.description ?? entity,
      extraction.doc_type, 'DRAFT', isBalanced ? 1 : 0,
      toDollars(sumDRCents), toDollars(sumCRCents), refNumber));

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      stmts.push(this.db.prepare(`
        INSERT INTO journal_lines(id,journal_entry_id,account_code,account_name,debit,credit,memo,line_order)
        VALUES(?,?,?,?,?,?,?,?)
      `).bind(generateId(), jeId, l.code, l.name, toDollars(l.debitCents), toDollars(l.creditCents), l.memo, i + 1));
    }

    stmts.push(this.db.prepare(`
      INSERT INTO audit_log(entity_type,entity_id,action,after_state,performed_at)
      VALUES('ledger_entries',?,?,?,datetime('now'))
    `).bind(leId, 'CREATE', JSON.stringify({ status: 'NEEDS_REVIEW', amount, line_count: lines.length, itc_flags: itcFlags })));

    await this.db.batch(stmts);

    return { ledgerEntryId: leId, journalEntryId: jeId, refNumber, lineCount: lines.length, itcFlags, isBalanced };
  }

  /**
   * updateAndApprove — Stage 6 core method.
   * Called when the user approves on the review screen.
   * Applies corrections, rebuilds journal lines, marks APPROVED atomically.
   * Original R2 document is untouched. document_id association preserved.
   */
  async updateAndApprove(
    ledgerEntryId: string,
    corrections: ReviewCorrections,
    approvedBy = 'user'
  ): Promise<{ isBalanced: boolean; itcFlags: string[] }> {
    const existing = await this.db
      .prepare('SELECT * FROM ledger_entries WHERE id=?')
      .bind(ledgerEntryId)
      .first() as any;
    if (!existing) throw new Error(`Ledger entry not found: ${ledgerEntryId}`);

    const jeRow = await this.db
      .prepare('SELECT id FROM journal_entries WHERE ledger_entry_id=? LIMIT 1')
      .bind(ledgerEntryId)
      .first() as any;
    if (!jeRow) throw new Error(`Journal entry not found for ledger entry: ${ledgerEntryId}`);
    const jeId: string = jeRow.id;

    const docType = (corrections.doc_type ?? existing.entry_type ?? 'RECEIPT') as ExtractionResult['doc_type'];
    const vendor         = corrections.vendor          !== undefined ? corrections.vendor          : (existing.entity ?? null);
    const date           = corrections.date            !== undefined ? corrections.date            : (existing.date ?? null);
    const total          = corrections.total           !== undefined ? (corrections.total ?? 0)    : (existing.amount ?? 0);
    const category       = corrections.category        !== undefined ? corrections.category        : null;
    const paymentMethod  = corrections.payment_method  !== undefined ? corrections.payment_method  : null;
    const description    = corrections.description     !== undefined ? corrections.description     : null;

    const rawTax  = corrections.tax ?? null;
    const taxGst  = corrections.tax_gst !== undefined ? (corrections.tax_gst ?? 0) : (rawTax != null ? rawTax : 0);
    const taxHst  = corrections.tax_hst !== undefined ? (corrections.tax_hst ?? 0) : 0;
    const taxPst  = corrections.tax_pst !== undefined ? (corrections.tax_pst ?? 0) : 0;
    const subtotal = corrections.subtotal !== undefined ? (corrections.subtotal ?? 0)
                   : Math.max(0, total - taxGst - taxHst - taxPst);

    // FIX TS5076: parentheses added so ?? and || do not mix without parens
    const taxValue: number | null = (rawTax ?? (taxGst + taxHst + taxPst)) || null;

    const syntheticExtraction: ExtractionResult = {
      doc_type: docType,
      vendor,
      date,
      total,
      subtotal,
      tax: taxValue,
      tax_gst: taxGst,
      tax_hst: taxHst,
      tax_pst: taxPst,
      payment_method: paymentMethod,
      category,
      description,
      issuer: null,
      line_items: [],
      raw_fields: {},
      confidence_vendor: 1.0,
      confidence_date: 1.0,
      confidence_total: 1.0,
      confidence_category: 1.0,
      gemini_model: 'user-corrected',
    };

    const { lines, itcFlags } = buildJournalLines(syntheticExtraction, this.config, this.itcConfig);
    const sumDRCents = lines.reduce((s, l) => s + l.debitCents, 0);
    const sumCRCents = lines.reduce((s, l) => s + l.creditCents, 0);
    const isBalanced = lines.length === 0 || Math.abs(sumDRCents - sumCRCents) <= 1;
    const reviewNote = itcFlags.filter(f => f !== 'ITC_ELIGIBLE').join(', ') || null;
    const entity = vendor ?? 'Unknown';
    const isExpense = docType === 'RECEIPT' || docType === 'INVOICE';
    const safeDate = date ?? new Date().toISOString().slice(0, 10);

    const stmts: D1PreparedStatement[] = [];

    stmts.push(this.db.prepare(`
      UPDATE ledger_entries
      SET entity=?, date=?, amount=?, debit_amount=?, credit_amount=?,
          entry_type=?, review_note=?, status='APPROVED',
          approved_at=datetime('now'), approved_by=?
      WHERE id=?
    `).bind(
      entity, safeDate, total,
      isExpense ? total : 0,
      isExpense ? total : 0,
      docType, reviewNote, approvedBy,
      ledgerEntryId
    ));

    stmts.push(this.db.prepare(`
      UPDATE journal_entries
      SET entry_date=?, description=?, doc_type=?,
          status='APPROVED', is_balanced=?,
          total_debits=?, total_credits=?,
          approved_at=datetime('now'), approved_by=?
      WHERE id=?
    `).bind(
      safeDate,
      description ?? entity,
      docType,
      isBalanced ? 1 : 0,
      toDollars(sumDRCents),
      toDollars(sumCRCents),
      approvedBy,
      jeId
    ));

    stmts.push(this.db.prepare('DELETE FROM journal_lines WHERE journal_entry_id=?').bind(jeId));

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      stmts.push(this.db.prepare(`
        INSERT INTO journal_lines(id,journal_entry_id,account_code,account_name,debit,credit,memo,line_order)
        VALUES(?,?,?,?,?,?,?,?)
      `).bind(generateId(), jeId, l.code, l.name, toDollars(l.debitCents), toDollars(l.creditCents), l.memo, i + 1));
    }

    stmts.push(this.db.prepare(`
      INSERT INTO audit_log(entity_type,entity_id,action,before_state,after_state,performed_at)
      VALUES('ledger_entries',?,?,?,?,datetime('now'))
    `).bind(
      ledgerEntryId,
      'UPDATE_AND_APPROVE',
      JSON.stringify({ status: existing.status, amount: existing.amount, entity: existing.entity }),
      JSON.stringify({ status: 'APPROVED', amount: total, entity, corrections })
    ));

    await this.db.batch(stmts);

    return { isBalanced, itcFlags };
  }

  async approveLedgerEntry(id: string, approvedBy = 'user'): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE ledger_entries SET status='APPROVED',approved_at=datetime('now'),approved_by=? WHERE id=?").bind(approvedBy, id),
      this.db.prepare("UPDATE journal_entries SET status='APPROVED',approved_at=datetime('now'),approved_by=? WHERE ledger_entry_id=?").bind(approvedBy, id),
      this.db.prepare("INSERT INTO audit_log(entity_type,entity_id,action,after_state,performed_at) VALUES('ledger_entries',?,?,?,datetime('now'))").bind(id, 'APPROVE', JSON.stringify({ status: 'APPROVED' })),
    ]);
  }

  async getLedgerEntries(filter: { runId?: string; dateFilter?: string; entryType?: string; status?: string; limit?: number; offset?: number }): Promise<LedgerEntryRow[]> {
    let q = 'SELECT * FROM ledger_entries WHERE 1=1';
    const p: unknown[] = [];
    if (filter.runId)     { q += ' AND run_id=?';    p.push(filter.runId); }
    if (filter.dateFilter === 'today') q += " AND date(created_at)=date('now')";
    if (filter.entryType) { q += ' AND entry_type=?'; p.push(filter.entryType); }
    if (filter.status)    { q += ' AND status=?';    p.push(filter.status); }
    q += ' ORDER BY created_at DESC';
    q += ` LIMIT ${filter.limit ?? 100} OFFSET ${filter.offset ?? 0}`;
    const r = await this.db.prepare(q).bind(...p).all();
    return (r.results as unknown as LedgerEntryRow[]);
  }

  async getJournalEntries(filter: { runId?: string; dateFilter?: string; entryType?: string; status?: string }): Promise<JournalEntryRow[]> {
    let q = `
      SELECT je.*,le.run_id,le.entry_type,le.entity,le.status as ledger_status
      FROM journal_entries je
      JOIN ledger_entries le ON je.ledger_entry_id=le.id
      WHERE 1=1
    `;
    const p: unknown[] = [];
    if (filter.runId)     { q += ' AND le.run_id=?';     p.push(filter.runId); }
    if (filter.dateFilter === 'today') q += " AND date(je.created_at)=date('now')";
    if (filter.entryType) { q += ' AND le.entry_type=?'; p.push(filter.entryType); }
    if (filter.status)    { q += ' AND je.status=?';     p.push(filter.status); }
    q += ' ORDER BY je.created_at DESC LIMIT 200';
    const r = await this.db.prepare(q).bind(...p).all();
    const entries = r.results as unknown as JournalEntryRow[];
    for (const e of entries) {
      const linesResult = await this.db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id=? ORDER BY line_order').bind(e.id).all();
      e.lines = linesResult.results as unknown as JournalLineRow[];
    }
    return entries;
  }

  async getRunningTotal(runId?: string): Promise<number> {
    const q = runId
      ? "SELECT SUM(amount) as t FROM ledger_entries WHERE entry_type IN ('RECEIPT','INVOICE') AND run_id=?"
      : "SELECT SUM(amount) as t FROM ledger_entries WHERE entry_type IN ('RECEIPT','INVOICE')";
    const r = runId
      ? await this.db.prepare(q).bind(runId).first()
      : await this.db.prepare(q).first();
    return (r as any)?.t ?? 0;
  }

  async getLedgerEntryById(id: string): Promise<LedgerEntryRow | null> {
    const r = await this.db.prepare('SELECT * FROM ledger_entries WHERE id=?').bind(id).first();
    return r as LedgerEntryRow | null;
  }
}
