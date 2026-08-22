/**
 * ProcessingPage.tsx - FME Mission 001 - Snap It & Forget It
 * Processing queue screen. Sequential Gemini processing, Document 1-N with thumbs.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { scanApi, ScanResult } from '../lib/api';
import { docStore } from '../lib/docStore';

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
  const documents: Doc[] = docStore.get() ?? location.state?.documents ?? [];
  const runIdRef = useRef<string | null>(null);
  const [items, setItems] = useState<ProcessedDoc[]>(
    documents.map(doc => ({ doc, status: 'PENDING' as DocStatus }))
  );
  const [allDone, setAllDone] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const startedRef = useRef(false);

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
      setItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'PROCESSING' } : item));
      try {
        const result = await scanApi.processDocument({
          runId: rId, sequence: i + 1,
          imageBase64: doc.base64, mimeType: doc.mimeType, fileName: doc.fileName,
        });
        collected.push(result);
        setItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'DONE', result } : item));
      } catch (err: any) {
        const failResult: ScanResult = {
          documentId: '', extractionId: '', ledgerEntryId: '',
          journalEntryId: '', refNumber: '', status: 'FAILED',
          lineCount: 0, itcFlags: [],
          error: err.message, extraction: {} as any,
        };
        collected.push(failResult);
        setItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'FAILED', error: err.message } : item));
      }
    }

    try { await scanApi.finalizeRun(rId); } catch { /* non-fatal */ }
    setResults(collected);
    setAllDone(true);
  }

  const docCount = documents.length;
  const doneCount = items.filter(i => i.status === 'DONE').length;

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <h1 style={{ marginTop: 32, marginBottom: 16 }}>
        {allDone
          ? `Done!`
          : docCount === 1
          ? 'Scanning 1 document…'
          : `Scanning ${docCount} documents…`}
      </h1>

      {allDone && (
        <p className="subtext">{doneCount} of {docCount} processed successfully</p>
      )}

      {items.map((item, idx) => (
        <div key={idx} className="scan-doc-row">
          <img src={item.doc.dataUrl} alt={`Document ${idx + 1}`} className="scan-thumb" />
          <div style={{ flex: 1 }}>
            <div className="scan-doc-name">Document {idx + 1}</div>
            {item.result?.extraction?.vendor && (
              <div style={{ fontSize: 11, color: 'var(--gray-light)' }}>{item.result.extraction.vendor}</div>
            )}
          </div>
          {item.status === 'PENDING'    && <span style={{ color: 'var(--gray)', fontSize: 13 }}>Waiting</span>}
          {item.status === 'PROCESSING' && <span className="scan-status-processing">⏳</span>}
          {item.status === 'DONE'       && <span className="scan-status-done">✓ Done</span>}
          {item.status === 'FAILED'     && <span className="scan-status-failed">✗ Failed</span>}
        </div>
      ))}

      {allDone && (
        <button className="btn-primary" onClick={() => navigate('/results', { state: { results, runId: runIdRef.current } })}>
          View Results →
        </button>
      )}
    </div>
  );
}
