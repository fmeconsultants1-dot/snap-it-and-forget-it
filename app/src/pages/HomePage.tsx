/**
 * HomePage.tsx - FME Mission 001 - Snap It & Forget It
 * Approved visual design: black/cream/orange, large headline,
 * monthly total, circular camera button, latest document card.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ledgerApi, LedgerEntry } from '../lib/api';

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });
}

export default function HomePage() {
  const navigate = useNavigate();
  const [monthTotal,  setMonthTotal]  = useState<number | null>(null);
  const [docCount,    setDocCount]    = useState<number | null>(null);
  const [latestDoc,   setLatestDoc]   = useState<LedgerEntry | null>(null);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Current month filter
        const now   = new Date();
        const from  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const res   = await ledgerApi.getEntries({ dateFilter: 'today' });
        // Get all-time for month total
        const all   = await ledgerApi.getEntries({});
        const month = all.entries.filter(e => e.date && e.date >= from);
        setMonthTotal(month.reduce((s, e) => s + (e.amount ?? 0), 0));
        setDocCount(month.length);
        setLatestDoc(all.entries[0] ?? null);
      } catch {
        setMonthTotal(0);
        setDocCount(0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const docTypeLabel = (t: string) => {
    const map: Record<string, string> = {
      RECEIPT: 'Receipt', INVOICE: 'Invoice',
      STATEMENT: 'Statement', DOCUMENT: 'Document',
    };
    return map[t] ?? t;
  };

  return (
    <div className="home-screen">
      {/* Top bar */}
      <div className="home-topbar">
        <span className="home-brand">FME</span>
        <button className="home-ledger-btn" onClick={() => navigate('/ledger')}>
          View Ledger
        </button>
      </div>

      {/* Monthly summary */}
      <div className="home-summary">
        <div className="home-total">
          {loading ? '—' : fmt(monthTotal ?? 0)}
        </div>
        <div className="home-doc-count">
          {loading ? '' : `${docCount ?? 0} document${docCount !== 1 ? 's' : ''} this month`}
        </div>
      </div>

      {/* Main headline */}
      <div className="home-headline">
        <div className="home-headline-snap">SNAP IT.</div>
        <div className="home-headline-forget">FORGET IT.</div>
      </div>

      {/* Large circular camera button */}
      <div className="home-camera-wrap">
        <button
          className="home-camera-btn"
          onClick={() => navigate('/camera')}
          aria-label="Snap a document"
        >
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <path d="M26 34a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" fill="#000"/>
            <path d="M46 16h-5.2l-2.6-4H13.8l-2.6 4H6a4 4 0 0 0-4 4v22a4 4 0 0 0 4 4h40a4 4 0 0 0 4-4V20a4 4 0 0 0-4-4ZM26 38a13 13 0 1 1 0-26 13 13 0 0 1 0 26Z" fill="#000"/>
          </svg>
        </button>
        <div className="home-camera-hint">Tap to snap a document</div>
      </div>

      {/* Latest document card */}
      {latestDoc && (
        <div className="home-latest-card" onClick={() => navigate('/ledger')}>
          <div className="home-latest-label">LATEST DOCUMENT</div>
          <div className="home-latest-row">
            <div>
              <div className="home-latest-vendor">
                {latestDoc.entity ?? 'Unknown'}
              </div>
              <div className="home-latest-meta">
                {docTypeLabel(latestDoc.entry_type)}
                {latestDoc.date ? ` · ${latestDoc.date}` : ''}
              </div>
            </div>
            <div className="home-latest-amount">
              {fmt(latestDoc.amount ?? 0)}
            </div>
          </div>
          <div className="home-latest-status" data-status={latestDoc.status}>
            {latestDoc.status === 'APPROVED' ? '✓ Approved' :
             latestDoc.status === 'NEEDS_REVIEW' ? 'Needs Review' : latestDoc.status}
          </div>
        </div>
      )}

      {/* Bottom actions */}
      <div className="home-actions">
        <button
          className="home-dashboard-btn"
          onClick={() => navigate('/accountant')}
        >
          View Bookkeeper Dashboard
        </button>
      </div>
    </div>
  );
}
