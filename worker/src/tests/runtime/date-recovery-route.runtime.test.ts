import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../index';
import { GeminiAdapter } from '../../adapters/GeminiAdapter';
import type { Env } from '../../services/ScanService';
import { createTestDb } from './db-harness';

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const db = createTestDb();
  await db.prepare("INSERT INTO scan_runs(id) VALUES('run')").run();
  await db.prepare("INSERT INTO documents(id,run_id,r2_key) VALUES('shared','run','original.jpg')").run();
  for (const [id, vendor, total] of [['first','Other vendor',12], ['target','BC Hydro',80]]) {
    await db.prepare('INSERT INTO extractions(id,document_id,vendor,total) VALUES(?,?,?,?)').bind(id,'shared',vendor,total).run();
    await db.prepare('INSERT INTO ledger_entries(id,document_id,extraction_id) VALUES(?,?,?)').bind(`ledger-${id}`,'shared',id).run();
  }
  const get = vi.fn().mockResolvedValue({arrayBuffer: async () => new Uint8Array([1,2]).buffer});
  const recover = vi.spyOn(GeminiAdapter.prototype,'recoverDate').mockResolvedValue({date:'2026-06-15',confidence_date:0.8,printed_date:'2026-06-15',verify_date:true});
  const env = {DB:db,DOCUMENTS:{get},GEMINI_API_KEY:'test'} as unknown as Env;
  return {db,get,recover,env};
}

it.each(['/api/extractions/target/recover-date','/api/ledger/ledger-target/recover-date'])('recovers the selected extraction without writes: %s', async path => {
  const {db,get,recover,env} = await setup();
  const before = await db.prepare('SELECT * FROM extractions ORDER BY id').all();
  const response = await worker.fetch(new Request(`https://example.test${path}`,{method:'POST'}),env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({date:'2026-06-15'});
  expect(get).toHaveBeenCalledWith('original.jpg');
  expect(recover).toHaveBeenCalledWith(expect.any(String),'image/jpeg',{vendor:'BC Hydro',doc_type:'RECEIPT',total:80});
  expect(await db.prepare('SELECT * FROM extractions ORDER BY id').all()).toEqual(before);
});

it('does not guess another extraction when the ledger link is missing', async () => {
  const {db,get,recover,env} = await setup();
  await db.prepare("UPDATE ledger_entries SET extraction_id=NULL WHERE id='ledger-target'").run();
  const response = await worker.fetch(new Request('https://example.test/api/ledger/ledger-target/recover-date',{method:'POST'}),env);
  expect(response.status).toBe(404);
  expect(get).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
});
