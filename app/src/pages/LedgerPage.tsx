/**
 * LedgerPage.tsx
 * FME Mission 001 — Snap It & Forget It
 *
 * Evidence from screenshots 3-5, 7-11:
 *   VIEW TOGGLE: Register | Accounting Journal
 *   TABS: This Run | Today | All | Receipts | Statements | Review
 *
 *   REGISTER view:
 *     - DATE/TYPE | ENTITY/ACCOUNT | AMOUNT columns
 *     - Amount: "DR $X.XX" in orange (Debit), "$X.XX" in white (Balance)
 *     - Amount sublabel: "Debit" or "Balance"
 *     - NEEDS REVIEW badge on entity
 *     - "Scan More Documents" gold button
 *
 *   ACCOUNTING JOURNAL view:
 *     - Card per entry: RECEIPT/INVOICE badge + date + ref + vendor
 *     - NEEDS REVIEW / DRAFT badge
 *     - ACCOUNT | DEBIT | CREDIT table
 *     - 5010-Operating Expenses | $XX.XX | —
 *     - 1010-Cash | — | $XX.XX
 *     - ✓ Balanced + Expenses running total
 *     - Approve button
 *     - ○ Source button
 *
 *   BUG FIX: "All" tab was showing duplicates — fixed with entry ID deduplication.
 */

import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ledgerApi, LedgerEntry, JournalEntry } from '../lib/api';

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams(tab, runId);

      if (view === 'register') {
        const res = await ledgerApi.getEntries(params);
        // Deduplicate by id (fixes "All" tab duplicate bug seen in evidence)
        const seen = new Set<string>();
        const deduped = res.entries.filter(e => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });
        setLedgerEntries(deduped);
        setRunningTotal(res.runningTotal);
      } else {
        const res = await ledgerApi.getJournalEntries(params);
        // Deduplicate
        const seen = new Set<string>();
        const deduped = res.entries.filter(e => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });
        setJournalEntries(deduped);
      }
    } finally {
      setLoading(false);
    }
  }, [view, tab, runId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleApprove = async (ledgerEntryId: string) => {
    setApprovingId(ledgerEntryId);
    try {
      await ledgerApi.approve(ledgerEntryId);
      await fetchData();
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <h1 style={{ marginTop: 32, marginBottom: 16 }}>Ledger</h1>

      {/* View toggle */}
      <div className="view-toggle">
        <button
          className={view === 'register' ? 'active' : ''}
          onClick={() => setView('register')}
        >
          Register
        </button>
        <button
          className={view === 'journal' ? 'active' : ''}
          onClick={() => setView('journal')}
        >
          Accounting Journal
        </button>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="spinner" />}

      {/* REGISTER VIEW */}
      {!loading && view === 'register' && (
        <>
          {ledgerEntries.length === 0 && (
            <div className="empty-state">No matching records.</div>
          )}

          {ledgerEntries.length > 0 && (
            <>
              <div className="ledger-header">
                <span>DATE / TYPE</span>
                <span>ENTITY / ACCOUNT</span>
                <span style={{ textAlign: 'right' }}>AMOUNT</span>
              </div>

              {ledgerEntries.map(entry => (
                <div key={entry.id} className="ledger-row">
                  {/* Date + type */}
                  <div>
                    <div className="ledger-date">{entry.date ?? '—'}</div>
                    <div className="ledger-type">{entry.entry_type}</div>
                  </div>

                  {/* Entity + badge */}
                  <div>
                    <div className="ledger-entity">{entry.entity ?? 'Unknown'}</div>
                    <span className={`badge ${entry.status.replace('_', '-')}`}>
                      {entry.status.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Amount */}
                  <div>
                    <div className={`ledger-amount ${entry.balance_type}`}>
                      {entry.balance_type === 'DEBIT' ? `DR $${entry.amount.toFixed(2)}` : `$${entry.amount.toFixed(2)}`}
                    </div>
                    <div className="ledger-amount-label">
                      {entry.balance_type === 'DEBIT' ? 'Debit' : 'Balance'}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          <button className="btn-primary" onClick={() => navigate('/camera')}>
            Scan More Documents
          </button>
        </>
      )}

      {/* ACCOUNTING JOURNAL VIEW */}
      {!loading && view === 'journal' && (
        <>
          {journalEntries.length === 0 && (
            <div className="empty-state">No matching records.</div>
          )}

          {journalEntries.map(entry => (
            <div key={entry.id} className="journal-card">
              {/* Header */}
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
                  <span className={`badge ${entry.status}`}>
                    {entry.status === 'DRAFT' ? 'NEEDS REVIEW / DRAFT' : entry.status}
                  </span>
                  <button
                    className="btn-secondary"
                    onClick={() => { /* Source image view — navigate to source */ }}
                    style={{ fontSize: 11 }}
                  >
                    ○ Source
                  </button>
                </div>
              </div>

              {/* Journal lines table */}
              <table className="journal-table">
                <thead>
                  <tr>
                    <th>ACCOUNT</th>
                    <th>DEBIT</th>
                    <th>CREDIT</th>
                  </tr>
                </thead>
                <tbody>
                  {(entry.lines ?? []).map((line, li) => (
                    <tr key={li}>
                      <td style={{ color: 'var(--white-dim)' }}>
                        {line.account_code}-{line.account_name}
                      </td>
                      <td>{line.debit > 0 ? `$${line.debit.toFixed(2)}` : '—'}</td>
                      <td>{line.credit > 0 ? `$${line.credit.toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Footer: Balanced + running total */}
              <div className="journal-footer">
                <span className="balanced-badge">
                  {entry.is_balanced ? '✓ Balanced' : '⚠ Unbalanced'}
                </span>
                {entry.running_total > 0 && (
                  <span style={{ color: 'var(--gray-light)', fontSize: 12 }}>
                    Expenses: ${entry.running_total.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Approve button */}
              {entry.status === 'DRAFT' && (
                <button
                  className="btn-approve"
                  onClick={() => handleApprove(entry.ledger_entry_id)}
                  disabled={approvingId === entry.ledger_entry_id}
                >
                  {approvingId === entry.ledger_entry_id ? 'Approving...' : 'Approve'}
                </button>
              )}
            </div>
          ))}

          {journalEntries.length > 0 && (
            <>
              <button
                className="btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => { window.location.href = ledgerApi.exportCsv(); }}
              >
                Export for Accountant
              </button>
              <button className="btn-primary" style={{ marginTop: 12, background: 'var(--bg-card)', color: 'var(--white)' }}
                onClick={() => navigate('/camera')}
              >
                Scan More Documents
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function buildParams(tab: TabId, runId: string | null) {
  switch (tab) {
    case 'this_run': return { runId: runId ?? undefined };
    case 'today': return { dateFilter: 'today' };
    case 'all': return {};
    case 'receipts': return { entryType: 'RECEIPT' };
    case 'statements': return { entryType: 'STATEMENT' };
    case 'review': return { status: 'NEEDS_REVIEW' };
    default: return {};
  }
}
