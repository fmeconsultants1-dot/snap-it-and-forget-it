/**
 * ResultsPage.tsx - FME Mission 001 - Snap It & Forget It
 * Results after scan: extracted fields, confidence scores, ITC flags, View Ledger.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ScanResult } from '../lib/api';

export default function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const results: ScanResult[] = location.state?.results ?? [];
  const runId: string | null = location.state?.runId ?? null;
  const [expanded, setExpanded] = useState<Set<number>>(new Set(results.map((_, i) => i)));

  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const successful = results.filter(r => r.status === 'DONE');

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>
      <h1 style={{ marginTop: 32 }}>Done!</h1>
      <p className="subtext">{successful.length} of {results.length} processed successfully</p>

      {results.map((result, idx) => {
        const ex = result.extraction;
        const isExpanded = expanded.has(idx);
        const vendor = ex?.vendor ?? ex?.issuer ?? 'Unknown';
        const amount = ex?.total ?? 0;
        const docType = ex?.doc_type ?? 'DOCUMENT';
        const isFailed = result.status === 'FAILED';
        const itcFlags: string[] = (result as any).itcFlags ?? [];
        const hasItcIssue = itcFlags.some(f => f.includes('INCOMPLETE') || f.includes('NOT_REGISTERED') || f.includes('LOW_CONFIDENCE'));

        return (
          <div key={idx} className="card" style={{ cursor: 'pointer' }}>
            <div className="card-header" onClick={() => toggle(idx)}>
              <div>
                <div className="card-vendor">{isFailed ? 'Failed' : vendor}</div>
                <div className={`doc-type-label ${docType}`}>{docType}</div>
                {ex?.date && <div className="date-label">{ex.date}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                {!isFailed && amount > 0 && <div className="card-amount">${amount.toFixed(2)}</div>}
                <div style={{ color: 'var(--gray)', fontSize: 12, marginTop: 4 }}>{isExpanded ? '\u25B2' : '\u25BC'}</div>
              </div>
            </div>

            {isExpanded && !isFailed && (
              <div>
                <Field label="vendor" value={ex.vendor} />
                <Field label="date" value={ex.date} />
                <Field label="total" value={ex.total != null ? `$${ex.total.toFixed(2)}` : null} />
                <Field label="subtotal" value={ex.subtotal != null ? `$${ex.subtotal.toFixed(2)}` : null} />
                <Field label="tax" value={ex.tax != null ? `$${ex.tax.toFixed(2)}` : null} />
                <Field label="payment method" value={ex.payment_method} />
                <Field label="category" value={ex.category} />
                {ex.description && <Field label="description" value={ex.description} />}
                {ex.issuer && <Field label="issuer" value={ex.issuer} />}

                {ex.line_items && ex.line_items.length > 0 && (
                  <div className="field-row" style={{ alignItems: 'flex-start' }}>
                    <span className="field-label">line items</span>
                    <div style={{ flex: 1, textAlign: 'right' }}>
                      {ex.line_items.map((li, li_idx) => (
                        <div key={li_idx} style={{ fontSize: 12, marginBottom: 2 }}>
                          <span style={{ color: 'var(--white-dim)' }}>{li.name} \u00D7{li.quantity} @${li.unit_price.toFixed(2)} </span>
                          <span className="field-value gold">${li.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <Confidence label="confidence vendor" value={ex.confidence_vendor} />
                  <Confidence label="confidence date" value={ex.confidence_date} />
                  <Confidence label="confidence total" value={ex.confidence_total} />
                  <Confidence label="confidence category" value={ex.confidence_category} />
                </div>

                {hasItcIssue && (
                  <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--needs-review-bg)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--needs-review-text)', fontWeight: 700 }}>ITC Review Required</div>
                    <div style={{ fontSize: 11, color: 'var(--gray-light)', marginTop: 2 }}>
                      {itcFlags.filter(f => f !== 'ITC_PST_NOT_RECOVERABLE').join(' \u00B7 ')}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isExpanded && isFailed && (
              <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 8 }}>{result.error ?? 'Processing failed'}</p>
            )}
          </div>
        );
      })}

      <button className="btn-primary" onClick={() => navigate('/ledger', { state: { runId } })} style={{ marginTop: 24 }}>
        View Ledger
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (value == null || value === '') return null;
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  );
}

function Confidence({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value" style={{ color: pct >= 80 ? 'var(--white)' : 'var(--gray-light)' }}>{pct}%</span>
    </div>
  );
}
