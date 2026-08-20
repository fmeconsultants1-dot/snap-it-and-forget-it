/**
 * LedgerService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Double-entry bookkeeping engine.
 * Evidence baseline from screenshots:
 *   - Account 5010-Operating Expenses (DEBIT)
 *   - Account 1010-Cash (CREDIT)
 *   - ✓ Balanced badge
 *   - Running expense total shown per journal view
 *   - Ref numbers: 6-char hex (#10A631, #9C9B41, #2519DC)
 *   - Status: NEEDS_REVIEW / DRAFT -> APPROVED
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

// Map extraction doc_type + category to debit account
const CATEGORY_ACCOUNT_MAP: Record<string, { code: string; name: string }> = {
  Food:         { code: '5020', name: 'Meals & Entertainment' },
  Transport:    { code: '5030', name: 'Travel' },
  Automotive:   { code: '5040', name: 'Vehicle' },
  Travel:       { code: '5030', name: 'Travel' },
  Office:       { code: '5050', name: 'Office Supplies' },
  Professional: { code: '5060', name: 'Professional Fees' },
  Utilities:    { code: '5070', name: 'Utilities' },
};

const DEFAULT_EXPENSE_ACCOUNT = { code: '5010', name: 'Operating Expenses' };
const CASH_ACCOUNT = { code: '1010', name: 'Cash' };
const CREDIT_CARD_ACCOUNT = { code: '1040', name: 'Credit Card Payable' };

function resolveDebitAccount(extraction: ExtractionResult) {
  if (extraction.category && CATEGORY_ACCOUNT_MAP[extraction.category]) {
    return CATEGORY_ACCOUNT_MAP[extraction.category];
  }
  return DEFAULT_EXPENSE_ACCOUNT;
}

function resolveCreditAccount(extraction: ExtractionResult) {
  const pm = (extraction.payment_method || '').toLowerCase();
  if (pm === 'credit') return CREDIT_CARD_ACCOUNT;
  return CASH_ACCOUNT;
}

function generateRefNumber(): string {
  return Math.random().toString(16).slice(2, 8).toUpperCase();
}

function generateId(): string {
  return crypto.randomUUID();
}

export class LedgerService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Create a complete ledger + journal entry from an extraction.
   * Returns the ledger entry ID and journal entry ID.
   */
  async createFromExtraction(
    extraction: ExtractionResult,
    extractionId: string,
    documentId: string,
    runId: string
  ): Promise<{ ledgerEntryId: string; journalEntryId: string; refNumber: string }> {
    const amount = extraction.total ?? 0;
    const refNumber = generateRefNumber();
    const ledgerEntryId = generateId();
    const journalEntryId = generateId();
    const entryDate = extraction.date ?? new Date().toISOString().slice(0, 10);
    const entity = extraction.vendor ?? extraction.issuer ?? 'Unknown';

    const debitAccount = resolveDebitAccount(extraction);
    const creditAccount = resolveCreditAccount(extraction);

    // Determine balance_type from doc_type
    const balanceType = (extraction.doc_type === 'DOCUMENT' || extraction.doc_type === 'STATEMENT')
      ? 'BALANCE'
      : 'DEBIT';

    // 1. Insert ledger register entry
    await this.db.prepare(`
      INSERT INTO ledger_entries
        (id, run_id, document_id, extraction_id, entry_type, entity, date,
         amount, debit_amount, credit_amount, balance_type, status, ref_number, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(
      ledgerEntryId, runId, documentId, extractionId,
      extraction.doc_type, entity, entryDate,
      amount,
      balanceType === 'DEBIT' ? amount : 0,
      balanceType === 'DEBIT' ? amount : 0,
      balanceType,
      'NEEDS_REVIEW',
      refNumber
    ).run();

    // 2. Insert double-entry journal header
    const isBalanced = amount > 0 ? 1 : 0;
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
      isBalanced,
      amount,
      amount,
      refNumber
    ).run();

    // 3. Insert journal lines
    if (balanceType === 'DEBIT' && amount > 0) {
      // Debit line: expense account
      await this.db.prepare(`
        INSERT INTO journal_lines (id, journal_entry_id, account_code, account_name, debit, credit, memo, line_order)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        generateId(), journalEntryId,
        debitAccount.code, debitAccount.name,
        amount, 0,
        `${extraction.doc_type}: ${entity}`,
        1
      ).run();

      // Credit line: cash/credit card
      await this.db.prepare(`
        INSERT INTO journal_lines (id, journal_entry_id, account_code, account_name, debit, credit, memo, line_order)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(
        generateId(), journalEntryId,
        creditAccount.code, creditAccount.name,
        0, amount,
        `Payment: ${extraction.payment_method ?? 'Cash'}`,
        2
      ).run();
    }

    // 4. Audit trail
    await this.audit('ledger_entries', ledgerEntryId, 'CREATE', null, { status: 'NEEDS_REVIEW', amount });

    return { ledgerEntryId, journalEntryId, refNumber };
  }

  async approveLedgerEntry(ledgerEntryId: string, approvedBy: string = 'user'): Promise<void> {
    const before = await this.db.prepare('SELECT status FROM ledger_entries WHERE id=?').bind(ledgerEntryId).first();
    await this.db.prepare(`
      UPDATE ledger_entries SET status='APPROVED', approved_at=datetime('now'), approved_by=? WHERE id=?
    `).bind(approvedBy, ledgerEntryId).run();
    await this.db.prepare(`
      UPDATE journal_entries SET status='APPROVED', approved_at=datetime('now'), approved_by=? WHERE ledger_entry_id=?
    `).bind(approvedBy, ledgerEntryId).run();
    await this.audit('ledger_entries', ledgerEntryId, 'APPROVE', before, { status: 'APPROVED' });
  }

  async getLedgerEntries(filter: {
    runId?: string;
    dateFilter?: 'today' | 'all' | string;
    entryType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<LedgerEntryRow[]> {
    let query = 'SELECT * FROM ledger_entries WHERE 1=1';
    const params: any[] = [];

    if (filter.runId) {
      query += ' AND run_id=?';
      params.push(filter.runId);
    }
    if (filter.dateFilter === 'today') {
      query += " AND date(created_at) = date('now')";
    }
    if (filter.entryType) {
      query += ' AND entry_type=?';
      params.push(filter.entryType);
    }
    if (filter.status) {
      query += ' AND status=?';
      params.push(filter.status);
    }

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
    const params: any[] = [];

    if (filter.runId) {
      query += ' AND le.run_id=?';
      params.push(filter.runId);
    }
    if (filter.dateFilter === 'today') {
      query += " AND date(je.created_at) = date('now')";
    }
    if (filter.entryType) {
      query += ' AND le.entry_type=?';
      params.push(filter.entryType);
    }
    if (filter.status) {
      query += ' AND je.status=?';
      params.push(filter.status);
    }

    query += ' ORDER BY je.created_at DESC LIMIT 200';
    const result = await this.db.prepare(query).bind(...params).all();
    const entries = result.results as any[];

    // Fetch lines for each entry
    for (const entry of entries) {
      const lines = await this.db.prepare(
        'SELECT * FROM journal_lines WHERE journal_entry_id=? ORDER BY line_order'
      ).bind(entry.id).all();
      entry.lines = lines.results;
    }

    return entries as JournalEntryRow[];
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

  private async audit(entityType: string, entityId: string, action: string, before: any, after: any) {
    await this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, before_state, after_state, performed_at)
      VALUES (?,?,?,?,?,datetime('now'))
    `).bind(
      entityType, entityId, action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after)
    ).run();
  }
}
