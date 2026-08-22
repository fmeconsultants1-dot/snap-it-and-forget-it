/**
 * db-harness.ts - FME Mission 001
 * Real SQLite runtime harness (D1-identical dialect).
 * STATUS: SQLITE RUNTIME VERIFIED / D1 PENDING (Human Gate 1)
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH    = join(__dirname, '../../db/schema.sql');
const MIGRATION_002  = join(__dirname, '../../db/migrations/002_refunds_splits.sql');

function readSql(path: string): string {
  try { return readFileSync(path, 'utf-8'); }
  catch { throw new Error(`Cannot read SQL file: ${path}`); }
}

export class D1PreparedStatementAdapter {
  private db: Database.Database;
  private sql: string;
  private args: unknown[] = [];

  constructor(db: Database.Database, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  runSync(): void {
    this.db.prepare(this.sql).run(...(this.args as any[]));
  }

  async run(): Promise<{ success: boolean }> {
    try { this.db.prepare(this.sql).run(...(this.args as any[])); return { success: true }; }
    catch (e: any) { throw new Error(`D1.run failed: ${e.message}\nSQL: ${this.sql}`); }
  }

  async first(): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare(this.sql).get(...(this.args as any[]));
    return (row ?? null) as Record<string, unknown> | null;
  }

  async all(): Promise<{ results: Record<string, unknown>[] }> {
    const rows = this.db.prepare(this.sql).all(...(this.args as any[]));
    return { results: rows as Record<string, unknown>[] };
  }
}

export class D1Adapter {
  private raw: Database.Database;

  constructor(raw: Database.Database) { this.raw = raw; }

  prepare(sql: string): D1PreparedStatementAdapter {
    return new D1PreparedStatementAdapter(this.raw, sql);
  }

  // Accepts both D1PreparedStatementAdapter[] and D1PreparedStatement[] (same duck type)
  async batch(statements: D1PreparedStatementAdapter[]): Promise<void> {
    const txn = this.raw.transaction(() => {
      for (const stmt of statements) { stmt.runSync(); }
    });
    txn();
  }
}

export function createTestDb(): D1Adapter {
  const raw = new Database(':memory:');
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const runSql = (sql: string) => {
    const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    for (const stmt of stmts) {
      try { raw.prepare(stmt).run(); }
      catch (e: any) {
        // Ignore known idempotent errors
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) throw e;
      }
    }
  };

  runSql(readSql(SCHEMA_PATH));
  runSql(readSql(MIGRATION_002));

  return new D1Adapter(raw);
}

// ---- Seed helper ----
export async function seedOriginalEntry(db: D1Adapter, params: {
  amount: number; subtotal: number; gst: number; hst: number; pst: number;
  paymentMethod: string; category: string; vendor: string; date: string;
  itcRegistered?: boolean;
}): Promise<{ ledgerEntryId: string; journalEntryId: string; refNumber: string }> {
  const leId = randomUUID();
  const jeId = randomUUID();
  const refNumber = Math.random().toString(16).slice(2, 8).toUpperCase();
  const runId = randomUUID();
  const documentId = randomUUID();
  const extractionId = randomUUID();

  await db.prepare("INSERT INTO scan_runs (id,document_count,status,created_at) VALUES (?,1,'COMPLETE',datetime('now'))").bind(runId).run();
  await db.prepare("INSERT INTO documents (id,run_id,sequence,status,created_at) VALUES (?,?,1,'DONE',datetime('now'))").bind(documentId, runId).run();
  await db.prepare(`INSERT INTO extractions (id,document_id,doc_type,vendor,date,total,subtotal,tax_gst,tax_hst,tax_pst,payment_method,category,confidence_total,gemini_model,extracted_at) VALUES (?,?,'RECEIPT',?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(extractionId, documentId, params.vendor, params.date, params.amount, params.subtotal, params.gst, params.hst, params.pst, params.paymentMethod, params.category, 0.95, 'gemini-2.0-flash').run();

  const itcRegistered = params.itcRegistered ?? false;
  const recoverable = params.gst + params.hst;
  const pm = params.paymentMethod.toLowerCase();
  const creditAccount = pm === 'credit' ? '1040' : pm === 'debit' ? '1020' : '1010';
  const creditAccountName = pm === 'credit' ? 'Credit Card Payable' : pm === 'debit' ? 'Bank - Chequing' : 'Cash';

  await db.prepare(`INSERT INTO ledger_entries (id,run_id,document_id,extraction_id,entry_type,entity,date,amount,debit_amount,credit_amount,balance_type,status,ref_number,created_at) VALUES (?,?,?,?,'RECEIPT',?,?,?,?,?,'DEBIT','NEEDS_REVIEW',?,datetime('now'))`).bind(leId, runId, documentId, extractionId, params.vendor, params.date, params.amount, params.amount, params.amount, refNumber).run();

  let totalDebits: number;
  const journalLines: Array<{ code: string; name: string; dr: number; cr: number; memo: string }> = [];

  if (itcRegistered && recoverable > 0) {
    const expenseDebit = params.subtotal + params.pst;
    journalLines.push({ code: '5010', name: 'Operating Expenses', dr: expenseDebit, cr: 0, memo: `RECEIPT: ${params.vendor}` });
    journalLines.push({ code: '1310', name: 'GST/HST Recoverable', dr: recoverable, cr: 0, memo: 'ITC' });
    journalLines.push({ code: creditAccount, name: creditAccountName, dr: 0, cr: params.amount, memo: `Payment: ${params.paymentMethod}` });
    totalDebits = expenseDebit + recoverable;
  } else {
    journalLines.push({ code: '5010', name: 'Operating Expenses', dr: params.amount, cr: 0, memo: `RECEIPT: ${params.vendor}` });
    journalLines.push({ code: creditAccount, name: creditAccountName, dr: 0, cr: params.amount, memo: `Payment: ${params.paymentMethod}` });
    totalDebits = params.amount;
  }

  await db.prepare(`INSERT INTO journal_entries (id,ledger_entry_id,entry_date,description,doc_type,status,is_balanced,total_debits,total_credits,ref_number,created_at) VALUES (?,?,?,?,'RECEIPT','DRAFT',1,?,?,?,datetime('now'))`).bind(jeId, leId, params.date, `RECEIPT: ${params.vendor}`, totalDebits, params.amount, refNumber).run();

  for (let i = 0; i < journalLines.length; i++) {
    const l = journalLines[i]!;
    await db.prepare(`INSERT INTO journal_lines (id,journal_entry_id,account_code,account_name,debit,credit,memo,line_order) VALUES (?,?,?,?,?,?,?,?)`).bind(randomUUID(), jeId, l.code, l.name, l.dr, l.cr, l.memo, i + 1).run();
  }

  return { ledgerEntryId: leId, journalEntryId: jeId, refNumber };
}

// ---- Assertion helpers ----
export async function assertJournalBalance(db: D1Adapter, journalEntryId: string) {
  const r = await db.prepare('SELECT SUM(debit) as total_debits, SUM(credit) as total_credits, COUNT(*) as line_count FROM journal_lines WHERE journal_entry_id=?').bind(journalEntryId).first() as any;
  const totalDebits = r?.total_debits ?? 0;
  const totalCredits = r?.total_credits ?? 0;
  const lineCount = r?.line_count ?? 0;
  const diffCents = Math.round((totalDebits - totalCredits) * 100);
  return { balanced: Math.abs(diffCents) <= 1, totalDebits, totalCredits, diffCents, lineCount };
}

export async function getJournalLines(db: D1Adapter, journalEntryId: string) {
  const r = await db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id=? ORDER BY line_order').bind(journalEntryId).all();
  return r.results;
}

export async function getLedgerEntry(db: D1Adapter, id: string) {
  return db.prepare('SELECT * FROM ledger_entries WHERE id=?').bind(id).first();
}

export async function getLastAuditEntry(db: D1Adapter, entityId: string) {
  return db.prepare('SELECT * FROM audit_log WHERE entity_id=? ORDER BY performed_at DESC LIMIT 1').bind(entityId).first();
}

export async function countRows(db: D1Adapter, table: string, condition: string, ...args: unknown[]): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${condition}`).bind(...args).first() as any;
  return r?.cnt ?? 0;
}
