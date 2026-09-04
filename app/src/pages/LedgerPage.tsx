/**
 * LedgerPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * BUG D FIX:
 * - runningTotal is now filter-aware (backend fix in LedgerService)
 * - Total label changes per tab to reflect accounting meaning
 * - Statements tab: hides monetary total, shows reference-document note
 * - No redesign — layout unchanged
 */
import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ledgerApi, LedgerEntry, JournalEntry } from '../lib/api';

const API_URL = import.meta.env.VITE_API_URL ?? '';

type ViewMode = 'register' | 'journal';
type TabId = 'this_run' | 'today' | 'all' | 'receipts' | 'statements' | 'review';

const TABS: { id: TabId; label: string }[] = [
  { id: 'this_run',   label: 'This Run' },
  { id: 'today',      label: 'Today' },
  { id: 'all',        label: 'All' },
  { id: 'receipts',   label: 'Receipts' },
  { id: 'statements', label: 'Statements' },
  { id: 'review',     label: '🚩 Review' },
];

function buildParams(tab: TabId, runId: string | null) {
  switch (tab) {
    case 'this_run':   return { runId: runId ?? undefined };
    case 'today':      return { dateFilter: 'today' };
    case 'receipts':   return { entryType: 'RECEIPT' };
    case 'statements': return { entryType: 'STATEMENT' };
    case 'review':     return { status: 'NEEDS_REVIEW' };
    default:           return {};
  }
}

/** Total label per tab — Bug D */
function totalLabel(tab: TabId): string {
  switch (tab) {
    case 'review':     return 'Pending Expense Total';
    case 'receipts':   return 'Receipt Total';
    case 'this_run':   return 'Expense Total';
    case 'today':      return 'Expense Total';
    default:           return 'Expense Total';
  }
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
  display: 'flex', alignItems: 'flex-end', zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: '16px 16px 0 0',
  padding: 24, width: '100%', maxWidth: 480, margin: '0 auto',
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--cream-dim)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, marginTop: 10,
};
const inp: React.CSSProperties = {
  width: '100%', background: '#111', border: '1px solid var(--border)',
  color: 'var(--cream)', borderRadius: 8, padding: '9px 12px',
  fontSize: 14, marginBottom: 4, fontFamily: 'inherit', boxSizing: 'border-box',
};

