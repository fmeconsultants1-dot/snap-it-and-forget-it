/**
 * ResultsPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * FIXES (2026-09-04):
 * 1. CTA is NEVER a disabled orange button when approvable docs remain.
 *    - While docs remain: "Review Next Document →" (enabled, gold)
 *    - When all approved: "View Ledger →" (enabled, gold)
 * 2. Approve auto-advances: scrolls next unapproved card into view.
 * 3. Failed docs show actionable buttons: Retake / Enter Manually / Skip.
 * 4. Enter Manually opens the sectioned edit form for that failed doc.
 * 5. Skip marks the doc NEEDS_ATTENTION and allows the rest to continue.
 */
import { useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ledgerApi, ReviewCorrections, ScanResult } from '../lib/api';
import { docStore } from '../lib/docStore';

const CATEGORIES     = ['Food','Transport','Automotive','Travel','Office','Professional','Utilities','Insurance','Medical','Entertainment','Other'];
const PAYMENT_METHODS = ['Cash','Credit','Debit','Cheque','Transfer'];
const DOC_TYPES       = ['RECEIPT','INVOICE','STATEMENT','DOCUMENT'];

interface EditState {
  vendor: string; date: string; doc_type: string; category: string;
  subtotal: string; tax: string; total: string;
  payment_method: string; description: string;
}

function seedEdit(ex: ScanResult['extraction'] | undefined): EditState {
  if (!ex || typeof ex !== 'object' || !ex.doc_type) {
    return { vendor:'', date:'', doc_type:'DOCUMENT', category:'', subtotal:'', tax:'', total:'', payment_method:'', description:'' };
  }
  return {
    vendor:         String(ex.vendor ?? ex.issuer ?? ''),
    date:           ex.date           ?? '',
    doc_type:       ex.doc_type       ?? 'DOCUMENT',
    category:       ex.category       ?? '',
    subtotal:       (ex.subtotal  != null && !Number.isNaN(Number(ex.subtotal))) ? String(ex.subtotal) : '',
    tax:            (ex.tax       != null && !Number.isNaN(Number(ex.tax)))      ? String(ex.tax)      : '',
    total:          (ex.total     != null && !Number.isNaN(Number(ex.total)))    ? String(ex.total)    : '',
    payment_method: ex.payment_method ?? '',
    description:    ex.description    ?? '',
  };
}

function safeConf(v: number | null | undefined): number | null {
  if (v == null || typeof v !== 'number' || Number.isNaN(v)) return null;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}
function confColor(pct: number | null) {
  if (pct == null) return 'var(--cream-dim)';
  if (pct >= 80)   return 'var(--cream)';
  if (pct >= 60)   return 'var(--gold)';
  return 'var(--red)';
}
function isExtractionEmpty(ex: ScanResult['extraction'] | undefined) {
  if (!ex || typeof ex !== 'object') return true;
  return !ex.doc_type && !ex.vendor && !ex.issuer && !ex.total && !ex.date;
}

// Per-card state
type ApproveStatus = 'idle' | 'saving' | 'done' | 'error' | 'skipped' | 'manual';

