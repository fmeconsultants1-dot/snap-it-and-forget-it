/**
 * GSTService.ts - FME Mission 001 - Snap It & Forget It
 *
 * Canadian tax tracking: GST / HST / PST / QST
 *
 * CRITICAL RULES:
 * 1. ITC is NOT created merely because GST/HST text was detected.
 * 2. ITC requires: registered status + eligible use + sufficient evidence + date + doc type.
 * 3. PST is INDEPENDENT from GST/HST. Never recoverable. Tracked separately.
 * 4. Tax rules are CONFIGURABLE and EFFECTIVE-DATE VERSIONED.
 */

// ---- Tax rule sets (effective-date versioned) ----

export interface TaxRuleSet {
  effective_from: string;
  effective_to: string | null;
  gst_rate: number;
  province: string;
  hst_rate: number | null;
  pst_rate: number | null;
  qst_rate: number | null;
  itc_eligible_categories: string[] | 'ALL' | null;
}

const DEFAULT_TAX_RULES: TaxRuleSet[] = [
  { effective_from: '2013-04-01', effective_to: null, gst_rate: 0.05, province: 'BC', hst_rate: null, pst_rate: 0.07, qst_rate: null, itc_eligible_categories: 'ALL' },
  { effective_from: '2010-07-01', effective_to: null, gst_rate: 0, province: 'ON', hst_rate: 0.13, pst_rate: null, qst_rate: null, itc_eligible_categories: 'ALL' },
  { effective_from: '2008-01-01', effective_to: null, gst_rate: 0.05, province: 'UNKNOWN', hst_rate: null, pst_rate: null, qst_rate: null, itc_eligible_categories: null },
];

export function getTaxRules(province: string, onDate: string): TaxRuleSet {
  const applicable = DEFAULT_TAX_RULES
    .filter(r => (r.province === province || r.province === 'UNKNOWN') && r.effective_from <= onDate && (r.effective_to === null || r.effective_to >= onDate))
    .sort((a, b) => {
      if (a.province === province && b.province !== province) return -1;
      if (b.province === province && a.province !== province) return 1;
      return b.effective_from.localeCompare(a.effective_from);
    });
  return applicable[0] ?? DEFAULT_TAX_RULES[DEFAULT_TAX_RULES.length - 1]!;
}

// ---- ITC config (exported for SplitService, LedgerService, tests) ----

export interface ITCConfig {
  itc_registered: boolean;
  registration_number: string | null;
  registration_effective_date: string | null;
  province: string;
  min_confidence_for_itc: number;
}

export const DEFAULT_ITC_CONFIG: ITCConfig = {
  itc_registered: false,
  registration_number: null,
  registration_effective_date: null,
  province: 'BC',
  min_confidence_for_itc: 0.70,
};

// ---- ITC eligibility flags ----

export type ITCFlag =
  | 'ITC_ELIGIBLE'
  | 'ITC_NOT_REGISTERED'
  | 'ITC_DOCUMENTATION_INCOMPLETE'
  | 'ITC_LOW_CONFIDENCE'
  | 'ITC_BEFORE_REGISTRATION_DATE'
  | 'ITC_INELIGIBLE_CATEGORY'
  | 'ITC_PST_NOT_RECOVERABLE'
  | 'ITC_CONFIG_NOT_SET'
  | 'PERSONAL_USE_NOT_ITC_ELIGIBLE';

export interface ITCDetermination {
  eligible: boolean;
  flags: ITCFlag[];
  recoverable_gst: number;
  recoverable_hst: number;
  non_recoverable_pst: number;
  review_required: boolean;
}

// ---- Core ITC determination function ----

