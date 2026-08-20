/**
 * db-harness.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Runtime test harness: real SQLite via better-sqlite3.
 *
 * WHY better-sqlite3 AND NOT MOCKS:
 *   Cloudflare D1 uses SQLite under the hood with the same dialect.
 *   better-sqlite3 runs the identical SQL. All INSERT, SELECT, UPDATE,
 *   JOIN, aggregate, and constraint logic executes for real.
 *
 * WHY NOT THE ACTUAL D1 INSTANCE:
 *   D1 access requires `wrangler d1 execute` with Cloudflare credentials.
 *   That is HUMAN GATE 1 (see docs/mission-001-status.md).
 *   These tests are: RUNTIME VERIFIED (SQLite) / D1-PENDING (Cloudflare).
 *
 * ISOLATION:
 *   Each test suite calls createTestDb() which returns a fresh in-memory
 *   database with schema + migrations applied. No test pollutes another.
 *
 * D1 ADAPTER:
 *   The D1Database interface is emulated by D1Adapter below.
 *   It wraps better-sqlite3 to match the D1 API:
 *     .prepare(sql).bind(...args).run()
 *     .prepare(sql).bind(...args).first()
 *     .prepare(sql).bind(...args).all()
 *     .batch(statements)
 *   The adapter is interface-compatible with the production D1Database type.
 *
 * INSTALL:
 *   cd worker
 *   npm install --save-dev better-sqlite3 @types/better-sqlite3
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../../db/schema.sql');
const MIGRATION_002_PATH = join(__dirname, '../../db/migrations/002_refunds_splits.sql');

function readSql(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`Cannot read SQL file: ${path}`);
  }
}

/**
 * D1-compatible adapter wrapping better-sqlite3.
 * Implements the subset of D1Database API used by RefundService and SplitService.
 */
export class D1Adapter {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  prepare(sql: string): D1PreparedStatementAdapter {
    return new D1PreparedStatementAdapter(this.db, sql);
  }

  /**
   * D1 batch(): executes all statements in a single transaction.
   * If any statement throws, the entire transaction is rolled back.
   */
  async batch(statements: D1PreparedStatementAdapter[]): Promise<void> {
    const txn = this.db.transaction(() => {
      for (const stmt of statements) {
        stmt.runSync();
      }
    });
    txn();
  }
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

  /** Used internally by batch() */
  runSync(): void {
    this.db.prepare(this.sql).run(...(this.args as any[]));
  }

  async run(): Promise<{ success: boolean }> {
    try {
      this.db.prepare(this.sql).run(...(this.args as any[]));
      return { success: true };
    } catch (err: any) {
      throw new Error(`D1Adapter.run failed: ${err.message}\nSQL: ${this.sql}`);
    }
  }

  async first(): Promise<Record<string, unknown> | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...(this.args as any[]));
    return (row ?? null) as Record<string, unknown> | null;
  }

  async all(): Promise<{ results: Record<string, unknown>[] }> {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...(this.args as any[]));
    return { results: rows as Record<string, unknown>[] };
  }
}

/**
 * Create a fresh in-memory SQLite database with full schema and migrations applied.
 * Safe to call once per test suite; each call returns an independent database.
 */
export function createTestDb(): D1Adapter {
  const raw = new Database(':memory:');
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  // Apply schema (split on semicolons, skip empty statements)
  const schema = readSql(SCHEMA_PATH);
  const schemaStatements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  for (const stmt of schemaStatements) {
    try {
      raw.prepare(stmt).run();
    } catch (err: any) {
      // Ignore "already exists" errors from IF NOT EXISTS clauses
      if (!err.message.includes('already exists')) throw err;
    }
  }

  // Apply migration 002 (refunds + splits)
  const migration002 = readSql(MIGRATION_002_PATH);
  const m002Statements = migration002
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  for (const stmt of m002Statements) {
    try {
      raw.prepare(stmt).run();
    } catch (err: any) {
      if (!err.message.includes('already exists') &&
          !err.message.includes('duplicate column')) {
        throw err;
      }
    }
  }

  return new D1Adapter(raw);
}

// ============================================================
// Test fixture helpers
// ============================================================

import { randomUUID } from 'crypto';

/**
 * Seed a minimal original ledger entry + journal entry + 2 journal lines
 * into the test database. Returns the ledger_entry ID.
 *
 * Simulates what ScanService + LedgerService create for a real scan.
 */
