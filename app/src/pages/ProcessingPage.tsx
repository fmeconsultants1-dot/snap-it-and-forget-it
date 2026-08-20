/**
 * ProcessingPage.tsx
 * FME Mission 001 — Snap It & Forget It
 *
 * Processing queue screen. Evidence from Screenshot 1:
 *   - "Document 1" ... "Document N" rows with thumbnail
 *   - ✓ Done status per row in green
 *   - "View Results →" gold button at bottom
 *   - Heading shows dynamic count
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { scanApi, ScanResult } from '../lib/api';

interface Doc {
  dataUrl: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

type DocStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

interface ProcessedDoc {
  doc: Doc;
  status: DocStatus;
  result?: ScanResult;
  error?: string;
}

export default function ProcessingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const documents: Doc[] = location.state?.documents ?? [];
  const runIdRef = useRef<string | null>(null);
  const [items, setItems] = useState<ProcessedDoc[]>(
    documents.map(doc => ({ doc, status: 'PENDING' as DocStatus }))
  );
  const [allDone, setAllDone] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (documents.length === 0) {
      navigate('/');
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    processAll();
  }, []);

  async function processAll() {
    // 1. Create run
    let rId: string;
    try {
      const { runId } = await scanApi.createRun(documents.length);
      rId = runId;
      runIdRef.current = runId;
      setRunId(runId);
    } catch {
      // Offline fallback — process without run ID recorded
      rId = crypto.randomUUID();
      runIdRef.current = rId;
    }

    // 2. Process each document sequentially
    const collected: ScanResult[] = [];
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;
      // Mark as processing
      setItems(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: 'PROCESSING' } : item
      ));

      try {
        const result = await scanApi.processDocument({
          runId: rId,
          sequence: i + 1,
          imageBase64: doc.base64,
          mimeType: doc.mimeType,
          fileName: doc.fileName,
        });
        collected.push(result);
        setItems(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'DONE', result } : item
        ));
      } catch (err: any) {
        const failResult: ScanResult = {
          documentId: '',
          extractionId: '',
          ledgerEntryId: '',
          journalEntryId: '',
          refNumber: '',
          status: 'FAILED',
          error: err.message,
          extraction: {} as any,
        };
        collected.push(failResult);
        setItems(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'FAILED', error: err.message } : item
        ));
      }
    }

    // 3. Finalize run
    try {
      await scanApi.finalizeRun(rId);
    } catch { /* non-fatal */ }

    setResults(collected);
    setAllDone(true);
  }

  const docCount = documents.length;
  const doneCount = items.filter(i => i.status === 'DONE').length;

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <h1 style={{ marginTop: 32, marginBottom: 24 }}>
        {allDone
          ? `Done!`
          : `Scanning ${docCount} ${docCount === 1 ? 'document' : 'documents'}...`
        }
      </h1>

      {allDone && (
        <p className="subtext">{doneCount} of {docCount} processed successfully</p>
      )}

      {/* Document queue rows */}
      {items.map((item, idx) => (
        <div key={idx} className="scan-doc-row">
          {/* Thumbnail */}
          <img
            src={item.doc.dataUrl}
            alt={`Document ${idx + 1}`}
            className="scan-thumb"
          />

          {/* Name */}
          <span className="scan-doc-name">Document {idx + 1}</span>

          {/* Status */}
          {item.status === 'PENDING' && (
            <span style={{ color: 'var(--gray)', fontSize: 13 }}>Waiting</span>
          )}
          {item.status === 'PROCESSING' && (
            <span className="scan-status-processing">⏳</span>
          )}
          {item.status === 'DONE' && (
            <span className="scan-status-done">✓ Done</span>
          )}
          {item.status === 'FAILED' && (
            <span className="scan-status-failed">✗ Failed</span>
          )}
        </div>
      ))}

      {/* View Results button */}
      {allDone && (
        <button
          className="btn-primary"
          onClick={() => navigate('/results', {
            state: { results, runId: runIdRef.current }
          })}
        >
          View Results →
        </button>
      )}
    </div>
  );
}