export function determineITC(
  extraction: {
    doc_type: string;
    tax_gst: number | null;
    tax_hst: number | null;
    tax_pst: number | null;
    confidence_total: number;
    date: string | null;
    category: string | null;
  },
  config: ITCConfig = DEFAULT_ITC_CONFIG
): ITCDetermination {
  const flags: ITCFlag[] = [];
  const gst = extraction.tax_gst ?? 0;
  const hst = extraction.tax_hst ?? 0;
  const pst = extraction.tax_pst ?? 0;
  const recoverable = gst + hst;

  if (pst > 0) flags.push('ITC_PST_NOT_RECOVERABLE');

  if (!['RECEIPT', 'INVOICE'].includes(extraction.doc_type)) {
    return { eligible: false, flags, recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: pst, review_required: false };
  }

  if (recoverable === 0) {
    return { eligible: false, flags, recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: pst, review_required: false };
  }

  if (!config.itc_registered) {
    flags.push('ITC_NOT_REGISTERED');
    return { eligible: false, flags, recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: pst, review_required: false };
  }

  if (!config.registration_number || !config.registration_effective_date) {
    flags.push('ITC_CONFIG_NOT_SET');
    flags.push('ITC_DOCUMENTATION_INCOMPLETE');
    return { eligible: false, flags, recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: pst, review_required: true };
  }

  if (extraction.date && extraction.date < config.registration_effective_date) {
    flags.push('ITC_BEFORE_REGISTRATION_DATE');
    return { eligible: false, flags, recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: pst, review_required: true };
  }

  if (extraction.confidence_total < config.min_confidence_for_itc) {
    flags.push('ITC_LOW_CONFIDENCE');
    flags.push('ITC_DOCUMENTATION_INCOMPLETE');
    return { eligible: false, flags, recoverable_gst: 0, recoverable_hst: 0, non_recoverable_pst: pst, review_required: true };
  }

  flags.push('ITC_ELIGIBLE');
  return {
    eligible: true, flags,
    recoverable_gst: Math.round(gst * 100) / 100,
    recoverable_hst: Math.round(hst * 100) / 100,
    non_recoverable_pst: Math.round(pst * 100) / 100,
    review_required: false,
  };
}

// ---- Tax summary reporting ----

export interface TaxSummary {
  period_from: string;
  period_to: string;
  province: string;
  itc_registered: boolean;
  total_gst_paid: number;
  total_hst_paid: number;
  total_pst_paid: number;
  total_tax_paid: number;
  itc_eligible_gst: number;
  itc_eligible_hst: number;
  itc_pending_review: number;
  non_recoverable_pst: number;
  entry_count: number;
  flagged_count: number;
  by_category: Record<string, { count: number; subtotal: number; gst: number; hst: number; pst: number }>;
}

export class GSTService {
  private db: D1Database;
  private itcConfig: ITCConfig;

  constructor(db: D1Database, itcConfig: ITCConfig = DEFAULT_ITC_CONFIG) {
    this.db = db;
    this.itcConfig = itcConfig;
  }

  async getTaxSummary(params: { dateFrom: string; dateTo: string }): Promise<TaxSummary> {
    const result = await this.db.prepare(`
      SELECT e.tax_gst, e.tax_hst, e.tax_pst, e.subtotal, e.category,
             e.doc_type, e.confidence_total, e.date, le.entry_type, le.review_note
      FROM extractions e
      JOIN documents d ON e.document_id = d.id
      JOIN ledger_entries le ON le.document_id = d.id
      WHERE le.date >= ? AND le.date <= ? AND le.status != 'REJECTED'
    `).bind(params.dateFrom, params.dateTo).all();

    const rows = result.results as any[];
    let total_gst_paid = 0, total_hst_paid = 0, total_pst_paid = 0;
    let itc_eligible_gst = 0, itc_eligible_hst = 0, itc_pending_review = 0;
    let flagged_count = 0;
    const by_category: TaxSummary['by_category'] = {};

    for (const row of rows) {
      const gst = row.tax_gst ?? 0;
      const hst = row.tax_hst ?? 0;
      const pst = row.tax_pst ?? 0;
      total_gst_paid += gst; total_hst_paid += hst; total_pst_paid += pst;

      const itc = determineITC({
        doc_type: row.doc_type, tax_gst: gst, tax_hst: hst, tax_pst: pst,
        confidence_total: row.confidence_total ?? 0, date: row.date ?? null, category: row.category ?? null,
      }, this.itcConfig);

      if (itc.eligible) {
        itc_eligible_gst += itc.recoverable_gst;
        itc_eligible_hst += itc.recoverable_hst;
      } else if (itc.review_required) {
        itc_pending_review += gst + hst;
        flagged_count++;
      }

      const cat = row.category ?? 'Other';
      if (!by_category[cat]) by_category[cat] = { count: 0, subtotal: 0, gst: 0, hst: 0, pst: 0 };
      by_category[cat].count++;
      by_category[cat].subtotal += row.subtotal ?? 0;
      by_category[cat].gst += gst;
      by_category[cat].hst += hst;
      by_category[cat].pst += pst;
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      period_from: params.dateFrom, period_to: params.dateTo,
      province: this.itcConfig.province, itc_registered: this.itcConfig.itc_registered,
      total_gst_paid: r2(total_gst_paid), total_hst_paid: r2(total_hst_paid),
      total_pst_paid: r2(total_pst_paid),
      total_tax_paid: r2(total_gst_paid + total_hst_paid + total_pst_paid),
      itc_eligible_gst: r2(itc_eligible_gst), itc_eligible_hst: r2(itc_eligible_hst),
      itc_pending_review: r2(itc_pending_review), non_recoverable_pst: r2(total_pst_paid),
      entry_count: rows.length, flagged_count, by_category,
    };
  }
}
