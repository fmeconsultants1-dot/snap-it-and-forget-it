/**
 * ProcessingPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * Processing queue. Sequential Gemini processing for 1-N captured images.
 * Each image may contain multiple detected documents.
 * ALL detected documents from ALL images are collected and passed to ReviewPage.
 *
 * MULTI-DOCUMENT REQUIREMENT:
 * - 1 image with 1 doc  -> 1 ScanResult
 * - 1 image with 3 docs -> 3 ScanResults (all collected, all reviewed independently)
 * - 3 images each with 1 doc -> 3 ScanResults
 * results[0]-only is NOT used here. processDocumentRaw returns the full envelope.
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

type DocStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

interface ProcessedDoc {
  doc: Doc;
  status: DocStatus;
  detectedCount: number;
  results: ScanResult[];
  error?: string;
}

export default function ProcessingPage() {
  const navigate   = useNavigate();
  const documents: Doc[] = docStore.get() ?? [];
  const runIdRef   = useRef<string | null>(null);
  const startedRef = useRef(false);

  const [items, setItems] = useState<ProcessedDoc[]>(
    documents.map(doc => ({ doc, status: 'PENDING' as DocStatus, detectedCount: 0, results: [] }))
  );
  const [allDone,        setAllDone]        = useState(false);
  const [allResults,     setAllResults]     = useState<ScanResult[]>([]);

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

    // All ScanResults across all images — one entry per DETECTED DOCUMENT
    const collected: ScanResult[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;

      setItems(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: 'PROCESSING' } : item
      ));

      try {
        // Use processDocumentRaw to get the full envelope with all detected docs
        const raw = await scanApi.processDocumentRaw({
          runId:       rId,
          sequence:    i + 1,
          imageBase64: doc.base64,
          mimeType:    doc.mimeType,
          fileName:    doc.fileName,
        });

        // Collect ALL results from this image (may be 1, 2, 3+ documents)
        const imageResults = raw.results ?? [];
        collected.push(...imageResults);

        const anyFailed = imageResults.every(r => r.status === 'FAILED');

        setItems(prev => prev.map((item, idx) =>
          idx === i ? {
            ...item,
            status: anyFailed ? 'FAILED' : 'DONE',
            detectedCount: raw.detectedCount,
            results: imageResults,
          } : item
        ));

      } catch (err: any) {
        const failResult: ScanResult = {
          documentId: '', extractionId: '', ledgerEntryId: '',
          journalEntryId: '', refNumber: '', lineCount: 0,
          itcFlags: [], status: 'FAILED',
          error: err.message ?? 'Processing failed',
          extraction: {} as any,
        };
        collected.push(failResult);
        setItems(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'FAILED', results: [failResult], error: err.message } : item
        ));
      }
    }

    try { await scanApi.finalizeRun(rId); } catch { /* non-fatal */ }
    docStore.clear();
    setAllResults(collected);
    setAllDone(true);
  }

  const totalDocs    = allResults.length;
  const successDocs  = allResults.filter(r => r.status === 'DONE').length;
  const failedImages = items.filter(i => i.status === 'FAILED').length;

  return (
    <div className="screen">
      <div className="fme-mark">FME</div>

      <h1 style={{ marginTop: 32, marginBottom: 8 }}>
        {allDone
          ? 'Done!'
          : documents.length === 1
            ? 'Reading document…'
            : `Reading ${documents.length} images…`}
      </h1>

      {allDone && (
        <p className="subtext">
          {successDocs} document{successDocs !== 1 ? 's' : ''} extracted
          {failedImages > 0 ? ` · ${failedImages} image${failedImages !== 1 ? 's' : ''} failed` : ''}
        </p>
      )}

      {items.map((item, idx) => {
        // Show first successful result label for this image
        const firstDone = item.results.find(r => r.status === 'DONE');
        const ex        = firstDone?.extraction;
        const label     = ex?.vendor ?? ex?.issuer ?? null;
        const docType   = ex?.doc_type ?? null;
        const extra     = item.detectedCount > 1
          ? ` · ${item.detectedCount} documents detected`
          : '';

        return (
          <div key={idx} className="scan-doc-row">
            <img
              src={item.doc.dataUrl}
              alt={`Image ${idx + 1}`}
              className="scan-thumb"
            />
            <div style={{ flex: 1 }}>
              <div className="scan-doc-name">
                {label ? `${label}${extra}` : `Image ${idx + 1}${extra}`}
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

            {item.status === 'PENDING'    && <span style={{ color: 'var(--gray)',   fontSize: 13 }}>Waiting</span>}
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
            state: { results: allResults, runId: runIdRef.current },
          })}
        >
          Review {successDocs} document{successDocs !== 1 ? 's' : ''} →
        </button>
      )}
    </div>
  );
}
