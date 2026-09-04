/**
 * HomePage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * BUG D FIX:
 * monthTotal now comes from the server runningTotal, not a client-side
 * .filter().reduce() over the first 100 rows.
 *
 * Request: dateFrom=first-of-month, dateTo=today, status=APPROVED
 * SQL accounting: RECEIPT+INVOICE add, REFUND subtracts, STATEMENT/DOCUMENT=0
 * Result: approved expenses this month, correct even with >100 entries.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ledgerApi, LedgerEntry } from '../lib/api';
import { docStore } from '../lib/docStore';
import type { CapturedDoc } from '../lib/docStore';

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });
}
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function HomePage() {
  const navigate = useNavigate();
  const [monthTotal, setMonthTotal] = useState<number | null>(null);
  const [docCount,   setDocCount]   = useState<number | null>(null);
  const [latestDoc,  setLatestDoc]  = useState<LedgerEntry | null>(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const now     = new Date();
        const dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const dateTo   = now.toISOString().slice(0, 10);

        // monthTotal: approved expenses only, from SQL — not a client-side sum
        // STATEMENT and DOCUMENT contribute 0; REFUND subtracts
        const monthRes = await ledgerApi.getEntries({
          dateFrom,
          dateTo,
          status: 'APPROVED',
          limit: 1,          // we only need runningTotal; entries are irrelevant here
        });
        setMonthTotal(monthRes.runningTotal);
        setDocCount(monthRes.entries.length > 0 ? undefined as any : null); // placeholder

        // Latest document for the card — fetch separately without date/status filter
        const latestRes = await ledgerApi.getEntries({ limit: 1 });
        setLatestDoc(latestRes.entries[0] ?? null);

        // Approved expense document count this month
        const countRes = await ledgerApi.getEntries({
          dateFrom,
          dateTo,
          status: 'APPROVED',
          limit: 500,
        });
        // Count only expense-affecting types
        const expenseCount = countRes.entries.filter(
          e => e.entry_type === 'RECEIPT' || e.entry_type === 'INVOICE' || e.entry_type === 'REFUND'
        ).length;
        setDocCount(expenseCount);

      } catch {
        setMonthTotal(0);
        setDocCount(0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleGallery = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const docs: CapturedDoc[] = [];
    for (const file of files) {
      const base64 = await fileToBase64(file);
      docs.push({ dataUrl: `data:${file.type};base64,${base64}`, base64, mimeType: file.type || 'image/jpeg', fileName: file.name });
    }
    docStore.set(docs);
    navigate('/processing');
  }, [navigate]);

  const docTypeLabel = (t: string) => {
    const map: Record<string, string> = { RECEIPT:'Receipt', INVOICE:'Invoice', STATEMENT:'Statement', DOCUMENT:'Document' };
    return map[t] ?? t;
  };

  return (
    <div className="home-screen">
      <div className="home-topbar">
        <span className="home-brand">FME</span>
        <button className="home-ledger-btn" onClick={() => navigate('/ledger')}>View Ledger</button>
      </div>

      <div className="home-summary">
        <div className="home-total">{loading ? '—' : fmt(monthTotal ?? 0)}</div>
        <div className="home-doc-count">
          {loading ? '' : `Approved expenses this month · ${docCount ?? 0} document${docCount !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="home-headline">
        <div className="home-headline-snap">SNAP IT.</div>
        <div className="home-headline-forget">FORGET IT.</div>
      </div>

      <div className="home-camera-wrap">
        <button className="home-camera-btn" onClick={() => navigate('/camera')} aria-label="Snap a document">
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <path d="M26 34a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" fill="#000"/>
            <path d="M46 16h-5.2l-2.6-4H13.8l-2.6 4H6a4 4 0 0 0-4 4v22a4 4 0 0 0 4 4h40a4 4 0 0 0 4-4V20a4 4 0 0 0-4-4ZM26 38a13 13 0 1 1 0-26 13 13 0 0 1 0 26Z" fill="#000"/>
          </svg>
        </button>
        <div className="home-camera-hint">Tap to snap a document</div>
      </div>

      <label style={{ display:'block', width:'100%', padding:'16px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:40, color:'var(--cream)', fontSize:16, fontWeight:600, textAlign:'center', cursor:'pointer', marginBottom:12, boxSizing:'border-box' }}>
        📎 Choose from Gallery
        <input type="file" accept="image/*,application/pdf" multiple style={{ display:'none' }} onChange={handleGallery} />
      </label>

      {latestDoc && (
        <div className="home-latest-card" onClick={() => navigate('/ledger')}>
          <div className="home-latest-label">LATEST DOCUMENT</div>
          <div className="home-latest-row">
            <div>
              <div className="home-latest-vendor">{latestDoc.entity ?? 'Unknown'}</div>
              <div className="home-latest-meta">{docTypeLabel(latestDoc.entry_type)}{latestDoc.date ? ` · ${latestDoc.date}` : ''}</div>
            </div>
            <div className="home-latest-amount">{fmt(latestDoc.amount ?? 0)}</div>
          </div>
          <div className="home-latest-status" data-status={latestDoc.status}>
            {latestDoc.status === 'APPROVED' ? '✓ Approved' : latestDoc.status === 'NEEDS_REVIEW' ? 'Needs Review' : latestDoc.status}
          </div>
        </div>
      )}

      <div className="home-actions">
        <button className="home-dashboard-btn" onClick={() => navigate('/accountant')}>View Bookkeeper Dashboard</button>
      </div>
    </div>
  );
}
