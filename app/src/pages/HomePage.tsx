/**
 * HomePage.tsx
 * FME Mission 001 — Snap It & Forget It
 * Entry point screen. Launches camera, ledger, or accountant portal.
 */
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="screen" style={{ justifyContent: 'center', gap: 0 }}>
      <div className="fme-mark">FME</div>

      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 72, marginBottom: 16 }}>📷</div>
        <h1 style={{ fontSize: 36, marginBottom: 8 }}>Snap It</h1>
        <p style={{ color: 'var(--gray-light)', fontSize: 15, maxWidth: 280, margin: '0 auto' }}>
          Photograph your receipts and documents. AI extracts everything. Ledger updates automatically.
        </p>
      </div>

      <button
        className="btn-primary"
        onClick={() => navigate('/camera')}
        style={{ fontSize: 18 }}
      >
        📷 Snap Documents
      </button>

      <button
        className="btn-secondary"
        onClick={() => navigate('/ledger')}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          marginTop: 16,
          padding: '14px',
          justifyContent: 'center',
        }}
      >
        View Ledger
      </button>

      <button
        className="btn-secondary"
        onClick={() => navigate('/accountant')}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          marginTop: 10,
          padding: '14px',
          justifyContent: 'center',
          color: 'var(--gray-light)',
        }}
      >
        Accountant Portal
      </button>
    </div>
  );
}