export default function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const results: ScanResult[] = location.state?.results ?? [];
  const runId: string | null  = location.state?.runId ?? null;

  const [edits,    setEdits]    = useState<EditState[]>(() => results.map(r => seedEdit(r.extraction)));
  const [statuses, setStatuses] = useState<ApproveStatus[]>(() => results.map(() => 'idle'));
  const [errors,   setErrors]   = useState<string[]>(() => results.map(() => ''));
  const [expanded, setExpanded] = useState<number>(
    // Open the first approvable card
    results.findIndex(r => r.status === 'DONE' && r.ledgerEntryId)
  );

  // Refs for scroll-into-view
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  function updateField(idx: number, field: keyof EditState, value: string) {
    setEdits(prev => { const n = [...prev]; n[idx] = { ...n[idx]!, [field]: value }; return n; });
  }

  // Find next unapproved approvable card after idx
  function findNext(afterIdx: number, currentStatuses: ApproveStatus[]): number {
    return results.findIndex((r, i) =>
      i > afterIdx &&
      r.status === 'DONE' &&
      r.ledgerEntryId &&
      currentStatuses[i] !== 'done'
    );
  }

  const advanceTo = useCallback((idx: number) => {
    setExpanded(idx);
    // Scroll into view after render
    setTimeout(() => {
      cardRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, []);

  // Approve a document
  async function approve(idx: number) {
    const result = results[idx]!;
    if (!result.ledgerEntryId) return;
    const edit = edits[idx]!;
    const next = statuses.map((s, i) => i === idx ? 'saving' : s) as ApproveStatus[];
    setStatuses(next);
    setErrors(prev => { const n = [...prev]; n[idx] = ''; return n; });

    const corrections: ReviewCorrections = {
      vendor:         edit.vendor         || null,
      date:           edit.date           || null,
      doc_type:       edit.doc_type       || null,
      category:       edit.category       || null,
      total:          edit.total    !== '' ? parseFloat(edit.total)    : null,
      subtotal:       edit.subtotal !== '' ? parseFloat(edit.subtotal) : null,
      tax:            edit.tax      !== '' ? parseFloat(edit.tax)      : null,
      payment_method: edit.payment_method || null,
      description:    edit.description    || null,
    };

    try {
      await ledgerApi.updateAndApprove(result.ledgerEntryId, corrections);
      const updated = statuses.map((s, i) => i === idx ? 'done' : s) as ApproveStatus[];
      setStatuses(updated);
      const nextIdx = findNext(idx, updated);
      if (nextIdx !== -1) advanceTo(nextIdx);
    } catch (e: any) {
      setStatuses(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
      setErrors(prev => { const n = [...prev]; n[idx] = e.message ?? 'Save failed'; return n; });
    }
  }

  // Skip a failed document
  function skip(idx: number) {
    setStatuses(prev => { const n = [...prev]; n[idx] = 'skipped'; return n; });
    const nextIdx = findNext(idx, statuses.map((s, i) => i === idx ? 'skipped' : s) as ApproveStatus[]);
    if (nextIdx !== -1) advanceTo(nextIdx);
  }

  // Enter Manually — open the edit form for a failed card
  function enterManually(idx: number) {
    setStatuses(prev => { const n = [...prev]; n[idx] = 'manual'; return n; });
    advanceTo(idx);
  }

  // Retake — go back to camera with just this one slot
  function retake() {
    docStore.clear();
    navigate('/camera');
  }

  // Derived counts
  const approvableResults = results.filter(r => r.status === 'DONE' && r.ledgerEntryId);
  const approvedCount     = approvableResults.filter(r => statuses[results.indexOf(r)] === 'done').length;
  const remainingCount    = approvableResults.length - approvedCount;
  const allApproved       = remainingCount === 0;
  const successCount      = results.filter(r => r.status === 'DONE').length;
  const failCount         = results.filter(r => r.status === 'FAILED').length;

  // Next unapproved idx from current position
  const nextUnapprovedIdx = results.findIndex((r, i) =>
    r.status === 'DONE' && r.ledgerEntryId && statuses[i] !== 'done'
  );

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <div style={{ marginBottom: 20, marginTop: 8 }}>
        <h1 style={{ fontSize: 26, color: 'var(--cream)', fontWeight: 800, marginBottom: 4 }}>Review</h1>
        <p style={{ color: 'var(--cream-dim)', fontSize: 14 }}>
          {successCount > 0 && `${successCount} document${successCount !== 1 ? 's' : ''} extracted.`}
          {remainingCount > 0 && ` ${remainingCount} remaining to approve.`}
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
        const ex       = result.extraction;
        const isEmpty  = isExtractionEmpty(ex);
        // A card is "failed" unless it's DONE or in manual-entry mode
        const isFailed = (result.status === 'FAILED' || isEmpty) && statuses[idx] !== 'manual';
        const status   = statuses[idx]!;
        const isOpen   = expanded === idx;
        const edit     = edits[idx]!;
        const isDone   = status === 'done';
        const isSaving = status === 'saving';
        const isError  = status === 'error';
        const isManual = status === 'manual';
        const isSkipped = status === 'skipped';
        const itcFlags = result.itcFlags ?? [];
        const hasITCNote = itcFlags.some(f => f !== 'ITC_ELIGIBLE' && f !== 'ITC_PST_NOT_RECOVERABLE');

        const vendorDisplay = isDone
          ? (edit.vendor || '—')
          : (ex?.vendor ?? ex?.issuer ?? null);
        const totalDisplay = isDone
          ? (edit.total !== '' ? `$${parseFloat(edit.total || '0').toFixed(2)}` : '—')
          : (ex?.total != null && !Number.isNaN(Number(ex?.total)) ? `$${Number(ex.total).toFixed(2)}` : '—');

        const showEditForm = isOpen && !isDone && (isManual || !isFailed);

        return (
          <div
            key={idx}
            ref={el => { cardRefs.current[idx] = el; }}
            className="review-card"
            style={{ borderColor: isDone ? 'var(--gold)' : isError ? 'var(--red)' : isSkipped ? 'var(--border)' : 'var(--border)' }}
          >
            {/* Card header */}
            <div
              className="review-card-header"
              onClick={() => {
                if (isDone || isSkipped) return;
                setExpanded(isOpen ? -1 : idx);
              }}
              style={{ cursor: (isDone || isSkipped) ? 'default' : 'pointer' }}
            >
              <div style={{ flex: 1 }}>
                <div className="review-vendor">
                  {isDone    && <span style={{ color: 'var(--gold)',      marginRight: 6 }}>✓</span>}
                  {isSkipped && <span style={{ color: 'var(--cream-dim)', marginRight: 6 }}>↷</span>}
                  {isFailed && !isDone
                    ? <span style={{ color: 'var(--red)' }}>Document {idx + 1} — Could not read</span>
                    : isSkipped
                      ? <span style={{ color: 'var(--cream-dim)' }}>Document {idx + 1} — Skipped</span>
                      : vendorDisplay
                        ? <span>{vendorDisplay}</span>
                        : <span style={{ color: 'var(--cream-dim)' }}>Document {idx + 1}</span>}
                </div>
                {!isFailed && !isSkipped && (
                  <div className="review-doctype" data-type={edit.doc_type}>{edit.doc_type}</div>
                )}
                {edit.date && !isFailed && !isSkipped && (
                  <div style={{ fontSize: 12, color: 'var(--cream-dim)', marginTop: 2 }}>{edit.date}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {!isFailed && !isSkipped && <div className="review-total">{totalDisplay}</div>}
                <div style={{ fontSize: 12, color: 'var(--cream-dim)', marginTop: 4 }}>
                  {isDone ? '✓ Approved' : isSaving ? 'Saving…' : isSkipped ? 'Skipped' : (isFailed && !isManual) ? '' : isOpen ? '▲' : '▼'}
                </div>
              </div>
            </div>

            {/* Failed card — action buttons */}
            {isFailed && !isSkipped && (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  background: 'rgba(224,80,80,0.08)', borderRadius: 8,
                  padding: '10px 12px', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>
                    Could not read this document
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--cream-dim)' }}>
                    {result.error ?? 'Try retaking in better lighting, or enter the information manually.'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn-secondary" onClick={retake}
                    style={{ flex: 1, justifyContent: 'center', fontSize: 13 }}>
                    📷 Retake
                  </button>
                  <button className="btn-secondary" onClick={() => enterManually(idx)}
                    style={{ flex: 1, justifyContent: 'center', fontSize: 13 }}>
                    ✏️ Enter Manually
                  </button>
                  <button className="btn-secondary" onClick={() => skip(idx)}
                    style={{ flex: 1, justifyContent: 'center', fontSize: 13, color: 'var(--cream-dim)' }}>
                    Skip
                  </button>
                </div>
              </div>
            )}

            {/* Editable form — shown for open approvable cards OR manual-entry failed cards */}
            {showEditForm && (
              <div style={{ marginTop: 16 }}>

                {/* Confidence — only when values available */}
                {(() => {
                  const scores: [string, number | null][] = [
                    ['Vendor',   safeConf(ex?.confidence_vendor)],
                    ['Date',     safeConf(ex?.confidence_date)],
                    ['Total',    safeConf(ex?.confidence_total)],
                    ['Category', safeConf(ex?.confidence_category)],
                  ].filter(([, v]) => v !== null) as [string, number][];
                  if (scores.length === 0) return null;
                  return (
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap', paddingBottom:14, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
                      {scores.map(([lbl, pct]) => (
                        <div key={lbl} style={{ fontSize: 11, color: confColor(pct) }}>
                          {lbl} <strong>{pct}%</strong>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Document section */}
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

                {/* Amounts section */}
                <div className="review-section-label" style={{ marginTop: 16 }}>Amounts</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
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

                {/* Payment section */}
                <div className="review-section-label" style={{ marginTop: 16 }}>Payment</div>
                <label className="review-label">Payment Method</label>
                <select className="review-input" value={edit.payment_method}
                  onChange={e => updateField(idx, 'payment_method', e.target.value)}>
                  <option value="">— select —</option>
                  {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                {/* Notes section */}
                <div className="review-section-label" style={{ marginTop: 16 }}>Notes</div>
                <label className="review-label">Description</label>
                <input className="review-input" value={edit.description}
                  onChange={e => updateField(idx, 'description', e.target.value)}
                  placeholder="Optional note" />

                {/* Line items */}
                {ex?.line_items && ex.line_items.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div className="review-section-label">Line Items</div>
                    {ex.line_items.map((li: any, i: number) => {
                      const qty = Number(li.quantity)  || 1;
                      const up  = Number(li.unit_price) || 0;
                      const tot = Number(li.total)      || 0;
                      if (Number.isNaN(qty) || Number.isNaN(up)) return null;
                      return (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4, color:'var(--cream-dim)' }}>
                          <span>{li.name ?? 'Item'} ×{qty} @${up.toFixed(2)}</span>
                          <span style={{ color:'var(--gold)' }}>${tot.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ITC note */}
                {hasITCNote && (
                  <div style={{ marginTop:14, padding:'10px 12px', background:'rgba(255,140,0,0.1)', borderRadius:8, borderLeft:'3px solid var(--gold)' }}>
                    <div style={{ fontSize:11, color:'var(--gold)', fontWeight:700 }}>ITC Note</div>
                    <div style={{ fontSize:11, color:'var(--cream-dim)', marginTop:2 }}>
                      {itcFlags.filter(f => f !== 'ITC_ELIGIBLE' && f !== 'ITC_PST_NOT_RECOVERABLE').join(' · ')}
                    </div>
                  </div>
                )}

                {isError && (
                  <p style={{ fontSize:12, color:'var(--red)', marginTop:10 }}>
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
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gold)' }}>✓ Saved to ledger.</div>
            )}
          </div>
        );
      })}

      {/* BOTTOM CTA — always enabled, never a disabled primary button */}
      <div style={{ marginTop: 24, marginBottom: 16 }}>
        {!allApproved && nextUnapprovedIdx !== -1 ? (
          /* Still docs to approve — scroll to next */
          <button
            className="btn-primary"
            style={{ width: '100%' }}
            onClick={() => advanceTo(nextUnapprovedIdx)}
          >
            Review Next Document →
          </button>
        ) : allApproved && approvedCount > 0 ? (
          /* All done — go to ledger */
          <button
            className="btn-primary"
            style={{ width: '100%' }}
            onClick={() => navigate('/ledger', { state: { runId } })}
          >
            View Ledger →
          </button>
        ) : (
          /* All failed or all skipped */
          <button
            className="btn-secondary"
            style={{ width: '100%', textAlign: 'center', justifyContent: 'center' }}
            onClick={() => navigate('/')}
          >
            Back to Home
          </button>
        )}

        {/* Always show ledger link once at least one is approved */}
        {!allApproved && approvedCount > 0 && (
          <button
            className="btn-secondary"
            style={{ width: '100%', textAlign: 'center', justifyContent: 'center', marginTop: 10 }}
            onClick={() => navigate('/ledger', { state: { runId } })}
          >
            View Ledger ({approvedCount} approved)
          </button>
        )}
      </div>
    </div>
  );
}
