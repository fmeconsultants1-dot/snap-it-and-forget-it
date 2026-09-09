/**
 * ResultsPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * BUG A FIX (2026-09-04):
 * Before calling updateAndApprove(), validate the final edited values.
 * For RECEIPT and INVOICE:
 *   - vendor must be non-empty
 *   - date must be non-empty
 *   - total must be a finite number
 *   - total === 0 requires the "Confirm $0.00 is correct" checkbox
 * On failure: show field errors, do NOT call PATCH, do NOT advance.
 * The Approve button remains actionable — tapping it shows errors.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { scanApi, documentApi, ledgerApi, ReviewCorrections, ScanResult } from '../lib/api';
import { fileToCapture } from '../lib/camera';

const CATEGORIES     = ['Food','Transport','Automotive','Travel','Office','Professional','Utilities','Insurance','Medical','Entertainment','Other'];
const PAYMENT_METHODS = ['Cash','Credit','Debit','Cheque','Transfer'];
const DOC_TYPES       = ['RECEIPT','INVOICE','STATEMENT','DOCUMENT'];

interface EditState {
  vendor: string; date: string; doc_type: string; category: string;
  subtotal: string; tax: string; total: string; tax_gst: string; tax_hst: string; tax_pst: string;
  payment_method: string; description: string;
  confirm_zero_total: boolean;
}

interface FieldErrors {
  vendor?: string;
  date?: string;
  total?: string;
  confirm_zero?: string;
}

function seedEdit(ex: ScanResult['extraction'] | undefined): EditState {
  if (!ex || typeof ex !== 'object' || !ex.doc_type) {
    return { vendor:'', date:'', doc_type:'DOCUMENT', category:'', subtotal:'', tax:'', total:'', tax_gst:'', tax_hst:'', tax_pst:'', payment_method:'', description:'', confirm_zero_total: false };
  }
  return {
    vendor:         String(ex.vendor ?? ex.issuer ?? ''),
    date:           ex.date ?? '',
    doc_type:       ex.doc_type ?? 'DOCUMENT',
    category:       ex.category ?? '',
    subtotal:       (ex.subtotal != null && !Number.isNaN(Number(ex.subtotal))) ? String(ex.subtotal) : '',
    tax:            String(ex.tax ?? ((ex.tax_gst ?? 0) + (ex.tax_hst ?? 0) + (ex.tax_pst ?? 0))),
    total:          (ex.total    != null && !Number.isNaN(Number(ex.total)))    ? String(ex.total)    : '',
    tax_gst: String(ex.tax_gst ?? 0), tax_hst: String(ex.tax_hst ?? 0), tax_pst: String(ex.tax_pst ?? 0),
    payment_method: ex.payment_method ?? '',
    description:    ex.description ?? '',
    confirm_zero_total: false,
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

/** Bug A: client-side mirror of server validation. Returns errors or null. */
function validateEdit(edit: EditState): FieldErrors | null {
  const needsValidation = edit.doc_type === 'RECEIPT' || edit.doc_type === 'INVOICE';
  const errors: FieldErrors = {};
  const taxParts = [edit.tax_gst, edit.tax_hst, edit.tax_pst].map(v => Number(v || 0));
  if (taxParts.some(n => !Number.isFinite(n) || n < 0) || Math.round(taxParts.reduce((a, b) => a + b, 0) * 100) !== Math.round(Number(edit.tax || 0) * 100)) {
    errors.total = 'GST, HST and PST must add up to the tax total.';
  }
  if (!needsValidation) return Object.keys(errors).length ? errors : null;
  if (!edit.vendor.trim()) errors.vendor = 'Vendor / Issuer is required.';
  if (!edit.date)          errors.date   = 'Date is required.';
  const totalNum = edit.total !== '' ? parseFloat(edit.total) : null;
  if (totalNum === null || !isFinite(totalNum)) {
    errors.total = 'Enter a valid total amount.';
  } else if (totalNum === 0 && !edit.confirm_zero_total) {
    errors.confirm_zero = 'Confirm that $0.00 is correct before approving.';
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

type ApproveStatus = 'idle' | 'saving' | 'done' | 'error' | 'skipped' | 'manual';

export default function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const runId: string | null = location.state?.runId ?? null;
  const storageKey = `snap-review:${location.state?.editId ?? runId ?? 'unsaved'}`;
  const [initial] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      const incoming: ScanResult[] = location.state?.results ?? [];
      const includesIncoming = Array.isArray(saved?.results) && incoming.every((r, i) => {
        const cached = saved.results[i];
        return cached && cached.documentId === r.documentId && cached.extractionId === r.extractionId && cached.ledgerEntryId === r.ledgerEntryId;
      });
      if (includesIncoming && saved && Array.isArray(saved.results) && saved.results.length === saved.edits?.length && saved.results.length === saved.statuses?.length) return saved;
    } catch {}
    return null;
  });
  const [results, setResults] = useState<ScanResult[]>(initial?.results ?? location.state?.results ?? []);

  const [edits,      setEdits]      = useState<EditState[]>(()         => initial?.edits ?? results.map(r => seedEdit(r.extraction)));
  const [statuses,   setStatuses]   = useState<ApproveStatus[]>(()     => initial?.statuses?.map((s: ApproveStatus) => s === 'saving' ? 'error' : s) ?? results.map(() => 'idle'));
  const [errors,     setErrors]     = useState<string[]>(()            => results.map(() => ''));
  const [fieldErrs,  setFieldErrs]  = useState<(FieldErrors | null)[]>(() => results.map(() => null));
  const [expanded,   setExpanded]   = useState<number>(
    results.findIndex(r => r.status === 'DONE' && r.ledgerEntryId)
  );
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const finalActionRef = useRef<HTMLDivElement | null>(null);
  const savingRef = useRef(false);
  const [manualItems, setManualItems] = useState<number[]>(initial?.manualItems ?? []);
  const retakeInput = useRef<HTMLInputElement | null>(null);
  const retakeIndex = useRef<number | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ results, edits, statuses, manualItems })); } catch {}
  }, [storageKey, results, edits, statuses, manualItems]);

  function updateField(idx: number, field: keyof EditState, value: string | boolean) {
    setEdits(prev => { const n = [...prev]; n[idx] = { ...n[idx]!, [field]: value }; return n; });
    // Clear field error on change
    setFieldErrs(prev => { const n = [...prev]; n[idx] = null; return n; });
  }

  function findNext(afterIdx: number, currentStatuses: ApproveStatus[]): number {
    const pending = (s: ApproveStatus) => s !== 'done' && s !== 'skipped';
    const next = currentStatuses.findIndex((s, i) => i > afterIdx && pending(s));
    return next !== -1 ? next : currentStatuses.findIndex(pending);
  }

  const advanceTo = useCallback((idx: number) => {
    setExpanded(idx);
    setTimeout(() => cardRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, []);

  async function approve(idx: number) {
    const result = results[idx]!;
    if (savingRef.current || statuses[idx] === 'done' || statuses[idx] === 'skipped') return;
    const edit = edits[idx]!;

    // Frontend validation first
    const fe = validateEdit(edit);
    if (fe) {
      setFieldErrs(prev => { const n = [...prev]; n[idx] = fe; return n; });
      return; // do NOT call PATCH
    }

    savingRef.current = true;
    setStatuses(prev => { const n = [...prev]; n[idx] = 'saving'; return n; });
    setErrors(prev => { const n = [...prev]; n[idx] = ''; return n; });

    const totalNum = edit.total !== '' ? parseFloat(edit.total) : null;
    const corrections: ReviewCorrections = {
      vendor:             edit.vendor         || null,
      date:               edit.date           || null,
      doc_type:           edit.doc_type       || null,
      category:           edit.category       || null,
      total:              totalNum,
      subtotal:           edit.subtotal !== '' ? parseFloat(edit.subtotal) : null,
      tax: Number(edit.tax || 0),
      tax_gst: Number(edit.tax_gst || 0), tax_hst: Number(edit.tax_hst || 0), tax_pst: Number(edit.tax_pst || 0),
      payment_method:     edit.payment_method || null,
      description:        edit.description    || null,
      confirm_zero_total: edit.confirm_zero_total,
    };

    try {
      if (result.ledgerEntryId) {
        await ledgerApi.updateAndApprove(result.ledgerEntryId, corrections);
      } else {
        if (!result.documentId) throw new Error('Original document is unavailable. Retake or skip this item.');
        const recovered = await documentApi.manual(result.documentId, corrections);
        if (!recovered.success || recovered.status !== 'APPROVED') {
          throw new Error('Recovery was not approved. Please try again.');
        }
      }
      const updated = statuses.map((s, i) => i === idx ? 'done' : s) as ApproveStatus[];
      setStatuses(updated);
      const nextIdx = findNext(idx, updated);
      if (nextIdx !== -1) advanceTo(nextIdx);
    } catch (e: any) {
      setStatuses(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
      setErrors(prev => { const n = [...prev]; n[idx] = e.message ?? 'Save failed'; return n; });
    } finally {
      savingRef.current = false;
    }
  }

  async function skip(idx: number) {
    if (savingRef.current) return;
    savingRef.current = true;
    setStatuses(prev => prev.map((s, i) => i === idx ? 'saving' : s));
    try {
      const result = results[idx]!;
      if (result.documentId) await documentApi.skip(result.documentId, result.ledgerEntryId || undefined);
      const next = statuses.map((s, i) => i === idx ? 'skipped' : s) as ApproveStatus[];
      setStatuses(next);
      const nextIdx = findNext(idx, next);
      if (nextIdx !== -1) advanceTo(nextIdx);
    } catch (e) {
      setStatuses(prev => prev.map((s, i) => i === idx ? 'error' : s));
      setErrors(prev => prev.map((s, i) => i === idx ? (e instanceof Error ? e.message : 'Skip failed') : s));
    } finally { savingRef.current = false; }
  }

  async function removeItem(idx: number) {
    if (savingRef.current || statuses[idx] === 'done' || results[idx]?.approved) return;
    if (!window.confirm('Delete this unapproved item from review? The original source is retained with an audit record. Other documents will not be affected.')) return;
    await skip(idx);
  }

  function enterManually(idx: number) {
    if (savingRef.current) return;
    setManualItems(prev => prev.includes(idx) ? prev : [...prev, idx]);
    setStatuses(prev => { const n = [...prev]; n[idx] = 'manual'; return n; });
    advanceTo(idx);
  }

  async function retake(file: File) {
    const idx = retakeIndex.current;
    if (idx === null || savingRef.current) return;
    savingRef.current = true;
    setStatuses(prev => prev.map((s, i) => i === idx ? 'saving' : s));
    try {
      if (!runId) throw new Error('Run unavailable. Skip this item and start a new scan.');
      const capture = await fileToCapture(file);
      const response = await scanApi.processDocumentRaw({ runId, sequence: results.length + 1, imageBase64: capture.base64, mimeType: capture.mimeType, fileName: capture.fileName });
      if (!response.results.length) throw new Error('No documents returned. Try again.');
      // Append replacement results; preserve the original result and stored image.

      setEdits(prev => [...prev, ...response.results.map(r => seedEdit(r.extraction))]);
      setStatuses(prev => [...prev.map((s, i) => i === idx ? 'idle' : s), ...response.results.map(() => 'idle' as ApproveStatus)]);
      setErrors(prev => [...prev, ...response.results.map(() => '')]);
      setFieldErrs(prev => [...prev, ...response.results.map(() => null)]);
      setResults(prev => [...prev, ...response.results]);
      const original = results[idx]!;
      if (original.documentId) await documentApi.skip(original.documentId, original.ledgerEntryId || undefined);
      setStatuses(prev => prev.map((s, i) => i === idx ? 'skipped' : s));
      advanceTo(results.length);
    } catch (e) {
      setStatuses(prev => prev.map((s, i) => i === idx ? 'error' : s));
      setErrors(prev => prev.map((s, i) => i === idx ? (e instanceof Error ? e.message : 'Retake failed') : s));
    } finally { savingRef.current = false; retakeIndex.current = null; }
  }

  const approvedCount     = statuses.filter(s => s === 'done').length;
  const skippedCount      = statuses.filter(s => s === 'skipped').length;
  const remainingCount    = results.length - approvedCount - skippedCount;
  const allResolved       = results.length > 0 && remainingCount === 0;
  const successCount      = results.filter(r => r.status === 'DONE').length;
  const failCount         = results.filter(r => r.status === 'FAILED').length;
  const nextUnapprovedIdx = findNext(-1, statuses);

  useEffect(() => {
    if (allResolved) finalActionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [allResolved]);

  return (
    <div className="screen">
      <input ref={retakeInput} type="file" accept="image/*" capture="environment" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void retake(file); }} />
      <div className="fme-mark">FME</div>

      <div style={{ marginBottom: 20, marginTop: 8 }}>
        <h1 style={{ fontSize: 26, color: 'var(--cream)', fontWeight: 800, marginBottom: 4 }}>Review</h1>
        <p style={{ color: 'var(--cream-dim)', fontSize: 14 }}>
          {successCount > 0 && `${successCount} document${successCount !== 1 ? 's' : ''} extracted.`}
          {remainingCount > 0 && ` ${remainingCount} remaining to review.`}
          {skippedCount > 0 && ` ${skippedCount} skipped.`}
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
        const ex        = result.extraction;
        const isEmpty   = isExtractionEmpty(ex);
        const isFailed  = (result.status === 'FAILED' || isEmpty || !result.ledgerEntryId) && !manualItems.includes(idx) && statuses[idx] !== 'done';
        const status    = statuses[idx]!;
        const isOpen    = expanded === idx;
        const edit      = edits[idx]!;
        const fe        = fieldErrs[idx];
        const isDone    = status === 'done';
        const isSaving  = status === 'saving';
        const isError   = status === 'error';
        const isManual  = manualItems.includes(idx);
        const isSkipped = status === 'skipped';
        if (isSkipped) return null;
        const itcFlags  = result.itcFlags ?? [];
        const hasITCNote = itcFlags.some(f => f !== 'ITC_ELIGIBLE' && f !== 'ITC_PST_NOT_RECOVERABLE');
        const needsValidation = edit.doc_type === 'RECEIPT' || edit.doc_type === 'INVOICE';
        const totalNum = edit.total !== '' ? parseFloat(edit.total) : null;
        const showZeroConfirm = needsValidation && totalNum === 0;

        const vendorDisplay = isDone ? (edit.vendor || '—') : (ex?.vendor ?? ex?.issuer ?? null);
        const totalDisplay  = isDone
          ? (edit.total !== '' ? `$${parseFloat(edit.total || '0').toFixed(2)}` : '—')
          : (ex?.total != null && !Number.isNaN(Number(ex?.total)) ? `$${Number(ex.total).toFixed(2)}` : '—');

        const showEditForm = isOpen && !isDone && !isSkipped && (isManual || !isFailed);

        return (
          <div key={idx} ref={el => { cardRefs.current[idx] = el; }} className="review-card"
            style={{ borderColor: isDone ? 'var(--gold)' : isError ? 'var(--red)' : fe ? 'var(--red)' : 'var(--border)' }}>

            {/* Card header */}
            <div className="review-card-header"
              onClick={() => { if (isDone || isSkipped) return; setExpanded(isOpen ? -1 : idx); }}
              style={{ cursor: (isDone || isSkipped) ? 'default' : 'pointer' }}>
              <div style={{ flex: 1 }}>
                <div className="review-vendor">
                  {isDone    && <span style={{ color:'var(--gold)', marginRight:6 }}>✓</span>}
                  {isSkipped && <span style={{ color:'var(--cream-dim)', marginRight:6 }}>↷</span>}
                  {isFailed && !isDone
                    ? <span style={{ color:'var(--red)' }}>Document {idx + 1} — Could not read</span>
                    : isSkipped ? <span style={{ color:'var(--cream-dim)' }}>Document {idx + 1} — Skipped</span>
                    : vendorDisplay ? <span>{vendorDisplay}</span>
                    : <span style={{ color:'var(--cream-dim)' }}>Document {idx + 1}</span>}
                </div>
                {!isFailed && !isSkipped && <div className="review-doctype" data-type={edit.doc_type}>{edit.doc_type}</div>}
                {edit.date && !isFailed && !isSkipped && <div style={{ fontSize:12, color:'var(--cream-dim)', marginTop:2 }}>{edit.date}</div>}
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                {!isFailed && !isSkipped && <div className="review-total">{totalDisplay}</div>}
                <div style={{ fontSize:12, color:'var(--cream-dim)', marginTop:4 }}>
                  {isDone ? '✓ Approved' : isSaving ? 'Saving…' : isSkipped ? 'Skipped' : (isFailed && !isManual) ? '' : isOpen ? '▲' : '▼'}
                </div>
              </div>
            </div>

            {!isDone && !result.approved && <button className="btn-secondary" disabled={statuses.includes('saving')} onClick={() => removeItem(idx)} style={{ marginTop:10 }}>Delete</button>}
            {/* Failed card actions */}
            {isFailed && !isSkipped && (
              <div style={{ marginTop: 12 }}>
                <div style={{ background:'rgba(224,80,80,0.08)', borderRadius:8, padding:'10px 12px', marginBottom:12 }}>
                  <div style={{ fontSize:13, color:'var(--red)', fontWeight:600, marginBottom:4 }}>Could not read this document</div>
                  <div style={{ fontSize:12, color:'var(--cream-dim)' }}>{result.error ?? 'Try retaking in better lighting, or enter manually.'}</div>
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <button className="btn-secondary" disabled={statuses.includes('saving')} onClick={() => { retakeIndex.current = idx; retakeInput.current?.click(); }} style={{ flex:1, justifyContent:'center', fontSize:13 }}>📷 Retake</button>
                  {(result.documentId || result.ledgerEntryId) && <button className="btn-secondary" onClick={() => enterManually(idx)} style={{ flex:1, justifyContent:'center', fontSize:13 }}>✏️ Enter Manually</button>}
                  <button className="btn-secondary" onClick={() => skip(idx)} style={{ flex:1, justifyContent:'center', fontSize:13, color:'var(--cream-dim)' }}>Skip</button>
                </div>
              </div>
            )}

            {isError && !showEditForm && <p role="alert" style={{ color:'var(--red)' }}>{errors[idx]}</p>}
            {/* Editable form */}
            {showEditForm && (
              <div style={{ marginTop: 16 }}>

                {/* Confidence */}
                {(() => {
                  const scores: [string, number | null][] = [
                    ['Vendor', safeConf(ex?.confidence_vendor)], ['Date', safeConf(ex?.confidence_date)],
                    ['Total', safeConf(ex?.confidence_total)],   ['Category', safeConf(ex?.confidence_category)],
                  ].filter(([, v]) => v !== null) as [string, number][];
                  if (!scores.length) return null;
                  return (
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap', paddingBottom:14, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
                      {scores.map(([lbl, pct]) => <div key={lbl} style={{ fontSize:11, color:confColor(pct) }}>{lbl} <strong>{pct}%</strong></div>)}
                    </div>
                  );
                })()}

                <div className="review-section-label">Document</div>

                <label className="review-label">Vendor / Issuer {fe?.vendor && <span style={{ color:'var(--red)', marginLeft:4 }}>← {fe.vendor}</span>}</label>
                <input className="review-input" value={edit.vendor}
                  style={{ borderColor: fe?.vendor ? 'var(--red)' : undefined }}
                  onChange={e => updateField(idx, 'vendor', e.target.value)}
                  placeholder="Vendor or issuer name" />

                <label className="review-label">Date {fe?.date && <span style={{ color:'var(--red)', marginLeft:4 }}>← {fe.date}</span>}</label>
                {ex?.date && ex.confidence_date < 0.90 && <p style={{ color:'var(--gold)', fontSize:13 }} role="status">Verify date — low confidence ({Math.round(ex.confidence_date * 100)}%). Compare the prefilled date with the original document.</p>}
                <input className="review-input" type="date" value={edit.date}
                  style={{ borderColor: fe?.date ? 'var(--red)' : undefined }}
                  onChange={e => updateField(idx, 'date', e.target.value)} />

                <label className="review-label">Document Type</label>
                <select className="review-input" value={edit.doc_type} onChange={e => updateField(idx, 'doc_type', e.target.value)}>
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <label className="review-label">Category</label>
                <select className="review-input" value={edit.category} onChange={e => updateField(idx, 'category', e.target.value)}>
                  <option value="">— select —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <div className="review-section-label" style={{ marginTop:16 }}>Amounts</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                  <div>
                    <label className="review-label">Subtotal</label>
                    <input className="review-input" type="number" step="0.01" min="0" value={edit.subtotal} placeholder="0.00" onChange={e => updateField(idx, 'subtotal', e.target.value)} />
                  </div>
                  <div>
                    <label className="review-label">Tax total</label>
                    <input className="review-input" type="number" step="0.01" min="0" value={edit.tax} onChange={e => updateField(idx, 'tax', e.target.value)} />
                  </div>
                  <div>
                    <label className="review-label">Total {fe?.total && <span style={{ color:'var(--red)' }}>!</span>}</label>
                    <input className="review-input" type="number" step="0.01" min="0" value={edit.total} placeholder="0.00"
                      style={{ borderColor: (fe?.total || fe?.confirm_zero) ? 'var(--red)' : undefined }}
                      onChange={e => updateField(idx, 'total', e.target.value)} />
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                  {(['tax_gst', 'tax_hst', 'tax_pst'] as const).map(field => <div key={field}>
                    <label className="review-label">{field.slice(4).toUpperCase()}</label>
                    <input className="review-input" type="number" min="0" step="0.01" value={edit[field]} onChange={e => updateField(idx, field, e.target.value)} />
                  </div>)}
                </div>
                {/* Zero-total confirmation — shown only when total===0 and doc is receipt/invoice */}
                {showZeroConfirm && (
                  <label style={{
                    display:'flex', alignItems:'flex-start', gap:10, marginTop:12,
                    padding:'10px 12px',
                    background: fe?.confirm_zero ? 'rgba(224,80,80,0.08)' : 'rgba(232,160,32,0.08)',
                    borderRadius:8,
                    border: `1px solid ${fe?.confirm_zero ? 'var(--red)' : 'var(--gold)'}`,
                    cursor:'pointer',
                  }}>
                    <input type="checkbox" checked={edit.confirm_zero_total}
                      onChange={e => updateField(idx, 'confirm_zero_total', e.target.checked)}
                      style={{ marginTop:2, flexShrink:0, width:18, height:18 }} />
                    <span style={{ fontSize:13, color: fe?.confirm_zero ? 'var(--red)' : 'var(--gold)', lineHeight:1.4 }}>
                      Confirm $0.00 is correct for this {edit.doc_type.toLowerCase()}
                    </span>
                  </label>
                )}

                {fe?.confirm_zero && !showZeroConfirm && (
                  <p style={{ fontSize:12, color:'var(--red)', marginTop:6 }}>{fe.confirm_zero}</p>
                )}
                {fe?.total && <p style={{ fontSize:12, color:'var(--red)', marginTop:6 }}>{fe.total}</p>}

                <div className="review-section-label" style={{ marginTop:16 }}>Payment</div>
                <label className="review-label">Payment Method</label>
                <select className="review-input" value={edit.payment_method} onChange={e => updateField(idx, 'payment_method', e.target.value)}>
                  <option value="">— select —</option>
                  {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                <div className="review-section-label" style={{ marginTop:16 }}>Notes</div>
                <label className="review-label">Description</label>
                <input className="review-input" value={edit.description} onChange={e => updateField(idx, 'description', e.target.value)} placeholder="Optional note" />

                {/* Line items */}
                {ex?.line_items && ex.line_items.length > 0 && (
                  <div style={{ marginTop:16 }}>
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

                {hasITCNote && (
                  <div style={{ marginTop:14, padding:'10px 12px', background:'rgba(255,140,0,0.1)', borderRadius:8, borderLeft:'3px solid var(--gold)' }}>
                    <div style={{ fontSize:11, color:'var(--gold)', fontWeight:700 }}>ITC Note</div>
                    <div style={{ fontSize:11, color:'var(--cream-dim)', marginTop:2 }}>{itcFlags.filter(f => f !== 'ITC_ELIGIBLE' && f !== 'ITC_PST_NOT_RECOVERABLE').join(' · ')}</div>
                  </div>
                )}

                {isError && <p style={{ fontSize:12, color:'var(--red)', marginTop:10 }}>{errors[idx] || 'Save failed. Please try again.'}</p>}

                <button className="btn-primary" onClick={() => approve(idx)} disabled={statuses.includes('saving')} style={{ marginTop:20, width:'100%' }}>
                  {isSaving ? 'Saving…' : '✓ Approve & Save'}
                </button>
                <button className="btn-secondary" onClick={() => skip(idx)} disabled={statuses.includes('saving')} style={{ marginTop:10 }}>Skip</button>
              </div>
            )}

            {isDone && <div style={{ marginTop:8, fontSize:13, color:'var(--gold)' }}>✓ Saved to ledger.</div>}
          </div>
        );
      })}

      {/* Bottom CTA */}
      <div ref={finalActionRef} style={{ marginTop:24, marginBottom:16 }}>
        {!allResolved && nextUnapprovedIdx !== -1 ? (
          <button className="btn-primary" style={{ width:'100%' }} onClick={() => advanceTo(nextUnapprovedIdx)}>
            Review Next Document →
          </button>
        ) : allResolved ? (
          <button className="btn-primary" style={{ width:'100%' }} onClick={() => navigate('/ledger', { state: { runId } })}>
            View Ledger →
          </button>
        ) : (
          <button className="btn-secondary" style={{ width:'100%', textAlign:'center', justifyContent:'center' }} onClick={() => navigate('/')}>
            Back to Home
          </button>
        )}
      </div>
    </div>
  );
}
