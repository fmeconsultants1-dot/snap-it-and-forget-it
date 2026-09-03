/**
 * ResultsPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * Stage 6: Review/Edit before approve.
 *
 * Flow:
 *   ProcessingPage extracts docs → navigates here with results[] + runId.
 *   Each result is a NEEDS_REVIEW ledger entry. The user sees all extracted
 *   fields, can correct any of them, then taps “Approve & Save”.
 *   That fires PATCH /api/ledger/:id with the (possibly corrected) values,
 *   which rebuilds journal lines and marks the entry APPROVED atomically.
 *   Only after ALL results are approved does the user navigate to the ledger.
 *
 * The original document in R2 is never touched. document_id association
 * is preserved by the backend.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ledgerApi, ReviewCorrections, ScanResult } from '../lib/api';

const CATEGORIES = [
  'Food', 'Transport', 'Automotive', 'Travel', 'Office',
  'Professional', 'Utilities', 'Insurance', 'Medical', 'Entertainment', 'Other',
];

const PAYMENT_METHODS = ['Cash', 'Credit', 'Debit', 'Cheque', 'Transfer'];

const DOC_TYPES = ['RECEIPT', 'INVOICE', 'STATEMENT', 'DOCUMENT'];

// Per-result editable state seeded from extraction
interface EditState {
  vendor: string;
  date: string;
  doc_type: string;
  category: string;
  subtotal: string;
  tax: string;
  total: string;
  payment_method: string;
  description: string;
}

function seedEdit(ex: ScanResult['extraction']): EditState {
  return {
    vendor:         ex.vendor         ?? ex.issuer ?? '',
    date:           ex.date           ?? '',
    doc_type:       ex.doc_type       ?? 'RECEIPT',
    category:       ex.category       ?? '',
    subtotal:       ex.subtotal       != null ? String(ex.subtotal) : '',
    tax:            ex.tax            != null ? String(ex.tax)      : '',
    total:          ex.total          != null ? String(ex.total)    : '',
    payment_method: ex.payment_method ?? '',
    description:    ex.description    ?? '',
  };
}

type ApproveStatus = 'idle' | 'saving' | 'done' | 'error';

export default function ResultsPage() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const results: ScanResult[] = location.state?.results ?? [];
  const runId: string | null  = location.state?.runId   ?? null;

  // Per-card edit state
  const [edits, setEdits] = useState<EditState[]>(() => results.map(r => seedEdit(r.extraction ?? {})));
  // Per-card approve status
  const [statuses, setStatuses] = useState<ApproveStatus[]>(() => results.map(() => 'idle'));
  const [errors,   setErrors]   = useState<string[]>(() => results.map(() => ''));
  // Expanded card index (one at a time on mobile)
  const [expanded, setExpanded] = useState<number>(0);

  const successful = results.filter(r => r.status === 'DONE');
  const allApproved = statuses.every((s, i) => s === 'done' || results[i]?.status === 'FAILED');

  function updateField(idx: number, field: keyof EditState, value: string) {
    setEdits(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, [field]: value };
      return next;
    });
  }

  async function approve(idx: number) {
    const result = results[idx]!;
    if (!result.ledgerEntryId) return;
    const edit = edits[idx]!;

    setStatuses(prev => { const n = [...prev]; n[idx] = 'saving'; return n; });
    setErrors(prev => { const n = [...prev]; n[idx] = ''; return n; });

    const corrections: ReviewCorrections = {
      vendor:         edit.vendor         || null,
      date:           edit.date           || null,
      doc_type:       edit.doc_type       || null,
      category:       edit.category       || null,
      total:          edit.total          !== '' ? parseFloat(edit.total)   : null,
      subtotal:       edit.subtotal       !== '' ? parseFloat(edit.subtotal): null,
      tax:            edit.tax            !== '' ? parseFloat(edit.tax)     : null,
      payment_method: edit.payment_method || null,
      description:    edit.description    || null,
    };

    try {
      await ledgerApi.updateAndApprove(result.ledgerEntryId, corrections);
      setStatuses(prev => { const n = [...prev]; n[idx] = 'done'; return n; });
      // Auto-expand next unapproved card
      const nextIdx = results.findIndex((r, i) => i > idx && r.status === 'DONE' && statuses[i] === 'idle');
      if (nextIdx !== -1) setExpanded(nextIdx);
    } catch (e: any) {
      setStatuses(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
      setErrors(prev => { const n = [...prev]; n[idx] = e.message ?? 'Save failed'; return n; });
    }
  }

  function conf(v: number | null | undefined) {
    if (v == null || typeof v !== 'number' || Number.isNaN(v)) return null;
    return Math.round(v * 100);
  }

  function confColor(pct: number | null) {
    if (pct == null) return 'var(--gray-light)';
    if (pct >= 80) return 'var(--white)';
    if (pct >= 60) return '#f0a500';
    return 'var(--red)';
  }

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>Review</h1>
        <p style={{ color: 'var(--gray-light)', fontSize: 14 }}>
          {successful.length} document{successful.length !== 1 ? 's' : ''} extracted.
          {successful.length > 0 ? ' Review and approve each one.' : ''}
        </p>
      </div>

      {results.map((result, idx) => {
        const ex        = result.extraction ?? {} as any;
        const isFailed  = result.status === 'FAILED';
        const status    = statuses[idx]!;
        const isOpen    = expanded === idx;
        const edit      = edits[idx]!;
        const isDone    = status === 'done';
        const isSaving  = status === 'saving';
        const isError   = status === 'error';
        const itcFlags  = (result as any).itcFlags ?? [];
        const hasReview = itcFlags.some((f: string) => f.includes('INCOMPLETE') || f.includes('NOT_REGISTERED') || f.includes('LOW_CONFIDENCE'));

        const vendorDisplay = isDone ? edit.vendor || 'Unknown' : (ex.vendor ?? ex.issuer ?? 'Unknown');
        const totalDisplay  = isDone
          ? (edit.total !== '' ? `$${parseFloat(edit.total || '0').toFixed(2)}` : '—')
          : (ex.total != null ? `$${Number(ex.total).toFixed(2)}` : '—');

        return (
          <div
            key={idx}
            className="card"
            style={{
              borderColor: isDone ? 'var(--green, #22c55e)' : isError ? 'var(--red)' : 'var(--border)',
              opacity: isFailed ? 0.5 : 1,
            }}
          >
            {/* Card header — always visible */}
            <div
              className="card-header"
              onClick={() => !isFailed && setExpanded(isOpen ? -1 : idx)}
              style={{ cursor: isFailed ? 'default' : 'pointer' }}
            >
              <div>
                <div className="card-vendor" style={{ color: isDone ? 'var(--green, #22c55e)' : undefined }}>
                  {isDone ? '✓ ' : ''}{isFailed ? 'Failed' : vendorDisplay}
                </div>
                <div className={`doc-type-label ${edit.doc_type}`}>{edit.doc_type}</div>
                {edit.date && <div className="date-label">{edit.date}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                {!isFailed && <div className="card-amount">{totalDisplay}</div>}
                {!isFailed && (
                  <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>
                    {isDone ? '✓ Approved' : isSaving ? 'Saving…' : isOpen ? '▲' : '▼'}
                  </div>
                )}
              </div>
            </div>

            {/* Failed card */}
            {isFailed && (
              <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 8 }}>
                {result.error ?? 'Processing failed'}
              </p>
            )}

            {/* Expanded editable review form */}
            {isOpen && !isFailed && !isDone && (
              <div style={{ marginTop: 12 }}>

                {/* Confidence summary — helps user know what to check */}
                <div style={{
                  display: 'flex', gap: 8, flexWrap: 'wrap',
                  marginBottom: 14, paddingBottom: 12,
                  borderBottom: '1px solid var(--border)',
                }}>
                  {([
                    ['vendor',   ex.confidence_vendor],
                    ['date',     ex.confidence_date],
                    ['total',    ex.confidence_total],
                    ['category', ex.confidence_category],
                  ] as [string, number | null | undefined][]).map(([label, val]) => {
                    const pct = conf(val);
                    return (
                      <div key={label} style={{ fontSize: 11, color: confColor(pct) }}>
                        {label} {pct != null ? `${pct}%` : 'N/A'}
                      </div>
                    );
                  })}
                </div>

                {/* Vendor */}
                <label className="review-label">Vendor</label>
                <input
                  className="review-input"
                  value={edit.vendor}
                  onChange={e => updateField(idx, 'vendor', e.target.value)}
                  placeholder="Vendor or merchant name"
                />

                {/* Date */}
                <label className="review-label">Date (YYYY-MM-DD)</label>
                <input
                  className="review-input"
                  type="date"
                  value={edit.date}
                  onChange={e => updateField(idx, 'date', e.target.value)}
                />

                {/* Doc type */}
                <label className="review-label">Type</label>
                <select
                  className="review-input"
                  value={edit.doc_type}
                  onChange={e => updateField(idx, 'doc_type', e.target.value)}
                >
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                {/* Category */}
                <label className="review-label">Category</label>
                <select
                  className="review-input"
                  value={edit.category}
                  onChange={e => updateField(idx, 'category', e.target.value)}
                >
                  <option value="">— select —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                {/* Subtotal / Tax / Total */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <label className="review-label">Subtotal</label>
                    <input
                      className="review-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={edit.subtotal}
                      onChange={e => updateField(idx, 'subtotal', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="review-label">Tax</label>
                    <input
                      className="review-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={edit.tax}
                      onChange={e => updateField(idx, 'tax', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="review-label">Total</label>
                    <input
                      className="review-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={edit.total}
                      onChange={e => updateField(idx, 'total', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Payment method */}
                <label className="review-label">Payment Method</label>
                <select
                  className="review-input"
                  value={edit.payment_method}
                  onChange={e => updateField(idx, 'payment_method', e.target.value)}
                >
                  <option value="">— select —</option>
                  {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                {/* Description */}
                <label className="review-label">Description</label>
                <input
                  className="review-input"
                  value={edit.description}
                  onChange={e => updateField(idx, 'description', e.target.value)}
                  placeholder="Optional note"
                />

                {/* ITC flag banner */}
                {hasReview && (
                  <div style={{
                    marginTop: 10, padding: '8px 10px',
                    background: 'var(--needs-review-bg)',
                    borderRadius: 6,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--needs-review-text)', fontWeight: 700 }}>ITC Review Required</div>
                    <div style={{ fontSize: 11, color: 'var(--gray-light)', marginTop: 2 }}>
                      {itcFlags.filter((f: string) => f !== 'ITC_PST_NOT_RECOVERABLE').join(' · ')}
                    </div>
                  </div>
                )}

                {/* Line items (read-only) */}
                {ex.line_items && ex.line_items.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--gray-light)', marginBottom: 4 }}>LINE ITEMS</div>
                    {ex.line_items.map((li: any, li_idx: number) => {
                      const qty = typeof li.quantity  === 'number' ? li.quantity  : parseFloat(li.quantity)  || 1;
                      const up  = typeof li.unit_price === 'number' ? li.unit_price : parseFloat(li.unit_price) || 0;
                      const tot = typeof li.total      === 'number' ? li.total      : parseFloat(li.total)      || 0;
                      return (
                        <div key={li_idx} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ color: 'var(--white-dim)' }}>{li.name ?? 'Item'} ×{qty} @${up.toFixed(2)}</span>
                          <span style={{ color: 'var(--gold, #f0a500)' }}>${tot.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Error */}
                {isError && (
                  <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>
                    {errors[idx] || 'Save failed. Try again.'}
                  </p>
                )}

                {/* Approve button */}
                <button
                  className="btn-primary"
                  onClick={() => approve(idx)}
                  disabled={isSaving}
                  style={{ marginTop: 16, width: '100%' }}
                >
                  {isSaving ? 'Saving…' : '✓ Approve & Save'}
                </button>

              </div>
            )}

            {/* Collapsed approved summary */}
            {isDone && isOpen && (
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gray-light)' }}>
                Approved — changes saved to ledger.
              </div>
            )}
          </div>
        );
      })}

      {/* Go to ledger — enabled only after all approvals */}
      <button
        className="btn-primary"
        onClick={() => navigate('/ledger', { state: { runId } })}
        disabled={!allApproved}
        style={{
          marginTop: 24,
          width: '100%',
          opacity: allApproved ? 1 : 0.4,
        }}
      >
        {allApproved ? 'View Ledger →' : `Approve all ${results.filter((r, i) => r.status === 'DONE' && statuses[i] !== 'done').length} remaining to continue`}
      </button>

      {/* Skip link for failed-only runs */}
      {successful.length === 0 && (
        <button
          className="btn-secondary"
          onClick={() => navigate('/')}
          style={{ marginTop: 12, width: '100%' }}
        >
          Back to Home
        </button>
      )}
    </div>
  );
}
