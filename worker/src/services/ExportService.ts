/**
 * ExportService.ts - FME Mission 001 - Snap It & Forget It
 * Accountant-ready exports: ledger CSV, journal CSV, full JSON.
 * Includes REFUND and CREDIT_NOTE entry types.
 */

export class ExportService {
  private db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async exportLedgerCSV(params: { dateFrom?: string; dateTo?: string; status?: string }): Promise<string> {
    let query = 'SELECT * FROM ledger_entries WHERE 1=1';
    const binds: unknown[] = [];
    if (params.dateFrom) { query += ' AND date >= ?'; binds.push(params.dateFrom); }
    if (params.dateTo)   { query += ' AND date <= ?'; binds.push(params.dateTo); }
    if (params.status)   { query += ' AND status = ?'; binds.push(params.status); }
    query += ' ORDER BY date ASC, created_at ASC';
    const result = await this.db.prepare(query).bind(...binds).all();
    const rows = result.results as any[];
    const header = 'ref_number,date,entity,entry_type,amount,debit_amount,credit_amount,balance_type,status,reversal_of,refund_type,created_at\n';
    const lines = rows.map(r => [
      r.ref_number ?? '',
      r.date ?? '',
      `"${(r.entity ?? '').replace(/"/g, '""')}"`,
      r.entry_type,
      r.amount,
      r.debit_amount,
      r.credit_amount,
      r.balance_type,
      r.status,
      r.reversal_of ?? '',
      r.refund_type ?? '',
      r.created_at,
    ].join(',')).join('\n');
    return header + lines;
  }

  async exportJournalCSV(params: { dateFrom?: string; dateTo?: string }): Promise<string> {
    let query = `
      SELECT je.ref_number, je.entry_date, le.entity, je.doc_type, je.status,
             je.is_balanced, je.total_debits, je.total_credits,
             jl.account_code, jl.account_name, jl.debit, jl.credit, jl.memo
      FROM journal_entries je
      JOIN ledger_entries le ON je.ledger_entry_id = le.id
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      WHERE 1=1
    `;
    const binds: unknown[] = [];
    if (params.dateFrom) { query += ' AND je.entry_date >= ?'; binds.push(params.dateFrom); }
    if (params.dateTo)   { query += ' AND je.entry_date <= ?'; binds.push(params.dateTo); }
    query += ' ORDER BY je.entry_date ASC, je.ref_number, jl.line_order';
    const result = await this.db.prepare(query).bind(...binds).all();
    const rows = result.results as any[];
    const header = 'ref_number,date,entity,doc_type,status,is_balanced,total_debits,total_credits,account_code,account_name,debit,credit,memo\n';
    const lines = rows.map(r => [
      r.ref_number ?? '',
      r.entry_date ?? '',
      `"${(r.entity ?? '').replace(/"/g, '""')}"`,
      r.doc_type ?? '',
      r.status ?? '',
      r.is_balanced,
      r.total_debits,
      r.total_credits,
      r.account_code ?? '',
      `"${(r.account_name ?? '').replace(/"/g, '""')}"`,
      r.debit,
      r.credit,
      `"${(r.memo ?? '').replace(/"/g, '""')}"`,
    ].join(',')).join('\n');
    return header + lines;
  }

  async exportJSON(params: { dateFrom?: string; dateTo?: string }): Promise<object> {
    const [ledger, extractions, refunds, splits] = await Promise.all([
      this.db.prepare('SELECT * FROM ledger_entries ORDER BY date ASC').all(),
      this.db.prepare('SELECT * FROM extractions ORDER BY extracted_at ASC').all(),
      this.db.prepare("SELECT * FROM ledger_entries WHERE entry_type='REFUND' ORDER BY created_at ASC").all(),
      this.db.prepare('SELECT * FROM split_lines ORDER BY created_at ASC').all(),
    ]);
    return {
      exported_at: new Date().toISOString(),
      ledger_entries: ledger.results,
      extractions: extractions.results,
      refunds: refunds.results,
      split_lines: splits.results,
    };
  }
}
