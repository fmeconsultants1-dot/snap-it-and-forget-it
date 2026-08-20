/**
 * GSTService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Canadian tax tracking:
 *   GST: 5% federal (all provinces)
 *   HST: combined federal+provincial (ON 13%, NB/NS/NL/PEI 15%)
 *   PST: provincial only (BC 7%, SK 6%, MB 7%)
 *   QST: Quebec 9.975% (treat as PST slot)
 *
 * Input Tax Credits (ITC): businesses can claim GST/HST paid on expenses.
 * This service:
 *   1. Summarizes tax paid by type (GST, HST, PST)
 *   2. Calculates ITC-eligible amounts (RECEIPT + INVOICE entries)
 *   3. Generates tax period summary for accountant
 */

export interface TaxSummary {
  period_from: string;
  period_to: string;
  total_gst_paid: number;
  total_hst_paid: number;
  total_pst_paid: number;
  total_tax_paid: number;
  itc_eligible_gst_hst: number;   // claimable Input Tax Credits
  non_itc_pst: number;            // PST not reclaimable
  entry_count: number;
  by_category: Record<string, { count: number; subtotal: number; tax: number }>;
}

export class GSTService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getTaxSummary(params: { dateFrom: string; dateTo: string }): Promise<TaxSummary> {
    const result = await this.db.prepare(`
      SELECT
        e.tax_gst,
        e.tax_hst,
        e.tax_pst,
        e.tax,
        e.subtotal,
        e.category,
        e.doc_type,
        le.entry_type,
        le.date
      FROM extractions e
      JOIN documents d ON e.document_id = d.id
      JOIN ledger_entries le ON le.document_id = d.id
      WHERE le.date >= ? AND le.date <= ?
        AND le.status != 'REJECTED'
    `).bind(params.dateFrom, params.dateTo).all();

    const rows = result.results as any[];

    let total_gst_paid = 0;
    let total_hst_paid = 0;
    let total_pst_paid = 0;
    let itc_eligible_gst_hst = 0;
    const by_category: Record<string, { count: number; subtotal: number; tax: number }> = {};

    for (const row of rows) {
      const gst = row.tax_gst ?? 0;
      const hst = row.tax_hst ?? 0;
      const pst = row.tax_pst ?? 0;
      const tax = row.tax ?? (gst + hst + pst);

      total_gst_paid += gst;
      total_hst_paid += hst;
      total_pst_paid += pst;

      // ITC eligible: GST + HST on business expenses (RECEIPT and INVOICE)
      if (['RECEIPT', 'INVOICE'].includes(row.entry_type)) {
        itc_eligible_gst_hst += gst + hst;
      }

      // By category
      const cat = row.category ?? 'Other';
      if (!by_category[cat]) {
        by_category[cat] = { count: 0, subtotal: 0, tax: 0 };
      }
      by_category[cat].count++;
      by_category[cat].subtotal += row.subtotal ?? 0;
      by_category[cat].tax += tax;
    }

    return {
      period_from: params.dateFrom,
      period_to: params.dateTo,
      total_gst_paid: Math.round(total_gst_paid * 100) / 100,
      total_hst_paid: Math.round(total_hst_paid * 100) / 100,
      total_pst_paid: Math.round(total_pst_paid * 100) / 100,
      total_tax_paid: Math.round((total_gst_paid + total_hst_paid + total_pst_paid) * 100) / 100,
      itc_eligible_gst_hst: Math.round(itc_eligible_gst_hst * 100) / 100,
      non_itc_pst: Math.round(total_pst_paid * 100) / 100,
      entry_count: rows.length,
      by_category,
    };
  }
}
