/**
 * ResultsPage.tsx
 * FME Mission 001 — Snap It & Forget It
 *
 * Evidence from screenshots 2 + 6:
 *   - "Done!" heading, "4 of 4 processed successfully"
 *   - Cards per document: vendor name, amount (gold), doc type label (gold/orange), date
 *   - Fields: vendor, date, total, subtotal, tax, payment_method, category, line_items
 *   - Line items: name x qty @unit_price in gold
 *   - Confidence scores: confidence vendor/date/total/category as %
 *   - Cards are collapsible (tap header toggles)
 *   - "View Ledger" gold button at bottom
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
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const successful = results.filter(r => r.status === 'DONE');

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <h1 style={{ marginTop: 32 }}>Done!</h1>
      <p className="subtext">
        {successful.length} of {results.length} processed successfully
      </p>

      {results.map((result, idx) => {
        const ex = result.extraction;
        const isExpanded = expanded.has(idx);
        const vendor = ex?.vendor ?? ex?.issuer ?? 'Unknown';
        const amount = ex?.total ?? 0;
        const docType = ex?.doc_type ?? 'DOCUMENT';
        const isFailed = result.status === 'FAILED';

        return (
          <div key={idx} className="card" style={{ cursor: 'pointer' }}>
            {/* Card header — always visible */}
            <div className="card-header" onClick={() => toggle(idx)}>
              <div>
                <div className="card-vendor">{isFailed ? 'Failed' : vendor}</div>
                <div className={`doc-type-label ${docType}`}>{docType}</div>
                {ex?.date && <div className="date-label">{ex.date}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                {!isFailed && amount > 0 && (
                  <div className="card-amount">${amount.toFixed(2)}</div>
                )}
                <div style={{ color: 'var(--gray)', fontSize: 12, marginTop: 4 }}>
                  {isExpanded ? '▲' : '▼'}
                </div>
              </div>
            </div>

            {/* Expanded details */}
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

                {/* Line items */}
                {ex.line_items && ex.line_items.length > 0 && (
                  <div className="field-row" style={{ alignItems: 'flex-start' }}>
                    <span className="field-label">line items</span>
                    <div style={{ flex: 1, textAlign: 'right' }}>
                      {ex.line_items.map((li, li_idx) => (
                        <div key={li_idx} style={{ fontSize: 12, marginBottom: 2 }}>
                          <span style={{ color: 'var(--white-dim)' }}>
                            {li.name} ×{li.quantity} @${li.unit_price.toFixed(2)}{' '}
                          </span>
                          <span className="field-value gold">
                            ${li.total.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Confidence scores */}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <Confidence label="confidence vendor" value={ex.confidence_vendor} />
                  <Confidence label="confidence date" value={ex.confidence_date} />
                  <Confidence label="confidence total" value={ex.confidence_total} />
                  <Confidence label="confidence category" value={ex.confidence_category} />
                </div>
              </div>
            )}

            {isExpanded && isFailed && (
              <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 8 }}>
                {result.error ?? 'Processing failed'}
              </p>
            )}
          </div>
        );
      })}

      <button
        className="btn-primary"
        onClick={() => navigate('/ledger', { state: { runId } })}
        style={{ marginTop: 24 }}
      >
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
      <span className="field-value" style={{ color: pct >= 80 ? 'var(--white)' : 'var(--gray-light)' }}>
        {pct}%
      </span>
    </div>
  );
}