function RefundModal({ entry, onClose, onDone }: { entry: LedgerEntry; onClose: () => void; onDone: () => void }) {
  const [type,    setType]    = useState('FULL');
  const [amount,  setAmount]  = useState(entry.amount.toFixed(2));
  const [date,    setDate]    = useState(new Date().toISOString().slice(0, 10));
  const [memo,    setMemo]    = useState('');
  const [idemKey]             = useState(`ref-${entry.id}-${Date.now()}`);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [guard,   setGuard]   = useState<any>(null);
  useEffect(() => {
    fetch(`${API_URL}/api/refund/guard/${entry.id}?amount=0`).then(r => r.json()).then(setGuard).catch(() => {});
  }, [entry.id]);
  const submit = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/refund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalLedgerEntryId: entry.id, refundType: type, refundAmount: parseFloat(amount), refundDate: date, memo: memo || undefined, idempotencyKey: idemKey }),
      });
      const data = await res.json() as any;
      if (!res.ok) { setError(data.error ?? 'Refund failed'); return; }
      onDone();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  return (
    <div style={overlay}><div style={modal}>
      <h2 style={{ marginBottom: 12, color: 'var(--cream)' }}>Refund / Reverse</h2>
      <p style={{ color: 'var(--cream-dim)', fontSize: 13, marginBottom: 12 }}>
        {entry.entity} — Original: ${entry.amount.toFixed(2)}
        {guard && <span style={{ color: 'var(--green)', marginLeft: 8 }}>Remaining: ${guard.remainingRefundable?.toFixed(2)}</span>}
      </p>
      <label style={lbl}>Refund Type</label>
      <select value={type} onChange={e => setType(e.target.value)} style={inp}>
        <option value="FULL">Full Refund</option>
        <option value="PARTIAL">Partial Refund</option>
        <option value="CREDIT_NOTE">Supplier Credit Note (AP)</option>
        <option value="CARD_REFUND">Card Refund</option>
      </select>
      {type !== 'FULL' && (<><label style={lbl}>Refund Amount ($)</label>
        <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={inp} /></>)}
      <label style={lbl}>Date</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
      <label style={lbl}>Memo</label>
      <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="Reason" style={inp} />
      {error && <p style={{ color: 'var(--red)', fontSize: 13, margin: '8px 0' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn-approve" onClick={submit} disabled={loading} style={{ flex: 1 }}>{loading ? 'Processing…' : 'Create Refund'}</button>
        <button className="btn-secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
      </div>
    </div></div>
  );
}

function SplitModal({ entry, onClose, onDone }: { entry: LedgerEntry; onClose: () => void; onDone: () => void }) {
  const ACCOUNTS = [
    { code: '5010', name: 'Operating Expenses' }, { code: '5020', name: 'Meals & Entertainment' },
    { code: '5030', name: 'Travel' }, { code: '5040', name: 'Vehicle' },
    { code: '5050', name: 'Office Supplies' }, { code: '5060', name: 'Professional Fees' },
    { code: '5070', name: 'Utilities' },
  ];
  const [lines, setLines] = useState([
    { description: '', account_code: '5050', account_name: 'Office Supplies', subtotal: '', business: true },
    { description: '', account_code: '5010', account_name: 'Operating Expenses', subtotal: '', business: true },
  ]);
  const [gst, setGst] = useState('0'); const [hst, setHst] = useState('0'); const [pst, setPst] = useState('0');
  const [date, setDate] = useState(entry.date ?? new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const totalWithTax  = entry.amount;
  const totalSubtotal = totalWithTax - (parseFloat(gst)||0) - (parseFloat(hst)||0) - (parseFloat(pst)||0);
  const subtotalSum   = lines.reduce((s, l) => s + (parseFloat(l.subtotal)||0), 0);
  const diff          = Math.abs(Math.round((subtotalSum - totalSubtotal) * 100));
  const submit = async () => {
    if (diff > 1) { setError(`Subtotals must sum to $${totalSubtotal.toFixed(2)}`); return; }
    setLoading(true); setError('');
    try {
      const accMap: Record<string,string> = {};
      ACCOUNTS.forEach(a => { accMap[a.code] = a.name; });
      const res = await fetch(`${API_URL}/api/ledger/${entry.id}/split`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splits: lines.map(l => ({ description: l.description || l.account_name, expense_account_code: l.account_code, expense_account_name: accMap[l.account_code] ?? l.account_name, allocated_subtotal: parseFloat(l.subtotal)||0, is_business_use: l.business })),
          total_gst: parseFloat(gst)||0, total_hst: parseFloat(hst)||0, total_pst: parseFloat(pst)||0,
          total_subtotal: totalSubtotal, total_with_tax: totalWithTax,
          settlement_account_code: '1040', settlement_account_name: 'Credit Card Payable', date,
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) { setError(data.error ?? 'Split failed'); return; }
      onDone();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  return (
    <div style={overlay}><div style={{ ...modal, maxHeight: '90vh', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8, color: 'var(--cream)' }}>Split Transaction</h2>
      <p style={{ color: 'var(--cream-dim)', fontSize: 13, marginBottom: 12 }}>{entry.entity} — ${entry.amount.toFixed(2)}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {([['GST', gst, setGst], ['HST', hst, setHst], ['PST', pst, setPst]] as const).map(([l, v, fn]) => (
          <div key={l} style={{ flex: 1 }}><label style={lbl}>{l} ($)</label>
            <input type="number" step="0.01" value={v} onChange={e => (fn as any)(e.target.value)} style={inp} /></div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--cream-dim)', marginBottom: 10 }}>
        Subtotal: <strong>${totalSubtotal.toFixed(2)}</strong> 
        Split sum: <strong style={{ color: diff<=1?'var(--green)':'var(--red)' }}>${subtotalSum.toFixed(2)}</strong>
      </p>
      {lines.map((line, i) => (
        <div key={i} style={{ background: 'var(--bg-card-2)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--gold)' }}>Line {i+1}</span>
            {lines.length > 1 && <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setLines(p => p.filter((_,idx)=>idx!==i))}>Remove</button>}
          </div>
          <input placeholder="Description" value={line.description} style={{ ...inp, marginBottom: 4 }} onChange={e => setLines(p => p.map((l,idx)=>idx===i?{...l,description:e.target.value}:l))} />
          <select value={line.account_code} style={{ ...inp, marginBottom: 4 }} onChange={e => { const a = ACCOUNTS.find(a=>a.code===e.target.value); setLines(p => p.map((l,idx)=>idx===i?{...l,account_code:e.target.value,account_name:a?.name??''}:l)); }}>
            {ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" step="0.01" placeholder="Subtotal" value={line.subtotal} style={{ ...inp, flex:1, marginBottom:0 }} onChange={e => setLines(p => p.map((l,idx)=>idx===i?{...l,subtotal:e.target.value}:l))} />
            <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'var(--cream-dim)', whiteSpace:'nowrap' }}>
              <input type="checkbox" checked={line.business} onChange={e => setLines(p => p.map((l,idx)=>idx===i?{...l,business:e.target.checked}:l))} />Business
            </label>
          </div>
        </div>
      ))}
      <button className="btn-secondary" onClick={() => setLines(p=>[...p,{description:'',account_code:'5010',account_name:'Operating Expenses',subtotal:'',business:true}])} style={{ width:'100%', marginBottom:10 }}>+ Add Line</button>
      {error && <p style={{ color:'var(--red)', fontSize:13, margin:'6px 0' }}>{error}</p>}
      <label style={lbl}>Date</label>
      <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ ...inp, marginBottom:12 }} />
      <div style={{ display:'flex', gap:10 }}>
        <button className="btn-approve" onClick={submit} disabled={loading||diff>1} style={{ flex:1 }}>{loading?'Splitting…':'Apply Split'}</button>
        <button className="btn-secondary" onClick={onClose} style={{ flex:1 }}>Cancel</button>
      </div>
    </div></div>
  );
}

function SourceModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`${API_URL}/api/ledger/${entryId}/source`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.blob(); })
      .then(blob => setSrc(URL.createObjectURL(blob)))
      .catch(() => setErr('Source document not available'));
  }, [entryId]);
  return (
    <div style={overlay} onClick={onClose}><div style={{ ...modal, padding: 8 }} onClick={e => e.stopPropagation()}>
      {err ? <p style={{ color: 'var(--cream-dim)', padding: 16 }}>{err}</p>
           : src ? <img src={src} alt="Source document" style={{ width: '100%', borderRadius: 8 }} />
                 : <div className="spinner" />}
      <button className="btn-secondary" onClick={onClose} style={{ width:'100%', marginTop:8 }}>Close</button>
    </div></div>
  );
}

