/**
 * GSTService.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Canadian tax tracking: GST / HST / PST / QST
 *
 * CRITICAL RULES:
 *
 * 1. ITC (Input Tax Credit) is NOT created merely because GST/HST text
 *    was detected in a document. Detection is NOT eligibility.
 *
 * 2. ITC recovery requires ALL of the following:
 *    a. Business is registered for GST/HST (itc_registered = true)
 *    b. The expense is for eligible business use
 *    c. The document is of appropriate type (RECEIPT or INVOICE)
 *    d. Supporting evidence is sufficient (confidence_total >= 0.70)
 *    e. The transaction occurred after the registration effective date
 *    Missing any condition → flag ITC_DOCUMENTATION_INCOMPLETE → NEEDS_REVIEW
 *
 * 3. PST logic is INDEPENDENT from GST/HST logic:
 *    - PST is NEVER recoverable (non-refundable provincial tax)
 *    - PST rate and applicability vary by province/category
 *    - PST must be tracked separately, not merged with GST/HST
 *
 * 4. Tax rules are CONFIGURABLE and EFFECTIVE-DATE VERSIONED.
 *    Rate changes (e.g., HST rate changes by province) must not be
 *    hardcoded. The tax_config table (future) or TaxRuleSet below
 *    controls all rates and their effective dates.
 *
 * Canadian rates (2024, configurable):
 *   GST:  5.0%  (federal, all provinces)
 *   HST:  ON 13%, NB/NS/NL/PEI 15%
 *   PST:  BC 7%, SK 6%, MB 7%
 *   QST:  QC 9.975% (tracked in pst slot)
 */

// ── Tax rule configuration (effective-date versioned) ─────────────────────

export interface TaxRuleSet {
  effective_from: string;         // ISO date YYYY-MM-DD
  effective_to: string | null;    // null = current
  gst_rate: number;               // e.g. 0.05
  province: string;               // 'BC'|'AB'|'ON'|'QC'|...
  hst_rate: number | null;        // null = province uses GST+PST
  pst_rate: number | null;        // null = no provincial tax
  qst_rate: number | null;        // Quebec only
  itc_eligible_categories: string[] | 'ALL' | null; // null = config not set
}

// Default rule sets (expand from tax_config table in production)
const DEFAULT_TAX_RULES: TaxRuleSet[] = [
  // BC: GST 5% + PST 7%, no HST
  {
    effective_from: '2013-04-01',
    effective_to: null,
    gst_rate: 0.05,
    province: 'BC',
    hst_rate: null,
    pst_rate: 0.07,
    qst_rate: null,
    itc_eligible_categories: 'ALL',
  },
  // Ontario: HST 13%
  {
    effective_from: '2010-07-01',
    effective_to: null,
    gst_rate: 0,
    province: 'ON',
    hst_rate: 0.13,
    pst_rate: null,
    qst_rate: null,
    itc_eligible_categories: 'ALL',
  },
  // Generic federal only (unknown province)
  {
    effective_from: '2008-01-01',
    effective_to: null,
    gst_rate: 0.05,
    province: 'UNKNOWN',
    hst_rate: null,
    pst_rate: null,
    qst_rate: null,
    itc_eligible_categories: null, // Must be configured
  },
];

export function getTaxRules(province: string, onDate: string): TaxRuleSet {
  const applicable = DEFAULT_TAX_RULES
    .filter(r =>
      (r.province === province || r.province === 'UNKNOWN') &&
      r.effective_from <= onDate &&
      (r.effective_to === null || r.effective_to >= onDate)
    )
    .sort((a, b) => {
      // Province-specific rules take priority over UNKNOWN
      if (a.province === province && b.province !== province) return -1;
      if (b.province === province && a.province !== province) return 1;
      return b.effective_from.localeCompare(a.effective_from);
    });
  return applicable[0] ?? DEFAULT_TAX_RULES[DEFAULT_TAX_RULES.length - 1]!;
}

// ── Business registration config ────────────────────────────────────

export interface ITCConfig {
  itc_registered: boolean;
  registration_number: string | null;
  registration_effective_date: string | null;  // ITCs only valid from this date
  province: string;
  min_confidence_for_itc: number;              // Default 0.70
}

const DEFAULT_ITC_CONFIG: ITCConfig = {
  itc_registered: false,           // Conservative default. Must be explicitly enabled.
  registration_number: null,
  registration_effective_date: null,
  province: 'BC',
  min_confidence_for_itc: 0.70,
};

// ── ITC eligibility determination ──────────────────────────────────

export type ITCFlag =
  | 'ITC_ELIGIBLE'
  | 'ITC_NOT_REGISTERED'
  | 'ITC_DOCUMENTATION_INCOMPLETE'
  | 'ITC_LOW_CONFIDENCE'
  | 'ITC_BEFORE_REGISTRATION_DATE'
  | 'ITC_INELIGIBLE_CATEGORY'
  | 'ITC_PST_NOT_RECOVERABLE'
  | 'ITC_CONFIG_NOT_SET';

