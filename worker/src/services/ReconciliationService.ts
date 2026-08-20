/**
 * ReconciliationService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Matches bank/card CSV import rows against existing ledger entries.
 * A match is: same amount (within $0.01) AND same date.
 * Marks both the bank_import row and the ledger_entry as RECONCILED.
 */

export class ReconciliationService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async reconcileAll(): Promise<{
    matched: number;
    unmatched: number;
    details: Array<{ bankImportId: string; ledgerEntryId: string; amount: number; date: string }>;
  }> {
    // Get all unreconciled bank imports
    const imports = await this.db.prepare(
      'SELECT * FROM bank_imports WHERE reconciled=0 ORDER BY transaction_date'
    ).all();

    const details: Array<{ bankImportId: string; ledgerEntryId: string; amount: number; date: string }> = [];
    let matched = 0;
    let unmatched = 0;

    for (const imp of imports.results as any[]) {
      // Find matching ledger entry: same date, same amount (within 1 cent)
      const match = await this.db.prepare(`
        SELECT id, amount, date FROM ledger_entries
        WHERE date = ?
          AND ABS(amount - ?) < 0.01
          AND status != 'RECONCILED'
        LIMIT 1
      `).bind(imp.transaction_date, Math.abs(imp.amount)).first() as any;

      if (match) {
        // Mark bank import reconciled
        await this.db.prepare(`
          UPDATE bank_imports
          SET reconciled=1, matched_ledger_entry_id=?
          WHERE id=?
        `).bind(match.id, imp.id).run();

        // Mark ledger entry reconciled
        await this.db.prepare(`
          UPDATE ledger_entries SET status='RECONCILED' WHERE id=?
        `).bind(match.id).run();

        // Audit
        await this.db.prepare(`
          INSERT INTO audit_log (entity_type, entity_id, action, after_state, performed_at)
          VALUES ('ledger_entries', ?, 'RECONCILE', ?, datetime('now'))
        `).bind(match.id, JSON.stringify({ bank_import_id: imp.id, amount: match.amount })).run();

        details.push({
          bankImportId: imp.id,
          ledgerEntryId: match.id,
          amount: match.amount,
          date: imp.transaction_date,
        });
        matched++;
      } else {
        unmatched++;
      }
    }

    return { matched, unmatched, details };
  }

  async getMissingReceipts(): Promise<any[]> {
    // Bank imports with no matching ledger entry
    const result = await this.db.prepare(`
      SELECT * FROM bank_imports
      WHERE reconciled=0
      ORDER BY transaction_date DESC
      LIMIT 100
    `).all();
    return result.results;
  }
}