export default function LedgerPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const runId: string | null = location.state?.runId ?? null;

  const [view,           setView]          = useState<ViewMode>('register');
  const [tab,            setTab]           = useState<TabId>(runId ? 'this_run' : 'today');
  const [ledgerEntries,  setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [journalEntries, setJournalEntries]= useState<JournalEntry[]>([]);
  const [runningTotal,   setRunningTotal]  = useState(0);
  const [loading,        setLoading]       = useState(false);
  const [approvingId,    setApprovingId]   = useState<string | null>(null);
  const [refundEntry,    setRefundEntry]   = useState<LedgerEntry | null>(null);
  const [splitEntry,     setSplitEntry]    = useState<LedgerEntry | null>(null);
  const [sourceEntryId,  setSourceEntryId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams(tab, runId);
      if (view === 'register') {
        const res = await ledgerApi.getEntries(params);
        const seen = new Set<string>();
        setLedgerEntries(res.entries.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; }));
        setRunningTotal(res.runningTotal); // now filter-consistent
      } else {
        const res = await ledgerApi.getJournalEntries(params);
        const seen = new Set<string>();
        setJournalEntries(res.entries.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; }));
      }
    } finally { setLoading(false); }
  }, [view, tab, runId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try { await ledgerApi.approve(id); await fetchData(); } finally { setApprovingId(null); }
  };

  const isStatementTab = tab === 'statements';

  return (
    <div className="screen" style={{ overflowX: 'hidden' }}>
      <div className="fme-mark">FME</div>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:32, marginBottom:16 }}>
        <h1 style={{ color:'var(--cream)', fontSize:26 }}>Ledger</h1>
        <button className="btn-secondary" onClick={() => navigate('/')} style={{ fontSize:12 }}>← Home</button>
      </div>

      <div className="view-toggle" style={{ marginBottom:12 }}>
        <button className={view==='register'?'active':''} onClick={()=>setView('register')}>Register</button>
        <button className={view==='journal' ?'active':''} onClick={()=>setView('journal')}>Accounting Journal</button>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`tab${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {loading && <div className="spinner" />}

      {!loading && view === 'register' && (
        <>
          {ledgerEntries.length === 0 && <div className="empty-state">No records found.</div>}
          {ledgerEntries.length > 0 && (
            <>
              {/* Total row — Statements tab shows reference note instead of monetary total */}
              {isStatementTab ? (
                <div style={{ fontSize:12, color:'var(--cream-dim)', marginBottom:12, padding:'8px 10px', background:'var(--bg-card)', borderRadius:8 }}>
                  Statements are reference documents and are not included in expenses.
                </div>
              ) : (
                <div style={{ fontSize:13, color:'var(--cream-dim)', marginBottom:12 }}>
                  {totalLabel(tab)}: <strong style={{ color:'var(--gold)' }}>${runningTotal.toFixed(2)}</strong>
                </div>
              )}

              {ledgerEntries.map(entry => (
                <div key={entry.id} className="ledger-row" style={{ minWidth:0 }}>
                  <div style={{ minWidth:0 }}>
                    <div className="ledger-date">{entry.date ?? '—'}</div>
                    <div className="ledger-type">{entry.entry_type}</div>
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div className="ledger-entity">{entry.entity ?? '—'}</div>
                    <span className={`badge ${entry.status}`} style={{ marginTop:4, display:'inline-block' }}>{entry.status.replace('_',' ')}</span>
                    <div style={{ display:'flex', gap:5, marginTop:6, flexWrap:'wrap' }}>
                      {!['REFUND','CREDIT_NOTE'].includes(entry.entry_type) && (
                        <button className="btn-secondary" style={{ fontSize:10, padding:'2px 8px' }} onClick={()=>setRefundEntry(entry)}>↩ Refund</button>
                      )}
                      <button className="btn-secondary" style={{ fontSize:10, padding:'2px 8px' }} onClick={()=>setSplitEntry(entry)}>✂ Split</button>
                      <button className="btn-secondary" style={{ fontSize:10, padding:'2px 8px' }} onClick={()=>setSourceEntryId(entry.id)}>📄 Doc</button>
                    </div>
                  </div>
                  <div style={{ minWidth:0, textAlign:'right' }}>
                    <div className={`ledger-amount ${entry.balance_type}`}>
                      {entry.balance_type==='DEBIT' ? `DR $${entry.amount.toFixed(2)}` : `$${entry.amount.toFixed(2)}`}
                    </div>
                    <div style={{ fontSize:10, color:'var(--cream-dim)', marginTop:2 }}>
                      {entry.balance_type==='DEBIT'?'Debit':entry.balance_type==='CREDIT'?'Credit':'Balance'}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          <button className="btn-primary" onClick={()=>navigate('/camera')}>Scan More Documents</button>
        </>
      )}

      {!loading && view === 'journal' && (
        <>
          {journalEntries.length === 0 && <div className="empty-state">No records found.</div>}
          {journalEntries.map(entry => (
            <div key={entry.id} className="journal-card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, color:'var(--cream-dim)', marginBottom:4 }}>
                    <span className={`badge ${entry.entry_type}`}>{entry.entry_type}</span>{' '}
                    {entry.entry_date}{' '}<span style={{ color:'var(--gray)' }}>#{entry.ref_number}</span>
                  </div>
                  <div style={{ fontSize:16, fontWeight:700, color:'var(--cream)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{entry.entity}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0, marginLeft:8 }}>
                  <span className={`badge ${entry.status}`}>{entry.status}</span>
                  <button className="btn-secondary" style={{ fontSize:11 }} onClick={()=>setSourceEntryId(entry.ledger_entry_id)}>📄 Source</button>
                </div>
              </div>
              <table className="journal-table">
                <thead><tr><th style={{ width:'55%' }}>ACCOUNT</th><th>DEBIT</th><th>CREDIT</th></tr></thead>
                <tbody>
                  {(entry.lines ?? []).map((line, li) => (
                    <tr key={li}>
                      <td style={{ color:'var(--cream-dim)', overflow:'hidden', textOverflow:'ellipsis' }}>{line.account_code}–{line.account_name}</td>
                      <td>{line.debit  > 0 ? `$${line.debit.toFixed(2)}`  : '—'}</td>
                      <td>{line.credit > 0 ? `$${line.credit.toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
                <span className="balanced-badge">{entry.is_balanced ? '✓ Balanced' : '⚠ Unbalanced'}</span>
              </div>
              {(entry.status === 'DRAFT' || entry.status === 'NEEDS_REVIEW') && (
                <button className="btn-approve" style={{ marginTop:10 }} onClick={() => handleApprove(entry.ledger_entry_id)} disabled={approvingId === entry.ledger_entry_id}>
                  {approvingId === entry.ledger_entry_id ? 'Approving…' : 'Approve'}
                </button>
              )}
            </div>
          ))}
          {journalEntries.length > 0 && (
            <button className="btn-primary" style={{ marginTop:8 }} onClick={() => { window.location.href = ledgerApi.exportCsv(); }}>Export for Accountant</button>
          )}
          <button className="btn-primary" style={{ marginTop:10, background:'var(--bg-card)', color:'var(--cream)' }} onClick={() => navigate('/camera')}>Scan More Documents</button>
        </>
      )}

      {refundEntry   && <RefundModal entry={refundEntry} onClose={()=>setRefundEntry(null)}   onDone={()=>{setRefundEntry(null);   fetchData();}} />}
      {splitEntry    && <SplitModal  entry={splitEntry}  onClose={()=>setSplitEntry(null)}    onDone={()=>{setSplitEntry(null);    fetchData();}} />}
      {sourceEntryId && <SourceModal entryId={sourceEntryId} onClose={()=>setSourceEntryId(null)} />}
    </div>
  );
}
