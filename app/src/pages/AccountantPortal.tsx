/**
 * AccountantPortal.tsx - FME Mission 001 - Snap It & Forget It
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value" style={color ? { color } : {}}>{value}</span>
    </div>
  );
}

export default function AccountantPortal() {
  const navigate = useNavigate();
  const [taxSummary, setTaxSummary] = useState<any>(null);
  const [apSummary, setApSummary] = useState<any>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));

  const withLoad = async (key: string, fn: () => Promise<void>) => {
    setLoading(key);
    try { await fn(); } catch (e: any) { alert(e.message); } finally { setLoading(null); }
  };

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>
      <h1 style={{ marginTop: 32, marginBottom: 4 }}>Accountant Portal</h1>
      <p className="subtext">Export, reports, tax summary, audit trail</p>

      <button className="btn-secondary" onClick={() => navigate('/ledger')}
        style={{ marginBottom: 20, width: '100%', justifyContent: 'center' }}>
        ← Back to Ledger
      </button>

      {/* Date range */}
      <div className="card" style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>FROM</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--white)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>TO</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--white)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%' }} />
        </div>
      </div>

      {/* Exports */}
      <div className="card">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Export</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={`${API_URL}/api/export/ledger?format=csv&dateFrom=${dateFrom}&dateTo=${dateTo}`} download="ledger.csv">
            <button className="btn-secondary">Ledger CSV</button>
          </a>
          <a href={`${API_URL}/api/export/journal?format=csv&dateFrom=${dateFrom}&dateTo=${dateTo}`} download="journal.csv">
            <button className="btn-secondary">Journal CSV</button>
          </a>
          <a href={`${API_URL}/api/export/json`} download="snap-it-full.json">
            <button className="btn-secondary">Full JSON</button>
          </a>
        </div>
      </div>

      {/* Tax Summary */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>GST / HST / PST Summary</h2>
          <button className="btn-secondary" disabled={loading === 'tax'}
            onClick={() => withLoad('tax', async () => {
              const d = await get<any>(`/api/tax/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`);
              setTaxSummary(d);
            })}>
            {loading === 'tax' ? '...' : 'Load'}
          </button>
        </div>
        {taxSummary && (
          <>
            <Row label="Province" value={taxSummary.province ?? 'BC'} />
            <Row label="ITC Registered" value={taxSummary.itc_registered ? 'Yes' : 'No'}
              color={taxSummary.itc_registered ? 'var(--green)' : 'var(--gray-light)'} />
            <Row label="Period" value={`${taxSummary.period_from} — ${taxSummary.period_to}`} />
            <Row label="GST Paid" value={`$${(taxSummary.total_gst_paid ?? 0).toFixed(2)}`} />
            <Row label="HST Paid" value={`$${(taxSummary.total_hst_paid ?? 0).toFixed(2)}`} />
            <Row label="PST Paid" value={`$${(taxSummary.total_pst_paid ?? 0).toFixed(2)}`} />
            <Row label="Total Tax" value={`$${(taxSummary.total_tax_paid ?? 0).toFixed(2)}`} color="var(--gold)" />
            <Row label="ITC Eligible GST" value={`$${(taxSummary.itc_eligible_gst ?? 0).toFixed(2)}`} color="var(--green)" />
            <Row label="ITC Eligible HST" value={`$${(taxSummary.itc_eligible_hst ?? 0).toFixed(2)}`} color="var(--green)" />
            <Row label="ITC Pending Review" value={`$${(taxSummary.itc_pending_review ?? 0).toFixed(2)}`} color="var(--orange)" />
            <Row label="PST (non-recoverable)" value={`$${(taxSummary.non_recoverable_pst ?? 0).toFixed(2)}`} color="var(--gray-light)" />
            <Row label="Entries" value={String(taxSummary.entry_count ?? 0)} />
            {(taxSummary.flagged_count ?? 0) > 0 && (
              <Row label="Flagged for Review" value={String(taxSummary.flagged_count)} color="var(--orange)" />
            )}
          </>
        )}
      </div>

      {/* AP Aging */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>Accounts Payable Aging</h2>
          <button className="btn-secondary" disabled={loading === 'ap'}
            onClick={() => withLoad('ap', async () => {
              const d = await get<any>('/api/ap/summary');
              setApSummary(d);
            })}>
            {loading === 'ap' ? '...' : 'Load'}
          </button>
        </div>
        {apSummary && (
          <>
            <Row label="Total Outstanding" value={`$${(apSummary.total_outstanding ?? 0).toFixed(2)}`} color="var(--orange)" />
            <Row label="Current" value={`$${(apSummary.current ?? 0).toFixed(2)}`} />
            <Row label="31-60 days" value={`$${(apSummary.days_30 ?? 0).toFixed(2)}`} />
            <Row label="61-90 days" value={`$${(apSummary.days_60 ?? 0).toFixed(2)}`} />
            <Row label="90+ days" value={`$${(apSummary.days_90plus ?? 0).toFixed(2)}`}
              color={(apSummary.days_90plus ?? 0) > 0 ? 'var(--red)' : undefined} />
            {(apSummary.entries ?? []).length > 0 && (
              <div style={{ marginTop: 12 }}>
                {apSummary.entries.slice(0, 5).map((e: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '6px 0', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--white-dim)' }}>{e.vendor}</span>
                    <span style={{ color: e.aging_bucket === '90+' ? 'var(--red)' : 'var(--orange)' }}>${e.amount?.toFixed(2)} ({e.days_outstanding}d)</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Refund History */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>Refund History</h2>
          <button className="btn-secondary" disabled={loading === 'refunds'}
            onClick={() => withLoad('refunds', async () => {
              const d = await get<any>('/api/ledger?entryType=REFUND&limit=50');
              setRefunds((d as any).entries ?? []);
            })}>
            {loading === 'refunds' ? '...' : 'Load'}
          </button>
        </div>
        {refunds.length === 0 && loading !== 'refunds' && (
          <div className="empty-state" style={{ padding: '12px 0' }}>Press Load to fetch refund history</div>
        )}
        {refunds.map((r: any, i: number) => (
          <div key={i} style={{ fontSize: 13, borderBottom: '1px solid var(--border)', padding: '8px 0', display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <span style={{ color: 'var(--gold)' }}>#{r.ref_number}</span>
              {' '}<span style={{ color: 'var(--gray-light)' }}>{r.entity}</span>
              <div style={{ fontSize: 11, color: 'var(--gray)' }}>{r.refund_type} · {r.date}</div>
            </div>
            <span style={{ color: 'var(--green)' }}>${(r.refund_amount ?? r.amount ?? 0).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Audit Trail */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>Audit Trail</h2>
          <button className="btn-secondary" disabled={loading === 'audit'}
            onClick={() => withLoad('audit', async () => {
              const d = await get<any>('/api/audit?limit=50');
              setAuditLog((d as any).entries ?? []);
            })}>
            {loading === 'audit' ? '...' : 'Load'}
          </button>
        </div>
        {auditLog.length === 0 && loading !== 'audit' && (
          <div className="empty-state" style={{ padding: '12px 0' }}>Press Load to fetch audit trail</div>
        )}
        {auditLog.map((entry: any, i: number) => (
          <div key={i} style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
            <span style={{ color: 'var(--gold)' }}>{entry.action}</span>
            {' '}<span style={{ color: 'var(--gray-light)' }}>{entry.entity_type} {entry.entity_id?.slice(0, 8)}</span>
            {' '}<span style={{ color: 'var(--gray)' }}>{entry.performed_at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
