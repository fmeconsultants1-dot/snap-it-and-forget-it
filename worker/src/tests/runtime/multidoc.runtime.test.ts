import { afterEach, expect, it, vi } from 'vitest';
import { ScanService, type Env } from '../../services/ScanService';
import { createTestDb } from './db-harness';
afterEach(() => vi.unstubAllGlobals());
it('one image -> Gemini array of five -> five persisted results and detectedCount five', async () => {
  const db = createTestDb();
  const put = vi.fn().mockResolvedValue({});
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(Array.from({length:5}, (_,i) => ({doc_type:'RECEIPT',vendor:`Vendor ${i}`,date:'2026-09-08',total:10,confidence_date:0.95}))) }] } }] }) });
  vi.stubGlobal('fetch', fetchMock);
  const scan = new ScanService({ DB: db, DOCUMENTS:{put}, GEMINI_API_KEY:'test' } as unknown as Env);
  const runId = await scan.createRun(1);
  const response = await scan.processDocument({runId,sequence:1,imageBase64:'aGVsbG8=',mimeType:'image/jpeg'});
  expect(response.detectedCount).toBe(5); expect(response.results).toHaveLength(5);
  expect(response.results.every(r => r.status === 'DONE')).toBe(true);
  expect(new Set(response.results.map(r => r.ledgerEntryId)).size).toBe(5);
  expect(put).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('multi-document failure does not silently fall back to one document', async () => {
  const db = createTestDb(); const fetchMock = vi.fn().mockResolvedValue({ok:false,status:503,text:async()=> 'Unavailable'});
  vi.stubGlobal('fetch',fetchMock);
  const scan = new ScanService({DB:db,DOCUMENTS:{put:vi.fn()},GEMINI_API_KEY:'test'} as unknown as Env);
  const runId = await scan.createRun(1);
  const response = await scan.processDocument({runId,sequence:1,imageBase64:'aA==',mimeType:'image/jpeg'});
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(response.results[0]?.status).toBe('FAILED'); expect(response.detectedCount).toBe(0);
});
