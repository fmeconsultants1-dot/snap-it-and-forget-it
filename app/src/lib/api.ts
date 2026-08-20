/**
 * api.ts - Snap It & Forget It API client - FME Mission 001
 */
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as any;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface ScanResult {
  documentId: string; extractionId: string; ledgerEntryId: string;
  journalEntryId: string; refNumber: string; status: 'DONE' | 'FAILED';
  error?: string;
  extraction: {
    doc_type: string; vendor: string | null; date: string | null;
    total: number | null; subtotal: number | null; tax: number | null;
    payment_method: string | null; category: string | null;
    description: string | null; issuer: string | null;
    line_items: Array<{ name: string; quantity: number; unit_price: number; total: number }>;
    confidence_vendor: number; confidence_date: number;
    confidence_total: number; confidence_category: number;
  };
}

export interface LedgerEntry {
  id: string; run_id: string; entry_type: string; entity: string | null;
  date: string | null; amount: number; debit_amount: number; credit_amount: number;
  balance_type: string; status: string; ref_number: string; created_at: string;
  reversal_of: string | null; refund_type: string | null;
}

export interface JournalLine {
  account_code: string; account_name: string; debit: number; credit: number; memo: string | null;
}

export interface JournalEntry {
  id: string; ledger_entry_id: string; entry_date: string; doc_type: string;
  entry_type: string; entity: string; status: string; is_balanced: number;
  total_debits: number; total_credits: number; running_total: number;
  ref_number: string; lines: JournalLine[];
}

export const scanApi = {
  createRun: (documentCount: number) =>
    request<{ runId: string }>('/api/scan/run', { method: 'POST', body: JSON.stringify({ documentCount }) }),
  processDocument: (params: { runId: string; sequence: number; imageBase64: string; mimeType: string; fileName?: string }) =>
    request<ScanResult>('/api/scan/document', { method: 'POST', body: JSON.stringify(params) }),
  finalizeRun: (runId: string) =>
    request<any>(`/api/scan/run/${runId}/finalize`, { method: 'POST' }),
  getRun: (runId: string) => request<any>(`/api/scan/run/${runId}`),
};

export const ledgerApi = {
  getEntries: (params: { runId?: string; dateFilter?: string; entryType?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params.runId) qs.set('runId', params.runId);
    if (params.dateFilter) qs.set('dateFilter', params.dateFilter);
    if (params.entryType) qs.set('entryType', params.entryType);
    if (params.status) qs.set('status', params.status);
    return request<{ entries: LedgerEntry[]; runningTotal: number }>(`/api/ledger?${qs}`);
  },
  getJournalEntries: (params: { runId?: string; dateFilter?: string; entryType?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params.runId) qs.set('runId', params.runId);
    if (params.dateFilter) qs.set('dateFilter', params.dateFilter);
    if (params.entryType) qs.set('entryType', params.entryType);
    if (params.status) qs.set('status', params.status);
    return request<{ entries: JournalEntry[] }>(`/api/ledger/journal?${qs}`);
  },
  approve: (id: string) => request<{ success: boolean }>(`/api/ledger/${id}/approve`, { method: 'POST' }),
  exportCsv: () => `${API_URL}/api/export/ledger?format=csv`,
  getSplits: (id: string) => request<{ splits: any[]; count: number }>(`/api/ledger/${id}/splits`),
};

export const refundApi = {
  guard: (ledgerEntryId: string, requestedAmount = 0) =>
    request<any>(`/api/refund/guard/${ledgerEntryId}?amount=${requestedAmount}`),
  create: (params: {
    originalLedgerEntryId: string;
    refundType: 'FULL' | 'PARTIAL' | 'CREDIT_NOTE' | 'CARD_REFUND';
    refundAmount: number; refundDate: string;
    idempotencyKey?: string; creditNoteId?: string;
    settlementAccount?: string; memo?: string;
  }) => request<any>('/api/refund', { method: 'POST', body: JSON.stringify(params) }),
};

export const splitApi = {
  apply: (ledgerEntryId: string, params: any) =>
    request<any>(`/api/ledger/${ledgerEntryId}/split`, { method: 'POST', body: JSON.stringify(params) }),
};
