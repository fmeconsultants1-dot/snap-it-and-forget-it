/**
 * APARService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Accounts Payable (AP): money owed to vendors (from INVOICE extractions)
 * Accounts Receivable (AR): money owed to the business (from INVOICE where issuer = self)
 *
 * AP Aging buckets: Current / 30 days / 60 days / 90+ days
 */

export interface APEntry {
  ledger_entry_id: string;
  vendor: string;
  invoice_date: string;
  amount: number;
  status: string;
  days_outstanding: number;
  aging_bucket: 'current' | '30' | '60' | '90+';
}

export interface APSummary {
  total_outstanding: number;
  current: number;
  days_30: number;
  days_60: number;
  days_90plus: number;
  entries: APEntry[];
}

export class APARService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getAPSummary(): Promise<APSummary> {
    const result = await this.db.prepare(`
      SELECT
        le.id as ledger_entry_id,
        le.entity as vendor,
        le.date as invoice_date,
        le.amount,
        le.status,
        julianday('now') - julianday(le.date) as days_outstanding
      FROM ledger_entries le
      WHERE le.entry_type = 'INVOICE'
        AND le.status IN ('NEEDS_REVIEW', 'APPROVED')
      ORDER BY le.date ASC
    `).all();

    const rows = result.results as any[];
    const entries: APEntry[] = rows.map(r => {
      const days = Math.floor(r.days_outstanding ?? 0);
      let aging_bucket: APEntry['aging_bucket'] = 'current';
      if (days > 90) aging_bucket = '90+';
      else if (days > 60) aging_bucket = '60';
      else if (days > 30) aging_bucket = '30';

      return {
        ledger_entry_id: r.ledger_entry_id,
        vendor: r.vendor ?? 'Unknown',
        invoice_date: r.invoice_date ?? '',
        amount: r.amount ?? 0,
        status: r.status,
        days_outstanding: days,
        aging_bucket,
      };
    });

    const total_outstanding = entries.reduce((s, e) => s + e.amount, 0);
    const current = entries.filter(e => e.aging_bucket === 'current').reduce((s, e) => s + e.amount, 0);
    const days_30 = entries.filter(e => e.aging_bucket === '30').reduce((s, e) => s + e.amount, 0);
    const days_60 = entries.filter(e => e.aging_bucket === '60').reduce((s, e) => s + e.amount, 0);
    const days_90plus = entries.filter(e => e.aging_bucket === '90+').reduce((s, e) => s + e.amount, 0);

    return {
      total_outstanding: Math.round(total_outstanding * 100) / 100,
      current: Math.round(current * 100) / 100,
      days_30: Math.round(days_30 * 100) / 100,
      days_60: Math.round(days_60 * 100) / 100,
      days_90plus: Math.round(days_90plus * 100) / 100,
      entries,
    };
  }
}