export async function seedOriginalEntry(db: D1Adapter, params: {
  amount: number;          // gross total
  subtotal: number;
  gst: number;
  hst: number;
  pst: number;
  paymentMethod: string;   // 'Cash'|'Debit'|'Credit'
  category: string;
  vendor: string;
  date: string;
  itcRegistered?: boolean;
}): Promise<{
  ledgerEntryId: string;
  journalEntryId: string;
  refNumber: string;
}> {
  const ledgerEntryId = randomUUID();
  const journalEntryId = randomUUID();
  const refNumber = Math.random().toString(16).slice(2, 8).toUpperCase();
  const runId = randomUUID();

  // Create a minimal scan_run
  await db.prepare(`
    INSERT INTO scan_runs (id, document_count, status, created_at)
    VALUES (?, 1, 'COMPLETE', datetime('now'))
  `).bind(runId).run();

  // Create a minimal document
  const documentId = randomUUID();
  await db.prepare(`
    INSERT INTO documents (id, run_id, sequence, status, created_at)
    VALUES (?, ?, 1, 'DONE', datetime('now'))
  `).bind(documentId, runId).run();

  // Create extraction
  const extractionId = randomUUID();
  await db.prepare(`
    INSERT INTO extractions
      (id, document_id, doc_type, vendor, date, total, subtotal,
       tax_gst, tax_hst, tax_pst, payment_method, category,
       confidence_total, gemini_model, extracted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  `).bind(
    extractionId, documentId, 'RECEIPT',
    params.vendor, params.date, params.amount, params.subtotal,
    params.gst, params.hst, params.pst,
    params.paymentMethod, params.category,
    0.95, 'gemini-1.5-flash'
  ).run();

  // Ledger entry
  await db.prepare(`
    INSERT INTO ledger_entries
      (id, run_id, document_id, extraction_id, entry_type, entity, date,
       amount, debit_amount, credit_amount, balance_type, status, ref_number, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  `).bind(
    ledgerEntryId, runId, documentId, extractionId,
    'RECEIPT', params.vendor, params.date,
    params.amount, params.amount, params.amount,
    'DEBIT', 'NEEDS_REVIEW', refNumber
  ).run();

  // Determine accounts based on ITC registration and payment method
  const itcRegistered = params.itcRegistered ?? false;
  const recoverable = params.gst + params.hst;
  const pm = params.paymentMethod.toLowerCase();
  const creditAccount = pm === 'credit' ? '1040'
    : pm === 'debit' ? '1020'
    : '1010';
  const creditAccountName = pm === 'credit' ? 'Credit Card Payable'
    : pm === 'debit' ? 'Bank - Chequing'
    : 'Cash';

  let totalDebits = 0;
  const journalLines: Array<{ code: string; name: string; dr: number; cr: number; memo: string }> = [];

  if (itcRegistered && recoverable > 0) {
    // 3-line: expense + GST recoverable + bank/card
    const expenseDebit = params.subtotal + params.pst;
    journalLines.push({ code: '5010', name: 'Operating Expenses', dr: expenseDebit, cr: 0, memo: `RECEIPT: ${params.vendor}` });
    journalLines.push({ code: '1310', name: 'GST/HST Recoverable', dr: recoverable, cr: 0, memo: 'ITC' });
    journalLines.push({ code: creditAccount, name: creditAccountName, dr: 0, cr: params.amount, memo: `Payment: ${params.paymentMethod}` });
    totalDebits = expenseDebit + recoverable;
  } else {
    // 2-line: full expense + bank/card
    journalLines.push({ code: '5010', name: 'Operating Expenses', dr: params.amount, cr: 0, memo: `RECEIPT: ${params.vendor}` });
    journalLines.push({ code: creditAccount, name: creditAccountName, dr: 0, cr: params.amount, memo: `Payment: ${params.paymentMethod}` });
    totalDebits = params.amount;
  }

  // Journal entry
  await db.prepare(`
    INSERT INTO journal_entries
      (id, ledger_entry_id, entry_date, description, doc_type,
       status, is_balanced, total_debits, total_credits, ref_number, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
  `).bind(
    journalEntryId, ledgerEntryId, params.date,
    `RECEIPT: ${params.vendor}`, 'RECEIPT',
    'DRAFT', 1, totalDebits, params.amount, refNumber
  ).run();

  // Journal lines
  for (let i = 0; i < journalLines.length; i++) {
    const line = journalLines[i]!;
    await db.prepare(`
      INSERT INTO journal_lines
        (id, journal_entry_id, account_code, account_name, debit, credit, memo, line_order)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      randomUUID(), journalEntryId,
      line.code, line.name, line.dr, line.cr, line.memo, i + 1
    ).run();
  }

  return { ledgerEntryId, journalEntryId, refNumber };
}

/**
 * Assert journal balance: SUM(DR) === SUM(CR) in a given journal entry.
 * Returns { balanced, totalDebits, totalCredits, diffCents }
 */
export async function assertJournalBalance(db: D1Adapter, journalEntryId: string): Promise<{
  balanced: boolean;
  totalDebits: number;
  totalCredits: number;
  diffCents: number;
  lineCount: number;
}> {
  const result = await db.prepare(`
    SELECT
      SUM(debit) as total_debits,
      SUM(credit) as total_credits,
      COUNT(*) as line_count
    FROM journal_lines
    WHERE journal_entry_id = ?
  `).bind(journalEntryId).first() as any;

  const totalDebits = result?.total_debits ?? 0;
  const totalCredits = result?.total_credits ?? 0;
  const lineCount = result?.line_count ?? 0;
  const diffCents = Math.round((totalDebits - totalCredits) * 100);

  return {
    balanced: Math.abs(diffCents) <= 1,
    totalDebits,
    totalCredits,
    diffCents,
    lineCount,
  };
}

/**
 * Read all journal lines for a journal entry, ordered by line_order.
 */
export async function getJournalLines(db: D1Adapter, journalEntryId: string) {
  const result = await db.prepare(
    'SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_order'
  ).bind(journalEntryId).all();
  return result.results;
}

/**
 * Get ledger entry by ID.
 */
export async function getLedgerEntry(db: D1Adapter, id: string) {
  return db.prepare('SELECT * FROM ledger_entries WHERE id = ?').bind(id).first();
}

/**
 * Get last audit log entry for an entity.
 */
export async function getLastAuditEntry(db: D1Adapter, entityId: string) {
  return db.prepare(
    'SELECT * FROM audit_log WHERE entity_id = ? ORDER BY performed_at DESC LIMIT 1'
  ).bind(entityId).first();
}

/**
 * Count rows in a table matching a condition.
 */
export async function countRows(
  db: D1Adapter,
  table: string,
  condition: string,
  ...args: unknown[]
): Promise<number> {
  const result = await db.prepare(
    `SELECT COUNT(*) as cnt FROM ${table} WHERE ${condition}`
  ).bind(...args).first() as any;
  return result?.cnt ?? 0;
}
