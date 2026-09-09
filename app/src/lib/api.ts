/**
 * api.ts - Snap It & Forget It API client - FME Mission 001
 *
 * BUG E PHASE 2A FIX: processDocumentRaw accepts 422 with valid results[]
 * BUG E PHASE 2B: documentApi.manual() added
 */
const API_URL = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' })) as any;
    const message: string = body?.error || body?.results?.[0]?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

/**
 * Specialized fetch for POST /api/scan/document.
 * Accepts HTTP 200 and HTTP 422 when the body contains a valid results[] array.
 * Preserves server-assigned documentId on extraction failure.
 */
async function scanRequestRaw(path: string, options: RequestInit): Promise<ProcessDocumentResponse> {
  const res  = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as ProcessDocumentResponse | null;
  if ((res.status === 200 || res.status === 422) && body && Array.isArray(body.results) && body.results.length > 0) {
    return body;
  }
  const errMsg = (body as any)?.error || (body as any)?.results?.[0]?.error || `HTTP ${res.status}`;
  throw new Error(errMsg);
}

export interface ExtractionData {
  doc_type: string;
  vendor: string | null;
  date: string | null;
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  tax_gst?: number | null;
  tax_hst?: number | null;
  tax_pst?: number | null;
  payment_method: string | null;
  category: string | null;
  description: string | null;
  issuer: string | null;
  line_items: Array<{ name: string; quantity: number; unit_price: number; total: number }>;
  confidence_vendor: number;
  confidence_date: number;
  confidence_total: number;
  confidence_category: number;
}

export interface ScanResult {
  approved?: boolean;
  documentId: string;
  extractionId: string;
  ledgerEntryId: string;
  journalEntryId: string;
  refNumber: string;
  lineCount: number;
  itcFlags: string[];
  status: 'DONE' | 'FAILED';
  error?: string;
  extraction: ExtractionData;
}

export interface ProcessDocumentResponse {
  results: ScanResult[];
  detectedCount: number;
}

export interface ManualRecoveryResponse {
  success: boolean;
  idempotent: boolean;
  documentId: string;
  extractionId: string;
  ledgerEntryId: string;
  journalEntryId: string;
  refNumber: string;
  status: string;
  isBalanced: boolean;
  itcFlags: string[];
}

export interface LedgerEntry {
  id: string;
  run_id: string;
  document_id: string;
  extraction_id: string;
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
  reversal_of: string | null;
  refund_type: string | null;
  review_note: string | null;
}

export interface JournalLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  memo: string | null;
}

export interface JournalEntry {
  id: string;
  ledger_entry_id: string;
  entry_date: string;
  doc_type: string;
  entry_type: string;
  entity: string;
  status: string;
  is_balanced: number;
  total_debits: number;
  total_credits: number;
  running_total: number;
  ref_number: string;
  lines: JournalLine[];
}

export interface ReviewCorrections {
  vendor?: string | null;
  date?: string | null;
  category?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  tax_gst?: number | null;
  tax_hst?: number | null;
  tax_pst?: number | null;
  total?: number | null;
  payment_method?: string | null;
  description?: string | null;
  doc_type?: string | null;
  confirm_zero_total?: boolean;
}

export const scanApi = {
  createRun: (documentCount: number) =>
    request<{ runId: string }>('/api/scan/run', { method: 'POST', body: JSON.stringify({ documentCount }) }),

  processDocument: async (params: {
    runId: string; sequence: number; imageBase64: string; mimeType: string; fileName?: string;
  }): Promise<ScanResult> => {
    const raw = await scanApi.processDocumentRaw(params);
    const first = raw.results[0];
    if (!first) {
      return { documentId: '', extractionId: '', ledgerEntryId: '', journalEntryId: '',
        refNumber: '', lineCount: 0, itcFlags: [], status: 'FAILED' as const,
        error: 'No results returned from server', extraction: {} as ExtractionData };
    }
    return first;
  },

  processDocumentRaw: (params: {
    runId: string; sequence: number; imageBase64: string; mimeType: string; fileName?: string;
  }): Promise<ProcessDocumentResponse> =>
    scanRequestRaw('/api/scan/document', { method: 'POST', body: JSON.stringify(params) }),

  finalizeRun: (runId: string) => request<any>(`/api/scan/run/${runId}/finalize`, { method: 'POST' }),
  getRun:      (runId: string) => request<any>(`/api/scan/run/${runId}`),
};

