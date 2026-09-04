/**
 * ResultsPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * Sectioned review screen. One card per detected document.
 * Each card is independently editable and approvable.
 * No NaN%, no fake Unknown success states.
 * Failed extractions shown as EXTRACTION_FAILED with actionable message.
 * Styled to match the approved black/cream/orange Snap It & Forget It identity.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ledgerApi, ReviewCorrections, ScanResult } from '../lib/api';

const CATEGORIES = [
  'Food', 'Transport', 'Automotive', 'Travel', 'Office',
  'Professional', 'Utilities', 'Insurance', 'Medical', 'Entertainment', 'Other',
];
const PAYMENT_METHODS = ['Cash', 'Credit', 'Debit', 'Cheque', 'Transfer'];
const DOC_TYPES       = ['RECEIPT', 'INVOICE', 'STATEMENT', 'DOCUMENT'];

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

function seedEdit(ex: ScanResult['extraction'] | undefined): EditState {
  if (!ex || typeof ex !== 'object' || !ex.doc_type) {
    return { vendor:'', date:'', doc_type:'DOCUMENT', category:'',
             subtotal:'', tax:'', total:'', payment_method:'', description:'' };
  }
  return {
    vendor:         (ex.vendor ?? ex.issuer ?? '').toString(),
    date:           ex.date           ?? '',
    doc_type:       ex.doc_type       ?? 'DOCUMENT',
    category:       ex.category       ?? '',
    subtotal:       ex.subtotal  != null && !Number.isNaN(Number(ex.subtotal)) ? String(ex.subtotal) : '',
    tax:            ex.tax       != null && !Number.isNaN(Number(ex.tax))      ? String(ex.tax)      : '',
    total:          ex.total     != null && !Number.isNaN(Number(ex.total))    ? String(ex.total)    : '',
    payment_method: ex.payment_method ?? '',
    description:    ex.description    ?? '',
  };
}

// Returns null if value is NaN or missing — never shows NaN%
function safeConf(v: number | null | undefined): number | null {
  if (v == null || typeof v !== 'number' || Number.isNaN(v)) return null;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

function confColor(pct: number | null): string {
  if (pct == null) return 'var(--cream-dim)';
  if (pct >= 80)   return 'var(--cream)';
  if (pct >= 60)   return 'var(--gold)';
  return 'var(--red)';
}

function isExtractionEmpty(ex: ScanResult['extraction'] | undefined): boolean {
  if (!ex || typeof ex !== 'object') return true;
  return !ex.doc_type && !ex.vendor && !ex.issuer && !ex.total && !ex.date;
}

type ApproveStatus = 'idle' | 'saving' | 'done' | 'error';

export default function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const results: ScanResult[] = location.state?.results ?? [];
  const runId: string | null  = location.state?.runId   ?? null;

  const [edits,    setEdits]    = useState<EditState[]>(()  => results.map(r => seedEdit(r.extraction)));
  const [statuses, setStatuses] = useState<ApproveStatus[]>(() => results.map(() => 'idle'));
  const [errors,   setErrors]   = useState<string[]>(()     => results.map(() => ''));
  const [expanded, setExpanded] = useState<number>(0);

  const approvableResults = results.filter(r => r.status === 'DONE' && r.ledgerEntryId);
  const allApproved = approvableResults.every((r, _) => {
    const idx = results.indexOf(r);
    return statuses[idx] === 'done';
  });

  function updateField(idx: number, field: keyof EditState, value: string) {
    setEdits(prev => { const n = [...prev]; n[idx] = { ...n[idx]!, [field]: value }; return n; });
  }

  async function approve(idx: number) {
    const result = results[idx]!;
    if (!result.ledgerEntryId) return;
    const edit = edits[idx]!;
    setStatuses(prev => { const n = [...prev]; n[idx] = 'saving'; return n; });
    setErrors(prev => { const n = [...prev]; n[idx] = ''; return n; });
    const corrections: ReviewCorrections = {
      vendor:         edit.vendor || null,
      date:           edit.date   || null,
      doc_type:       edit.doc_type || null,
      category:       edit.category || null,
      total:          edit.total    !== '' ? parseFloat(edit.total)    : null,
      subtotal:       edit.subtotal !== '' ? parseFloat(edit.subtotal) : null,
      tax:            edit.tax      !== '' ? parseFloat(edit.tax)      : null,
      payment_method: edit.payment_method || null,
      description:    edit.description    || null,
    };
    try {
      await ledgerApi.updateAndApprove(result.ledgerEntryId, corrections);
      setStatuses(prev => { const n = [...prev]; n[idx] = 'done'; return n; });
      const next = results.findIndex((r, i) => i > idx && r.status === 'DONE' && statuses[i] === 'idle');
      if (next !== -1) setExpanded(next);
    } catch (e: any) {
      setStatuses(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
      setErrors(prev => { const n = [...prev]; n[idx] = e.message ?? 'Save failed'; return n; });
    }
  }

  const successCount = results.filter(r => r.status === 'DONE').length;
  const failCount    = results.filter(r => r.status === 'FAILED').length;

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      {/* Header */}
      <div style={{ marginBottom: 24, marginTop: 8 }}>
        <h1 style={{ fontSize: 26, color: 'var(--cream)', fontWeight: 800, marginBottom: 4 }}>Review</h1>
        <p style={{ color: 'var(--cream-dim)', fontSize: 14 }}>
          {successCount > 0 && `${successCount} document${successCount !== 1 ? 's' : ''} extracted — review and approve each one.`}
          {failCount > 0 && ` ${failCount} failed.`}
        </p>
      </div>

      {results.length === 0 && (
        <div className="empty-state">
          <p>No documents to review.</p>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>Back to Home</button>
        </div>
      )}

      {results.map((result, idx) => {
        const ex         = result.extraction;
        const isEmpty    = isExtractionEmpty(ex);
        const isFailed   = result.status === 'FAILED' || isEmpty;
        const status     = statuses[idx]!;
        const isOpen     = expanded === idx;
        const edit       = edits[idx]!;
        const isDone     = status === 'done';
        const isSaving   = status === 'saving';
        const isError    = status === 'error';
        const itcFlags   = result.itcFlags ?? [];
        const hasITCNote = itcFlags.some(f => f !== 'ITC_ELIGIBLE' && f !== 'ITC_PST_NOT_RECOVERABLE');

        // Card summary values — never show Unknown for amount, never NaN
        const vendorDisplay = isDone
          ? (edit.vendor || '—')
          : (ex?.vendor ?? ex?.issuer ?? null);
        const totalDisplay = isDone
          ? (edit.total !== '' ? `$${parseFloat(edit.total || '0').toFixed(2)}` : '—')
          : (ex?.total != null && !Number.isNaN(Number(ex?.total))
              ? `$${Number(ex.total).toFixed(2)}` : '—');

        return (
          <div
            key={idx}
            className="review-card"
            style={{ borderColor: isDone ? 'var(--gold)' : isError ? 'var(--red)' : 'var(--border)' }}
          >
            {/* Card header — tap to expand/collapse */}
            <div
              className="review-card-header"
              onClick={() => !isFailed && !isDone && setExpanded(isOpen ? -1 : idx)}
              style={{ cursor: (isFailed || isDone) ? 'default' : 'pointer' }}
            >
              <div style={{ flex: 1 }}>
                <div className="review-vendor">
                  {isDone && <span style={{ color: 'var(--gold)', marginRight: 6 }}>✓</span>}
                  {isFailed && !isDone
                    ? <span style={{ color: 'var(--red)' }}>EXTRACTION FAILED</span>
                    : vendorDisplay
                      ? <span>{vendorDisplay}</span>
                      : <span style={{ color: 'var(--cream-dim)' }}>Tap to review</span>}
                </div>
                <div className="review-doctype" data-type={edit.doc_type}>
                  {edit.doc_type}
                </div>
                {edit.date && (
                  <div style={{ fontSize: 12, color: 'var(--cream-dim)', marginTop: 2 }}>{edit.date}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {!isFailed && (
                  <div className="review-total">{totalDisplay}</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--cream-dim)', marginTop: 4 }}>
                  {isDone ? '✓ Approved' : isSaving ? 'Saving…' : isFailed ? '' : isOpen ? '▲' : '▼'}
                </div>
              </div>
            </div>

            {/* Failed / empty extraction — honest message */}
            {isFailed && (
              <div style={{
                background: 'rgba(255,68,68,0.08)', borderRadius: 8,
                padding: '12px 14px', marginTop: 10,
              }}>
                <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>
                  Could not read this document
                </div>
                <div style={{ fontSize: 12, color: 'var(--cream-dim)' }}>
                  {result.error ?? 'Retake the photo in better lighting, or enter the information manually.'}
                </div>
              </div>
            )}

            {/* Expanded editable form — not shown for failed */}
            {isOpen && !isFailed && !isDone && (
              <div style={{ marginTop: 16 }}>

                {/* Confidence bar — only shown when values are available */}
                {(() => {
                  const scores: [string, number | null][] = [
                    ['Vendor',   safeConf(ex?.confidence_vendor)],
                    ['Date',     safeConf(ex?.confidence_date)],
                    ['Total',    safeConf(ex?.confidence_total)],
                    ['Category', safeConf(ex?.confidence_category)],
                  ].filter(([, v]) => v !== null) as [string, number][];
                  if (scores.length === 0) return null;
                  return (
                    <div style={{
                      display: 'flex', gap: 10, flexWrap: 'wrap',
                      paddingBottom: 14, marginBottom: 14,
                      borderBottom: '1px solid var(--border)',
                    }}>
                      {scores.map(([lbl, pct]) => (
                        <div key={lbl} style={{ fontSize: 11, color: confColor(pct) }}>
                          {lbl} <strong>{pct}%</strong>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Section: Document Identity */}
                <div className="review-section-label">Document</div>

                <label className="review-label">Vendor / Issuer</label>
                <input className="review-input" value={edit.vendor}
                  onChange={e => updateField(idx, 'vendor', e.target.value)}
                  placeholder="Vendor or issuer name" />

                <label className="review-label">Date</label>
                <input className="review-input" type="date" value={edit.date}
                  onChange={e => updateField(idx, 'date', e.target.value)} />

                <label className="review-label">Document Type</label>
                <select className="review-input" value={edit.doc_type}
                  onChange={e => updateField(idx, 'doc_type', e.target.value)}>
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <label className="review-label">Category</label>
                <select className="review-input" value={edit.category}
                  onChange={e => updateField(idx, 'category', e.target.value)}>
                  <option value="">— select —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                {/* Section: Amounts */}
                <div className="review-section-label" style={{ marginTop: 16 }}>Amounts</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <label className="review-label">Subtotal</label>
                    <input className="review-input" type="number" step="0.01" min="0"
                      value={edit.subtotal} placeholder="0.00"
                      onChange={e => updateField(idx, 'subtotal', e.target.value)} />
                  </div>
                  <div>
                    <label className="review-label">Tax</label>
                    <input className="review-input" type="number" step="0.01" min="0"
                      value={edit.tax} placeholder="0.00"
                      onChange={e => updateField(idx, 'tax', e.target.value)} />
                  </div>
                  <div>
                    <label className="review-label">Total</label>
                    <input className="review-input" type="number" step="0.01" min="0"
                      value={edit.total} placeholder="0.00"
                      onChange={e => updateField(idx, 'total', e.target.value)} />
                  </div>
                </div>

                {/* Section: Payment */}
                <div className="review-section-label" style={{ marginTop: 16 }}>Payment</div>

                <label className="review-label">Payment Method</label>
                <select className="review-input" value={edit.payment_method}
                  onChange={e => updateField(idx, 'payment_method', e.target.value)}>
                  <option value="">— select —</option>
                  {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                {/* Section: Notes */}
                <div className="review-section-label" style={{ marginTop: 16 }}>Notes</div>

                <label className="review-label">Description</label>
                <input className="review-input" value={edit.description}
                  onChange={e => updateField(idx, 'description', e.target.value)}
                  placeholder="Optional note" />

                {/* Line items — read-only */}
                {ex?.line_items && ex.line_items.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div className="review-section-label">Line Items</div>
                    {ex.line_items.map((li: any, i: number) => {
                      const qty = Number(li.quantity)  || 1;
                      const up  = Number(li.unit_price) || 0;
                      const tot = Number(li.total)      || 0;
                      if (Number.isNaN(qty) || Number.isNaN(up)) return null;
                      return (
                        <div key={i} style={{
                          display: 'flex', justifyContent: 'space-between',
                          fontSize: 12, marginBottom: 4, color: 'var(--cream-dim)',
                        }}>
                          <span>{li.name ?? 'Item'} ×{qty} @${up.toFixed(2)}</span>
                          <span style={{ color: 'var(--gold)' }}>${tot.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ITC note */}
                {hasITCNote && (
                  <div style={{
                    marginTop: 14, padding: '10px 12px',
                    background: 'rgba(255,140,0,0.1)', borderRadius: 8,
                    borderLeft: '3px solid var(--gold)',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700 }}>ITC Note</div>
                    <div style={{ fontSize: 11, color: 'var(--cream-dim)', marginTop: 2 }}>
                      {itcFlags.filter(f => f !== 'ITC_ELIGIBLE' && f !== 'ITC_PST_NOT_RECOVERABLE').join(' · ')}
                    </div>
                  </div>
                )}

                {isError && (
                  <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 10 }}>
                    {errors[idx] || 'Save failed. Please try again.'}
                  </p>
                )}

                <button
                  className="btn-primary"
                  onClick={() => approve(idx)}
                  disabled={isSaving}
                  style={{ marginTop: 20, width: '100%' }}
                >
                  {isSaving ? 'Saving…' : '✓ Approve & Save'}
                </button>
              </div>
            )}

            {isDone && (
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gold)' }}>
                Saved to ledger.
              </div>
            )}
          </div>
        );
      })}

      {/* View Ledger — locked until all approvable docs are approved */}
      <button
        className="btn-primary"
        onClick={() => navigate('/ledger', { state: { runId } })}
        disabled={!allApproved}
        style={{ marginTop: 24, width: '100%', opacity: allApproved ? 1 : 0.4 }}
      >
        {allApproved
          ? 'View Ledger →'
          : `Approve ${approvableResults.filter((r) => statuses[results.indexOf(r)] !== 'done').length} remaining to continue`}
      </button>

      {successCount === 0 && failCount > 0 && (
        <button className="btn-secondary" onClick={() => navigate('/')}
          style={{ marginTop: 12, width: '100%', textAlign: 'center' }}>
          Back to Home
        </button>
      )}
    </div>
  );
}
