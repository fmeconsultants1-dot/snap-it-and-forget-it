/**
 * WatchdogService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Health monitoring for the Snap It system.
 * Detects:
 *   - Stuck scan runs (PROCESSING > 10 minutes)
 *   - Failed documents with no error logged
 *   - Unbalanced journal entries
 *   - Missing ledger entries for completed docs
 */

export interface HealthReport {
  status: 'ok' | 'degraded' | 'critical';
  db: boolean;
  r2: boolean;
  gemini_configured: boolean;
  stuck_runs: number;
  failed_docs: number;
  unbalanced_entries: number;
  missing_ledger_entries: number;
  issues: string[];
  checked_at: string;
}

export class WatchdogService {
  private db: D1Database;
  private r2: R2Bucket;
  private geminiApiKey: string;

  constructor(db: D1Database, r2: R2Bucket, geminiApiKey: string) {
    this.db = db;
    this.r2 = r2;
    this.geminiApiKey = geminiApiKey;
  }

  async check(): Promise<HealthReport> {
    const issues: string[] = [];
    let dbOk = false;
    let r2Ok = false;

    // D1 health
    try {
      await this.db.prepare('SELECT 1').first();
      dbOk = true;
    } catch {
      issues.push('D1 database unreachable');
    }

    // R2 health (list returns no error if bucket accessible)
    try {
      await this.r2.list({ limit: 1 });
      r2Ok = true;
    } catch {
      issues.push('R2 bucket unreachable');
    }

    // Stuck runs: PROCESSING for > 10 minutes
    let stuckRuns = 0;
    if (dbOk) {
      const stuck = await this.db.prepare(`
        SELECT COUNT(*) as cnt FROM scan_runs
        WHERE status = 'PROCESSING'
          AND created_at < datetime('now', '-10 minutes')
      `).first() as any;
      stuckRuns = stuck?.cnt ?? 0;
      if (stuckRuns > 0) issues.push(`${stuckRuns} stuck scan run(s)`);
    }

    // Failed docs
    let failedDocs = 0;
    if (dbOk) {
      const failed = await this.db.prepare(
        "SELECT COUNT(*) as cnt FROM documents WHERE status='FAILED'"
      ).first() as any;
      failedDocs = failed?.cnt ?? 0;
    }

    // Unbalanced journal entries
    let unbalanced = 0;
    if (dbOk) {
      const ub = await this.db.prepare(
        'SELECT COUNT(*) as cnt FROM journal_entries WHERE is_balanced=0 AND total_debits > 0'
      ).first() as any;
      unbalanced = ub?.cnt ?? 0;
      if (unbalanced > 0) issues.push(`${unbalanced} unbalanced journal entry/entries`);
    }

    // Missing ledger entries: docs with status DONE but no ledger_entry
    let missingLedger = 0;
    if (dbOk) {
      const ml = await this.db.prepare(`
        SELECT COUNT(*) as cnt FROM documents d
        WHERE d.status = 'DONE'
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries le WHERE le.document_id = d.id
          )
      `).first() as any;
      missingLedger = ml?.cnt ?? 0;
      if (missingLedger > 0) issues.push(`${missingLedger} document(s) missing ledger entry`);
    }

    const geminiConfigured = !!this.geminiApiKey;
    if (!geminiConfigured) issues.push('GEMINI_API_KEY not configured');

    let status: HealthReport['status'] = 'ok';
    if (!dbOk || !geminiConfigured || unbalanced > 0) status = 'critical';
    else if (!r2Ok || stuckRuns > 0 || missingLedger > 0) status = 'degraded';

    return {
      status,
      db: dbOk,
      r2: r2Ok,
      gemini_configured: geminiConfigured,
      stuck_runs: stuckRuns,
      failed_docs: failedDocs,
      unbalanced_entries: unbalanced,
      missing_ledger_entries: missingLedger,
      issues,
      checked_at: new Date().toISOString(),
    };
  }
}
