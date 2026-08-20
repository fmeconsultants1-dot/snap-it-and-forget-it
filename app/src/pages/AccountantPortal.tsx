/**
 * AccountantPortal.tsx
 * FME Mission 001 — Snap It & Forget It
 *
 * Accountant-facing portal:
 *   - Export ledger CSV
 *   - Export journal CSV
 *   - GST/HST/PST tax summary
 *   - AP aging report
 *   - Audit log
 */

import { useState } from 'react';
import { ledgerApi } from '../lib/api';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function AccountantPortal() {
  const [taxSummary, setTaxSummary] = useState<any>(null);
  const [apSummary, setApSummary] = useState<any>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));

  const loadTax = async () => {
    setLoading('tax');
    try {
      const data = await get<any>(`/api/tax/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      setTaxSummary(data);
    } finally { setLoading(null); }
  };

  const loadAP = async () => {
    setLoading('ap');
    try {
      const data = await get<any>('/api/ap/summary');
      setApSummary(data);
    } finally { setLoading(null); }
  };

  const loadAudit = async () => {
    setLoading('audit');
    try {
      const data = await get<any>('/api/audit?limit=50') as any;
      setAuditLog(data.entries ?? []);
    } finally { setLoading(null); }
  };

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>
      <h1 style={{ marginTop: 32, marginBottom: 8 }}>Accountant Portal</h1>
      <p className="subtext">Export, reports, and audit trail</p>

      {/* Date range */}
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>FROM</div>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--white)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 13,
              width: '100%',
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>TO</div>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--white)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 13,
              width: '100%',
            }}
          />
        </div>
      </div>

      {/* Exports */}
      <div className="card">
        <h2 style={{ marginBottom: 12, fontSize: 16 }}>Export</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={`${API_URL}/api/export/ledger?format=csv&dateFrom=${dateFrom}&dateTo=${dateTo}`}
            download="snap-it-ledger.csv"
          >
            <button className="btn-secondary">Ledger CSV</button>
          </a>
          <a
            href={`${API_URL}/api/export/journal?format=csv&dateFrom=${dateFrom}&dateTo=${dateTo}`}
            download="snap-it-journal.csv"
          >
            <button className="btn-secondary">Journal CSV</button>
          </a>
          <a
            href={`${API_URL}/api/export/json`}
            download="snap-it-full.json"
          >
            <button className="btn-secondary">Full JSON</button>
          </a>
        </div>
      </div>

      {/* Tax Summary */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>GST/HST/PST Summary</h2>
          <button className="btn-secondary" onClick={loadTax} disabled={loading === 'tax'}>
            {loading === 'tax' ? '...' : 'Load'}
          </button>
        </div>
        {taxSummary && (
          <>
            <div className="field-row"><span className="field-label">Period</span><span className="field-value">{taxSummary.period_from} — {taxSummary.period_to}</span></div>
            <div className="field-row"><span className="field-label">GST Paid</span><span className="field-value">${(taxSummary.total_gst_paid ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">HST Paid</span><span className="field-value">${(taxSummary.total_hst_paid ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">PST Paid</span><span className="field-value">${(taxSummary.total_pst_paid ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">Total Tax</span><span className="field-value gold">${(taxSummary.total_tax_paid ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">ITC Eligible</span><span className="field-value gold">${(taxSummary.itc_eligible_gst_hst ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">Entries</span><span className="field-value">{taxSummary.entry_count}</span></div>
          </>
        )}
      </div>

      {/* AP Aging */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>AP Aging</h2>
          <button className="btn-secondary" onClick={loadAP} disabled={loading === 'ap'}>
            {loading === 'ap' ? '...' : 'Load'}
          </button>
        </div>
        {apSummary && (
          <>
            <div className="field-row"><span className="field-label">Total Outstanding</span><span className="field-value orange">${(apSummary.total_outstanding ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">Current</span><span className="field-value">${(apSummary.current ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">31–60 days</span><span className="field-value">${(apSummary.days_30 ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">61–90 days</span><span className="field-value">${(apSummary.days_60 ?? 0).toFixed(2)}</span></div>
            <div className="field-row"><span className="field-label">90+ days</span><span className="field-value" style={{ color: 'var(--red)' }}>${(apSummary.days_90plus ?? 0).toFixed(2)}</span></div>
          </>
        )}
      </div>

      {/* Audit Log */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>Audit Trail</h2>
          <button className="btn-secondary" onClick={loadAudit} disabled={loading === 'audit'}>
            {loading === 'audit' ? '...' : 'Load'}
          </button>
        </div>
        {auditLog.length > 0 && auditLog.map((entry: any, i: number) => (
          <div key={i} style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
            <span style={{ color: 'var(--gold)' }}>{entry.action}</span>
            {' '}<span style={{ color: 'var(--gray-light)' }}>{entry.entity_type} {entry.entity_id?.slice(0, 8)}</span>
            {' '}<span style={{ color: 'var(--gray)' }}>{entry.performed_at}</span>
          </div>
        ))}
        {auditLog.length === 0 && loading !== 'audit' && (
          <div className="empty-state">Press Load to fetch audit trail</div>
        )}
      </div>
    </div>
  );
}
