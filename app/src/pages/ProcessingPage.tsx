/**
 * ProcessingPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * Processing queue screen. Sequential Gemini processing, Document 1-N with thumbs.
 *
 * ROOT CAUSE FIX (2026-09-03):
 * scanApi.processDocument now returns ScanResult directly (unwrapped from results[]).
 * This page collects each ScanResult and passes them to ResultsPage via navigation state.
 * The extraction object on each ScanResult now contains real Gemini values.
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
  const navigate  = useNavigate();
  const documents: Doc[] = docStore.get() ?? [];
  const runIdRef  = useRef<string | null>(null);
  const [items, setItems] = useState<ProcessedDoc[]>(
    documents.map(doc => ({ doc, status: 'PENDING' as DocStatus }))
  );
  const [allDone,  setAllDone]  = useState(false);
  const [results,  setResults]  = useState<ScanResult[]>([]);
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

      setItems(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: 'PROCESSING' } : item
      ));

      try {
        // scanApi.processDocument now returns ScanResult directly (unwrapped)
        const result = await scanApi.processDocument({
          runId: rId,
          sequence: i + 1,
          imageBase64: doc.base64,
          mimeType: doc.mimeType,
          fileName: doc.fileName,
        });

        collected.push(result);
        setItems(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: result.status === 'FAILED' ? 'FAILED' : 'DONE', result } : item
        ));

      } catch (err: any) {
        const failResult: ScanResult = {
          documentId: '',
          extractionId: '',
          ledgerEntryId: '',
          journalEntryId: '',
          refNumber: '',
          status: 'FAILED',
          lineCount: 0,
          itcFlags: [],
          error: err.message ?? 'Processing failed',
          extraction: {} as any,
        };
        collected.push(failResult);
        setItems(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'FAILED', error: err.message } : item
        ));
      }
    }

    try { await scanApi.finalizeRun(rId); } catch { /* non-fatal */ }
    docStore.clear();
    setResults(collected);
    setAllDone(true);
  }

  const docCount  = documents.length;
  const doneCount = items.filter(i => i.status === 'DONE').length;
  const failCount = items.filter(i => i.status === 'FAILED').length;

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <h1 style={{ marginTop: 32, marginBottom: 8 }}>
        {allDone
          ? 'Done!'
          : docCount === 1
            ? 'Reading document…'
            : `Reading ${docCount} documents…`}
      </h1>

      {allDone && (
        <p className="subtext">
          {doneCount} of {docCount} read successfully
          {failCount > 0 ? ` · ${failCount} failed` : ''}
        </p>
      )}

      {items.map((item, idx) => {
        const ex = item.result?.extraction;
        // Show best available label from extraction
        const label = ex?.vendor ?? ex?.issuer ?? null;
        const docType = ex?.doc_type ?? null;

        return (
          <div key={idx} className="scan-doc-row">
            <img
              src={item.doc.dataUrl}
              alt={`Document ${idx + 1}`}
              className="scan-thumb"
            />
            <div style={{ flex: 1 }}>
              <div className="scan-doc-name">
                {label ?? `Document ${idx + 1}`}
              </div>
              {docType && (
                <div style={{ fontSize: 11, color: 'var(--gray-light)', marginTop: 2 }}>
                  {docType}
                </div>
              )}
              {item.status === 'FAILED' && item.error && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>
                  {item.error}
                </div>
              )}
            </div>

            {item.status === 'PENDING'    && <span style={{ color: 'var(--gray)', fontSize: 13 }}>Waiting</span>}
            {item.status === 'PROCESSING' && <span className="scan-status-processing">⏳</span>}
            {item.status === 'DONE'       && <span className="scan-status-done">✓ Done</span>}
            {item.status === 'FAILED'     && <span className="scan-status-failed">✗ Failed</span>}
          </div>
        );
      })}

      {allDone && (
        <button
          className="btn-primary"
          style={{ marginTop: 24 }}
          onClick={() => navigate('/results', {
            state: { results, runId: runIdRef.current },
          })}
        >
          Review {doneCount} document{doneCount !== 1 ? 's' : ''} →
        </button>
      )}
    </div>
  );
}
