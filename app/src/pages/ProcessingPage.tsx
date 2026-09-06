/**
 * ProcessingPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * BUG E PHASE 2A FIX:
 * Previously, when processDocumentRaw() threw on HTTP 422, ProcessingPage
 * caught the error and fabricated a FAILED ScanResult with documentId=''.
 * This destroyed the server-assigned documentId needed for every later
 * recovery action (Skip persistence, Enter Manually, Retake).
 *
 * Fix: processDocumentRaw() now returns the full server envelope on 422
 * (see api.ts scanRequestRaw). The results[] array contains the real
 * documentId from the server. ProcessingPage preserves it exactly.
 *
 * A fabricated blank-ID result is still created ONLY for genuine
 * transport/client failures where no server envelope exists (network down,
 * JSON parse error, etc.).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { scanApi, ScanResult } from '../lib/api';
import { docStore } from '../lib/docStore';

interface Doc {
  dataUrl: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

type RowStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

interface ImageRow {
  doc: Doc;
  status: RowStatus;
  results: ScanResult[];
  detectedCount: number;
  error?: string;
}

export default function ProcessingPage() {
  const navigate   = useNavigate();
  const documents: Doc[] = docStore.get() ?? [];
  const runIdRef   = useRef<string | null>(null);
  const startedRef = useRef(false);

  const [rows,       setRows]       = useState<ImageRow[]>(
    documents.map(doc => ({ doc, status: 'PENDING', results: [], detectedCount: 0 }))
  );
  const [allDone,    setAllDone]    = useState(false);
  const [allResults, setAllResults] = useState<ScanResult[]>([]);

  useEffect(() => {
    if (documents.length === 0) { navigate('/'); return; }
    if (startedRef.current) return;
    startedRef.current = true;
    processAll();
  }, []);

  async function processAll() {
    let rId: string;
    try {
      const { runId } = await scanApi.createRun(documents.length);
      rId = runId;
    } catch {
      rId = crypto.randomUUID();
    }
    runIdRef.current = rId;

    const collected: ScanResult[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;

      setRows(prev => prev.map((r, idx) =>
        idx === i ? { ...r, status: 'PROCESSING' } : r
      ));

      try {
        // processDocumentRaw now returns the server envelope on both
        // HTTP 200 (success) and HTTP 422 (extraction failed).
        // results[] contains real server-assigned documentIds in both cases.
        const raw = await scanApi.processDocumentRaw({
          runId:       rId,
          sequence:    i + 1,
          imageBase64: doc.base64,
          mimeType:    doc.mimeType,
          fileName:    doc.fileName,
        });

        const imageResults  = raw.results ?? [];
        const detected      = raw.detectedCount ?? imageResults.length;
        const allFailed     = imageResults.length > 0 &&
                              imageResults.every(r => r.status === 'FAILED');

        // Preserve server results exactly — documentIds intact
        collected.push(...imageResults);

        setRows(prev => prev.map((r, idx) =>
          idx === i ? {
            ...r,
            status:        allFailed ? 'FAILED' : 'DONE',
            results:       imageResults,
            detectedCount: detected,
          } : r
        ));

      } catch (err: any) {
        // Genuine transport failure — no server envelope available.
        // Only here do we fabricate a blank-ID FAILED result.
        const failResult: ScanResult = {
          documentId: '', extractionId: '', ledgerEntryId: '',
          journalEntryId: '', refNumber: '', lineCount: 0,
          itcFlags: [], status: 'FAILED',
          error: err.message ?? 'Network or processing error',
          extraction: {} as any,
        };
        collected.push(failResult);
        setRows(prev => prev.map((r, idx) =>
          idx === i ? {
            ...r,
            status: 'FAILED',
            results: [failResult],
            error: err.message,
          } : r
        ));
      }
    }

    try { await scanApi.finalizeRun(rId); } catch { /* non-fatal */ }
    docStore.clear();
    setAllResults(collected);
    setAllDone(true);
  }

  const totalExtracted = allResults.length;
  const successCount   = allResults.filter(r => r.status === 'DONE').length;
  const failedCount    = allResults.filter(r => r.status === 'FAILED').length;

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <h1 style={{ marginTop: 32, marginBottom: 8, color: 'var(--cream)', fontSize: 26 }}>
        {allDone
          ? 'Done!'
          : documents.length === 1
            ? 'Reading document…'
            : `Reading ${documents.length} documents…`}
      </h1>

      {allDone && totalExtracted > 0 && (
        <p style={{ color: 'var(--cream-dim)', fontSize: 14, marginBottom: 16 }}>
          {successCount} of {totalExtracted} document{totalExtracted !== 1 ? 's' : ''} extracted successfully
          {failedCount > 0 ? ` · ${failedCount} failed` : ''}
        </p>
      )}

      {rows.map((row, idx) => {
        const firstDone = row.results.find(r => r.status === 'DONE');
        const ex        = firstDone?.extraction;
        const label     = ex?.vendor ?? ex?.issuer ?? null;
        const docType   = ex?.doc_type ?? null;
        const multiNote = row.detectedCount > 1 ? ` · ${row.detectedCount} documents` : '';

        return (
          <div key={idx} className="scan-doc-row">
            <img src={row.doc.dataUrl} alt={`Document ${idx + 1}`} className="scan-thumb" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="scan-doc-name" style={{ color: 'var(--cream)' }}>
                {label ? `${label}${multiNote}` : `Document ${idx + 1}${multiNote}`}
              </div>
              {docType && (
                <div style={{ fontSize: 11, color: 'var(--cream-dim)', marginTop: 2 }}>{docType}</div>
              )}
              {row.status === 'FAILED' && row.error && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{row.error}</div>
              )}
            </div>
            {row.status === 'PENDING'    && <span style={{ color: 'var(--cream-dim)', fontSize: 13 }}>Waiting</span>}
            {row.status === 'PROCESSING' && <span style={{ color: 'var(--gold)', fontSize: 18 }}>⏳</span>}
            {row.status === 'DONE'       && <span style={{ color: 'var(--gold)', fontWeight: 700 }}>✓</span>}
            {row.status === 'FAILED'     && <span style={{ color: 'var(--red)', fontWeight: 700 }}>✗</span>}
          </div>
        );
      })}

      {allDone && (
        <button
          className="btn-primary"
          style={{ marginTop: 24, width: '100%' }}
          onClick={() => navigate('/results', {
            state: { results: allResults, runId: runIdRef.current },
          })}
        >
          Review {successCount} document{successCount !== 1 ? 's' : ''} →
        </button>
      )}
    </div>
  );
}