export interface ITCDetermination {
  eligible: boolean;
  flags: ITCFlag[];
  recoverable_gst: number;
  recoverable_hst: number;
  non_recoverable_pst: number;
  review_required: boolean;
}

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

  // PST is ALWAYS non-recoverable — independent from GST/HST
  if (pst > 0) flags.push('ITC_PST_NOT_RECOVERABLE');

  // Early exit: DOCUMENT/STATEMENT types are not expense transactions
  if (!['RECEIPT', 'INVOICE'].includes(extraction.doc_type)) {
    return {
      eligible: false, flags,
      recoverable_gst: 0, recoverable_hst: 0,
      non_recoverable_pst: pst,
      review_required: false,
    };
  }

  // No tax detected — no ITC question
  if (recoverable === 0) {
    return {
      eligible: false, flags,
      recoverable_gst: 0, recoverable_hst: 0,
      non_recoverable_pst: pst,
      review_required: false,
    };
  }

  // Rule 1: Business must be GST/HST registered
  if (!config.itc_registered) {
    flags.push('ITC_NOT_REGISTERED');
    return {
      eligible: false, flags,
      recoverable_gst: 0, recoverable_hst: 0,
      non_recoverable_pst: pst,
      review_required: false,
    };
  }

  // Rule 2: ITC config must be fully set
  if (!config.registration_number || !config.registration_effective_date) {
    flags.push('ITC_CONFIG_NOT_SET');
    flags.push('ITC_DOCUMENTATION_INCOMPLETE');
    return {
      eligible: false, flags,
      recoverable_gst: 0, recoverable_hst: 0,
      non_recoverable_pst: pst,
      review_required: true,
    };
  }

  // Rule 3: Transaction date must be on/after registration
  if (extraction.date && extraction.date < config.registration_effective_date) {
    flags.push('ITC_BEFORE_REGISTRATION_DATE');
    return {
      eligible: false, flags,
      recoverable_gst: 0, recoverable_hst: 0,
      non_recoverable_pst: pst,
      review_required: true,
    };
  }

  // Rule 4: Sufficient evidence confidence
  if (extraction.confidence_total < config.min_confidence_for_itc) {
    flags.push('ITC_LOW_CONFIDENCE');
    flags.push('ITC_DOCUMENTATION_INCOMPLETE');
    return {
      eligible: false, flags,
      recoverable_gst: 0, recoverable_hst: 0,
      non_recoverable_pst: pst,
      review_required: true,
    };
  }

  // All rules passed — ITC eligible
  flags.push('ITC_ELIGIBLE');
  return {
    eligible: true,
    flags,
    recoverable_gst: Math.round(gst * 100) / 100,
    recoverable_hst: Math.round(hst * 100) / 100,
    non_recoverable_pst: Math.round(pst * 100) / 100,
    review_required: false,
  };
}

// ── Tax summary reporting ────────────────────────────────────────────

export interface TaxSummary {
  period_from: string;
  period_to: string;
  province: string;
  itc_registered: boolean;
  total_gst_paid: number;
  total_hst_paid: number;
  total_pst_paid: number;
  total_tax_paid: number;
  itc_eligible_gst: number;       // GST claimed as ITC
  itc_eligible_hst: number;       // HST claimed as ITC
  itc_pending_review: number;     // Tax on entries flagged ITC_DOCUMENTATION_INCOMPLETE
  non_recoverable_pst: number;    // PST never recoverable
  entry_count: number;
  flagged_count: number;          // Entries requiring ITC review
  by_category: Record<string, { count: number; subtotal: number; gst: number; hst: number; pst: number }>;
}

export class GSTService {
  private db: D1Database;
  private itcConfig: ITCConfig;

  constructor(db: D1Database, itcConfig: ITCConfig = DEFAULT_ITC_CONFIG) {
    this.db = db;
    this.itcConfig = itcConfig;
  }

  async getTaxSummary(params: {
    dateFrom: string;
    dateTo: string;
  }): Promise<TaxSummary> {
    const result = await this.db.prepare(`
      SELECT
        e.tax_gst, e.tax_hst, e.tax_pst, e.tax,
        e.subtotal, e.category, e.doc_type, e.confidence_total,
        e.date, le.entry_type, le.review_note
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
    let itc_eligible_gst = 0;
    let itc_eligible_hst = 0;
    let itc_pending_review = 0;
    let flagged_count = 0;
    const by_category: TaxSummary['by_category'] = {};

    for (const row of rows) {
      const gst = row.tax_gst ?? 0;
      const hst = row.tax_hst ?? 0;
      const pst = row.tax_pst ?? 0;

      total_gst_paid += gst;
      total_hst_paid += hst;
      total_pst_paid += pst;

      // ITC determination — per row, using registered config
      // PST determination is independent: always non-recoverable
      const itc = determineITC({
        doc_type: row.doc_type,
        tax_gst: gst,
        tax_hst: hst,
        tax_pst: pst,
        confidence_total: row.confidence_total ?? 0,
        date: row.date ?? null,
        category: row.category ?? null,
      }, this.itcConfig);

      if (itc.eligible) {
        itc_eligible_gst += itc.recoverable_gst;
        itc_eligible_hst += itc.recoverable_hst;
      } else if (itc.review_required) {
        itc_pending_review += gst + hst;
        flagged_count++;
      }

      // By category
      const cat = row.category ?? 'Other';
      if (!by_category[cat]) {
        by_category[cat] = { count: 0, subtotal: 0, gst: 0, hst: 0, pst: 0 };
      }
      by_category[cat].count++;
      by_category[cat].subtotal += row.subtotal ?? 0;
      by_category[cat].gst += gst;
      by_category[cat].hst += hst;
      by_category[cat].pst += pst;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      period_from: params.dateFrom,
      period_to: params.dateTo,
      province: this.itcConfig.province,
      itc_registered: this.itcConfig.itc_registered,
      total_gst_paid: round2(total_gst_paid),
      total_hst_paid: round2(total_hst_paid),
      total_pst_paid: round2(total_pst_paid),
      total_tax_paid: round2(total_gst_paid + total_hst_paid + total_pst_paid),
      itc_eligible_gst: round2(itc_eligible_gst),
      itc_eligible_hst: round2(itc_eligible_hst),
      itc_pending_review: round2(itc_pending_review),
      non_recoverable_pst: round2(total_pst_paid),
      entry_count: rows.length,
      flagged_count,
      by_category,
    };
  }
}
