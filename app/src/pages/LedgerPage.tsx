/**
 * LedgerPage.tsx - FME Mission 001 - Snap It & Forget It
 * Complete ledger: Register + Journal, all tabs, Approve, Source, Refund, Split
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ledgerApi, LedgerEntry, JournalEntry } from '../lib/api';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

type ViewMode = 'register' | 'journal';
type TabId = 'this_run' | 'today' | 'all' | 'receipts' | 'statements' | 'review';

const TABS: { id: TabId; label: string }[] = [
  { id: 'this_run', label: 'This Run' },
  { id: 'today', label: 'Today' },
  { id: 'all', label: 'All' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'statements', label: 'Statements' },
  { id: 'review', label: '\uD83D\uDEA9 Review' },
];

function buildParams(tab: TabId, runId: string | null) {
  switch (tab) {
    case 'this_run': return { runId: runId ?? undefined };
    case 'today':    return { dateFilter: 'today' };
    case 'receipts': return { entryType: 'RECEIPT' };
    case 'statements': return { entryType: 'STATEMENT' };
    case 'review':   return { status: 'NEEDS_REVIEW' };
    default:         return {};
  }
}

// ---- Refund Modal ----
function RefundModal({ entry, onClose, onDone }: {
  entry: LedgerEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState('FULL');
  const [amount, setAmount] = useState(entry.amount.toFixed(2));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [idemKey] = useState(`ref-${entry.id}-${Date.now()}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [guard, setGuard] = useState<any>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/refund/guard/${entry.id}?amount=0`)
      .then(r => r.json()).then(setGuard).catch(() => {});
  }, [entry.id]);

  const submit = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalLedgerEntryId: entry.id,
          refundType: type,
          refundAmount: parseFloat(amount),
          refundDate: date,
          memo: memo || undefined,
          idempotencyKey: idemKey,
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) { setError(data.error ?? 'Refund failed'); return; }
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <h2 style={{ marginBottom: 16 }}>Refund / Reverse</h2>
        <p style={{ color: 'var(--gray-light)', fontSize: 13, marginBottom: 16 }}>
          {entry.entity} &mdash; Original: ${entry.amount.toFixed(2)}
          {guard && <span style={{ color: 'var(--green)', marginLeft: 8 }}>
            Remaining: ${guard.remainingRefundable?.toFixed(2)}
          </span>}
        </p>

        <label style={label}>Refund Type</label>
        <select value={type} onChange={e => setType(e.target.value)} style={input}>
          <option value="FULL">Full Refund</option>
          <option value="PARTIAL">Partial Refund</option>
          <option value="CREDIT_NOTE">Supplier Credit Note (AP)</option>
          <option value="CARD_REFUND">Card Refund (settlement override)</option>
        </select>

        {type !== 'FULL' && (
          <><label style={label}>Refund Amount ($)</label>
          <input type="number" step="0.01" value={amount}
            onChange={e => setAmount(e.target.value)} style={input} /></>)}

        <label style={label}>Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />

        <label style={label}>Memo (optional)</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
          placeholder="Reason for refund" style={input} />

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn-approve" onClick={submit} disabled={loading} style={{ flex: 1 }}>
            {loading ? 'Processing...' : 'Create Refund Entry'}
          </button>
          <button className="btn-secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 12 }}>
          Original entry preserved. Reversing journal entry created.
        </p>
      </div>
    </div>
  );
}

// ---- Split Modal ----
function SplitModal({ entry, onClose, onDone }: {
  entry: LedgerEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState([
    { description: '', account_code: '5050', account_name: 'Office Supplies', subtotal: '', business: true, category: '' },
    { description: '', account_code: '5010', account_name: 'Operating Expenses', subtotal: '', business: true, category: '' },
  ]);
  const [gst, setGst] = useState('0');
  const [hst, setHst] = useState('0');
  const [pst, setPst] = useState('0');
  const [date, setDate] = useState(entry.date ?? new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ACCOUNTS = [
    { code: '5010', name: 'Operating Expenses' },
    { code: '5020', name: 'Meals & Entertainment' },
    { code: '5030', name: 'Travel' },
    { code: '5040', name: 'Vehicle' },
    { code: '5050', name: 'Office Supplies' },
    { code: '5060', name: 'Professional Fees' },
    { code: '5070', name: 'Utilities' },
  ];

  const subtotalSum = lines.reduce((s, l) => s + (parseFloat(l.subtotal) || 0), 0);
  const totalWithTax = entry.amount;
  const totalSubtotal = totalWithTax - parseFloat(gst) - parseFloat(hst) - parseFloat(pst);
  const diff = Math.abs(Math.round((subtotalSum - totalSubtotal) * 100));

  const addLine = () => setLines(prev => [...prev, { description: '', account_code: '5010', account_name: 'Operating Expenses', subtotal: '', business: true, category: '' }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (diff > 1) { setError(`Split subtotals must sum to $${totalSubtotal.toFixed(2)} (currently $${subtotalSum.toFixed(2)})`); return; }
    setLoading(true); setError('');
    try {
      const acc: Record<string, string> = {};
      ACCOUNTS.forEach(a => { acc[a.code] = a.name; });
      const res = await fetch(`${API_URL}/api/ledger/${entry.id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splits: lines.map(l => ({
            description: l.description || l.account_name,
            expense_account_code: l.account_code,
            expense_account_name: acc[l.account_code] ?? l.account_name,
            allocated_subtotal: parseFloat(l.subtotal) || 0,
            is_business_use: l.business,
            category: l.category || undefined,
          })),
          total_gst: parseFloat(gst) || 0,
          total_hst: parseFloat(hst) || 0,
          total_pst: parseFloat(pst) || 0,
          total_subtotal: totalSubtotal,
          total_with_tax: totalWithTax,
          settlement_account_code: '1040',
          settlement_account_name: 'Credit Card Payable',
          date,
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) { setError(data.error ?? 'Split failed'); return; }
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div style={overlay}>
      <div style={{ ...modal, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginBottom: 8 }}>Split Transaction</h2>
        <p style={{ color: 'var(--gray-light)', fontSize: 13, marginBottom: 16 }}>
          {entry.entity} &mdash; Total: ${entry.amount.toFixed(2)}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[['GST', gst, setGst], ['HST', hst, setHst], ['PST', pst, setPst]].map(([lbl, val, fn]) => (
            <div key={lbl as string} style={{ flex: 1 }}>
              <label style={label}>{lbl as string} ($)</label>
              <input type="number" step="0.01" value={val as string}
                onChange={e => (fn as any)(e.target.value)} style={input} />
            </div>
          ))}
        </div>

        <p style={{ fontSize: 12, color: 'var(--gray-light)', marginBottom: 12 }}>
          Pre-tax subtotal: <strong>${totalSubtotal.toFixed(2)}</strong> &nbsp;
          Split sum: <strong style={{ color: diff <= 1 ? 'var(--green)' : 'var(--red)' }}>${subtotalSum.toFixed(2)}</strong>
        </p>

        {lines.map((line, i) => (
          <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--gold)' }}>Line {i + 1}</span>
              {lines.length > 1 && <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => removeLine(i)}>Remove</button>}
            </div>
            <input placeholder="Description" value={line.description}
              onChange={e => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, description: e.target.value } : l))}
              style={{ ...input, marginBottom: 6 }} />
            <select value={line.account_code}
              onChange={e => {
                const acc = ACCOUNTS.find(a => a.code === e.target.value);
                setLines(prev => prev.map((l, idx) => idx === i ? { ...l, account_code: e.target.value, account_name: acc?.name ?? '' } : l));
              }} style={{ ...input, marginBottom: 6 }}>
              {ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <input type="number" step="0.01" placeholder="Subtotal ($)"
                  value={line.subtotal}
                  onChange={e => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, subtotal: e.target.value } : l))}
                  style={input} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={line.business}
                  onChange={e => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, business: e.target.checked } : l))} />
                <span style={{ fontSize: 12, color: 'var(--gray-light)' }}>Business</span>
              </div>
            </div>
          </div>
        ))}

        <button className="btn-secondary" onClick={addLine} style={{ width: '100%', marginBottom: 12 }}>+ Add Line</button>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <label style={label}>Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...input, marginBottom: 16 }} />

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-approve" onClick={submit} disabled={loading || diff > 1} style={{ flex: 1 }}>
            {loading ? 'Splitting...' : 'Apply Split'}
          </button>
          <button className="btn-secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---- Source image modal ----
function SourceModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`${API_URL}/api/ledger/${entryId}/source`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.blob(); })
      .then(blob => setSrc(URL.createObjectURL(blob)))
      .catch(() => setErr('Source image not available'));
  }, [entryId]);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, padding: 8 }} onClick={e => e.stopPropagation()}>
        {err ? <p style={{ color: 'var(--gray-light)', padding: 16 }}>{err}</p>
          : src ? <img src={src} alt="Source document" style={{ width: '100%', borderRadius: 8 }} />
          : <div className="spinner" />}
        <button className="btn-secondary" onClick={onClose} style={{ width: '100%', marginTop: 8 }}>Close</button>
      </div>
    </div>
  );
}

// Shared styles
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
  display: 'flex', alignItems: 'flex-end', zIndex: 1000,
  padding: '0 0 0 0',
};
const modal: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: '16px 16px 0 0',
  padding: 24, width: '100%', maxWidth: 480, margin: '0 auto',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--gray)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
};
const input: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
  color: 'var(--white)', borderRadius: 8, padding: '8px 12px',
  fontSize: 14, marginBottom: 12, boxSizing: 'border-box' as const,
};

export default function LedgerPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const runId: string | null = location.state?.runId ?? null;

  const [view, setView] = useState<ViewMode>('register');
  const [tab, setTab] = useState<TabId>(runId ? 'this_run' : 'today');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [runningTotal, setRunningTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [refundEntry, setRefundEntry] = useState<LedgerEntry | null>(null);
  const [splitEntry, setSplitEntry] = useState<LedgerEntry | null>(null);
  const [sourceEntryId, setSourceEntryId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams(tab, runId);
      if (view === 'register') {
        const res = await ledgerApi.getEntries(params);
        const seen = new Set<string>();
        setLedgerEntries(res.entries.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; }));
        setRunningTotal(res.runningTotal);
      } else {
        const res = await ledgerApi.getJournalEntries(params);
        const seen = new Set<string>();
        setJournalEntries(res.entries.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; }));
      }
    } finally { setLoading(false); }
  }, [view, tab, runId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleApprove = async (ledgerEntryId: string) => {
    setApprovingId(ledgerEntryId);
    try { await ledgerApi.approve(ledgerEntryId); await fetchData(); }
    finally { setApprovingId(null); }
  };

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>
      <h1 style={{ marginTop: 32, marginBottom: 16 }}>Ledger</h1>

      <div className="view-toggle">
        <button className={view === 'register' ? 'active' : ''} onClick={() => setView('register')}>Register</button>
        <button className={view === 'journal' ? 'active' : ''} onClick={() => setView('journal')}>Accounting Journal</button>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {loading && <div className="spinner" />}

      {/* REGISTER VIEW */}
      {!loading && view === 'register' && (
        <>
          {ledgerEntries.length === 0 && <div className="empty-state">No matching records.</div>}
          {ledgerEntries.length > 0 && (
            <>
              <div className="ledger-header">
                <span>DATE / TYPE</span><span>ENTITY / ACCOUNT</span><span style={{ textAlign: 'right' }}>AMOUNT</span>
              </div>
              {ledgerEntries.map(entry => (
                <div key={entry.id} className="ledger-row">
                  <div>
                    <div className="ledger-date">{entry.date ?? '\u2014'}</div>
                    <div className="ledger-type">{entry.entry_type}</div>
                  </div>
                  <div>
                    <div className="ledger-entity">{entry.entity ?? 'Unknown'}</div>
                    <span className={`badge ${entry.status.replace('_', '-')}`}>{entry.status.replace('_', ' ')}</span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      {!['REFUND','CREDIT_NOTE'].includes(entry.entry_type) && (
                        <button className="btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={() => setRefundEntry(entry)}>↩ Refund</button>
                      )}
                      <button className="btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => setSplitEntry(entry)}>✂ Split</button>
                    </div>
                  </div>
                  <div>
                    <div className={`ledger-amount ${entry.balance_type}`}>
                      {entry.balance_type === 'DEBIT' ? `DR $${entry.amount.toFixed(2)}` : `$${entry.amount.toFixed(2)}`}
                    </div>
                    <div className="ledger-amount-label">{entry.balance_type === 'DEBIT' ? 'Debit' : entry.balance_type === 'CREDIT' ? 'Credit' : 'Balance'}</div>
                  </div>
                </div>
              ))}
            </>
          )}
          <button className="btn-primary" onClick={() => navigate('/camera')}>Scan More Documents</button>
        </>
      )}

      {/* ACCOUNTING JOURNAL VIEW */}
      {!loading && view === 'journal' && (
        <>
          {journalEntries.length === 0 && <div className="empty-state">No matching records.</div>}
          {journalEntries.map(entry => (
            <div key={entry.id} className="journal-card">
              <div className="journal-card-header">
                <div>
                  <div className="journal-meta">
                    <span className={`badge ${entry.entry_type}`}>{entry.entry_type}</span>
                    {' '}{entry.entry_date}{' '}
                    <span style={{ color: 'var(--gray)' }}>#{entry.ref_number}</span>
                  </div>
                  <div className="journal-vendor">{entry.entity}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <span className={`badge ${entry.status}`}>{entry.status === 'DRAFT' ? 'NEEDS REVIEW / DRAFT' : entry.status}</span>
                  <button className="btn-secondary" style={{ fontSize: 11 }}
                    onClick={() => setSourceEntryId(entry.ledger_entry_id)}>○ Source</button>
                </div>
              </div>
              <table className="journal-table">
                <thead><tr><th>ACCOUNT</th><th>DEBIT</th><th>CREDIT</th></tr></thead>
                <tbody>
                  {(entry.lines ?? []).map((line, li) => (
                    <tr key={li}>
                      <td style={{ color: 'var(--white-dim)' }}>{line.account_code}-{line.account_name}</td>
                      <td>{line.debit > 0 ? `$${line.debit.toFixed(2)}` : '\u2014'}</td>
                      <td>{line.credit > 0 ? `$${line.credit.toFixed(2)}` : '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="journal-footer">
                <span className="balanced-badge">{entry.is_balanced ? '\u2713 Balanced' : '\u26A0 Unbalanced'}</span>
                {entry.running_total > 0 && <span style={{ color: 'var(--gray-light)', fontSize: 12 }}>Expenses: ${entry.running_total.toFixed(2)}</span>}
              </div>
              {entry.status === 'DRAFT' && (
                <button className="btn-approve" onClick={() => handleApprove(entry.ledger_entry_id)}
                  disabled={approvingId === entry.ledger_entry_id}>
                  {approvingId === entry.ledger_entry_id ? 'Approving...' : 'Approve'}
                </button>
              )}
            </div>
          ))}
          {journalEntries.length > 0 && (
            <>
              <button className="btn-primary" style={{ marginTop: 16 }}
                onClick={() => { window.location.href = ledgerApi.exportCsv(); }}>Export for Accountant</button>
              <button className="btn-primary" style={{ marginTop: 12, background: 'var(--bg-card)', color: 'var(--white)' }}
                onClick={() => navigate('/camera')}>Scan More Documents</button>
            </>
          )}
        </>
      )}

      {refundEntry && <RefundModal entry={refundEntry} onClose={() => setRefundEntry(null)} onDone={() => { setRefundEntry(null); fetchData(); }} />}
      {splitEntry && <SplitModal entry={splitEntry} onClose={() => setSplitEntry(null)} onDone={() => { setSplitEntry(null); fetchData(); }} />}
      {sourceEntryId && <SourceModal entryId={sourceEntryId} onClose={() => setSourceEntryId(null)} />}
    </div>
  );
}