export const documentApi = {
  skip: (documentId: string, ledgerEntryId?: string) => request<{ success: boolean }>(`/api/documents/${documentId}/skip`, { method: 'POST', body: JSON.stringify({ ledgerEntryId }) }),
  /**
   * Manual recovery for a failed extraction.
   * POST /api/documents/:documentId/manual
   * Returns ManualRecoveryResponse.
   * Throws on 409 (conflict) or 422 (validation failure).
   */
  manual: (documentId: string, corrections: ReviewCorrections): Promise<ManualRecoveryResponse> =>
    request<ManualRecoveryResponse>(
      `/api/documents/${documentId}/manual`,
      { method: 'POST', body: JSON.stringify(corrections) }
    ),
};

export const ledgerApi = {
  getReview: (id: string) => request<ReviewCorrections>(`/api/ledger/${id}/review`),
  getEntries: (params: {
    runId?: string; dateFilter?: string; entryType?: string; status?: string;
    dateFrom?: string; dateTo?: string; limit?: number; offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.runId)      qs.set('runId',      params.runId);
    if (params.dateFilter) qs.set('dateFilter', params.dateFilter);
    if (params.entryType)  qs.set('entryType',  params.entryType);
    if (params.status)     qs.set('status',     params.status);
    if (params.dateFrom)   qs.set('dateFrom',   params.dateFrom);
    if (params.dateTo)     qs.set('dateTo',     params.dateTo);
    if (params.limit)      qs.set('limit',      String(params.limit));
    if (params.offset)     qs.set('offset',     String(params.offset));
    return request<{ entries: LedgerEntry[]; runningTotal: number }>(`/api/ledger?${qs}`);
  },
  getJournalEntries: (params: {
    runId?: string; dateFilter?: string; entryType?: string;
    status?: string; dateFrom?: string; dateTo?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.runId)      qs.set('runId',      params.runId);
    if (params.dateFilter) qs.set('dateFilter', params.dateFilter);
    if (params.entryType)  qs.set('entryType',  params.entryType);
    if (params.status)     qs.set('status',     params.status);
    if (params.dateFrom)   qs.set('dateFrom',   params.dateFrom);
    if (params.dateTo)     qs.set('dateTo',     params.dateTo);
    return request<{ entries: JournalEntry[] }>(`/api/ledger/journal?${qs}`);
  },
  approve:          (id: string) =>
    request<{ success: boolean }>(`/api/ledger/${id}/approve`, { method: 'POST' }),
  updateAndApprove: (id: string, corrections: ReviewCorrections) =>
    request<{ success: boolean; isBalanced: boolean; itcFlags: string[] }>(
      `/api/ledger/${id}`, { method: 'PATCH', body: JSON.stringify(corrections) }),
  exportCsv: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
    return `${API_URL}/api/export/ledger?${qs}`;
  },
  getSplits:  (id: string) =>
    request<{ splits: any[]; count: number }>(`/api/ledger/${id}/splits`),
};

export const refundApi = {
  guard: (ledgerEntryId: string, requestedAmount = 0) =>
    request<{ originalAmount: number; cumulativeRefunded: number;
      remainingRefundable: number; canRefund: boolean; maxAllowable: number; }>(
      `/api/refund/guard/${ledgerEntryId}?amount=${requestedAmount}`),
  create: (params: {
    originalLedgerEntryId: string; refundType: 'FULL'|'PARTIAL'|'CREDIT_NOTE'|'CARD_REFUND';
    refundAmount: number; refundDate: string; idempotencyKey?: string;
    creditNoteId?: string; settlementAccount?: string; memo?: string;
  }) => request<{ refundLedgerEntryId: string; refNumber: string; isBalanced: boolean;
    cumulativeRefunded: number; remainingRefundable: number; idempotent: boolean; }>(
    '/api/refund', { method: 'POST', body: JSON.stringify(params) }),
};

export const splitApi = {
  apply: (ledgerEntryId: string, params: {
    splits: Array<{ description: string; expense_account_code: string;
      expense_account_name: string; allocated_subtotal: number;
      is_business_use: boolean; category?: string; }>;
    total_gst: number; total_hst: number; total_pst: number;
    total_subtotal: number; total_with_tax: number;
    settlement_account_code: string; settlement_account_name: string; date: string;
  }) => request<{ ledgerEntryId: string; journalEntryId: string;
    totalDebits: number; totalCredits: number; isBalanced: boolean;
    itcTotal: number; personalUseTotal: number; personalUseCount: number; }>(
    `/api/ledger/${ledgerEntryId}/split`, { method: 'POST', body: JSON.stringify(params) }),
  getSplits: (ledgerEntryId: string) =>
    request<{ splits: any[]; count: number }>(`/api/ledger/${ledgerEntryId}/splits`),
};
