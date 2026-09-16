import {afterEach, expect, it, vi} from 'vitest';
import {ScanService, type Env} from '../../services/ScanService';
import {GeminiAdapter, type ExtractionResult} from '../../adapters/GeminiAdapter';
import {createTestDb} from './db-harness';
afterEach(()=>vi.restoreAllMocks());
const extraction=(doc_type='RECEIPT', date:string|null=null):ExtractionResult=>({doc_type,vendor:'Exact vendor',date,total:10,subtotal:10,tax:0,tax_gst:0,tax_hst:0,tax_pst:0,payment_method:'Cash',category:'Office',description:'Keep this',issuer:null,line_items:[],raw_fields:{date:'2020-07-13',keep:'original'},confidence_vendor:1,confidence_date:date?0.9:0,confidence_total:1,confidence_category:1,gemini_model:'test'});
async function scan(docs:ExtractionResult[]){
 const db=createTestDb();vi.spyOn(GeminiAdapter.prototype,'extractDocuments').mockResolvedValue(docs);
 const put=vi.fn().mockResolvedValue({});
 const service=new ScanService({DB:db,DOCUMENTS:{put},GEMINI_API_KEY:'test'} as unknown as Env);
 const runId=await service.createRun(1);
 const response=await service.processDocument({runId,sequence:1,imageBase64:'aA==',mimeType:'image/jpeg'});
 expect(put).toHaveBeenCalledTimes(1);
 return {db,response};
}
it('preserves an accepted extraction date without recovery',async()=>{
 const recovery=vi.spyOn(GeminiAdapter.prototype,'recoverDate');const original=extraction('RECEIPT','2025-07-13');
 const {response}=await scan([original]);expect(recovery).not.toHaveBeenCalled();expect(response.results[0]!.extraction).toEqual(original);
});
it.each(['RECEIPT','INVOICE','STATEMENT'])('persists one low-confidence %s candidate before ledger creation',async type=>{
 const recovery=vi.spyOn(GeminiAdapter.prototype,'recoverDate').mockResolvedValue({date:'2026-07-13',confidence_date:0.9,printed_date:'26/07/13',verify_date:true,recovery_diagnostics:[],verification_diagnostics:[]});
 const {db,response}=await scan([extraction(type)]);const result=response.results[0]!;
 expect(recovery).toHaveBeenCalledTimes(1);expect(recovery).toHaveBeenCalledWith('aA==','image/jpeg',{vendor:'Exact vendor',doc_type:type,total:10},{singlePass:true});
 expect(result.extraction).toMatchObject({date:'2026-07-13',confidence_date:0.4,description:'Keep this',total:10,raw_fields:{date:'2020-07-13',keep:'original',date_review_candidate:{source:'DATE_RECOVERY',date:'2026-07-13',confidence:0.4,printed_date:'26/07/13',verify_required:true}}});
 const stored=await db.prepare('SELECT date,confidence_date,raw_fields FROM extractions WHERE id=?').bind(result.extractionId).first();
 expect(stored).toMatchObject({date:'2026-07-13',confidence_date:0.4});expect(JSON.parse(String(stored!.raw_fields))).toEqual(result.extraction.raw_fields);
 expect(await db.prepare('SELECT date,status,amount FROM ledger_entries WHERE id=?').bind(result.ledgerEntryId).first()).toMatchObject({date:'2026-07-13',status:'NEEDS_REVIEW',amount:10});
});
it('leaves optional DOCUMENT dates alone',async()=>{
 const recovery=vi.spyOn(GeminiAdapter.prototype,'recoverDate');const {response}=await scan([extraction('DOCUMENT')]);
 expect(recovery).not.toHaveBeenCalled();expect(response.results[0]!.extraction.date).toBeNull();
});
it.each(['null','throws'])('retains every extracted field and pending ledger when recovery %s',async mode=>{
 const recovery=vi.spyOn(GeminiAdapter.prototype,'recoverDate');
 if(mode==='throws')recovery.mockRejectedValue(new Error('Date unavailable'));
 else recovery.mockResolvedValue({date:null,confidence_date:0,printed_date:null,verify_date:true,recovery_diagnostics:[],verification_diagnostics:[]});
 const original=extraction();const {db,response}=await scan([original]);const result=response.results[0]!;
 expect(recovery).toHaveBeenCalledTimes(1);expect(result.status).toBe('DONE');expect(result.extraction).toEqual(original);expect(result.extraction.date).toBeNull();
 expect(await db.prepare('SELECT date,status FROM ledger_entries WHERE id=?').bind(result.ledgerEntryId).first()).toMatchObject({date:null,status:'NEEDS_REVIEW'});
});
it('keeps independent per-document targets, dates and lower confidence on a shared image',async()=>{
 const recovery=vi.spyOn(GeminiAdapter.prototype,'recoverDate').mockResolvedValueOnce({date:'2026-07-13',confidence_date:0.2,printed_date:null,verify_date:true,recovery_diagnostics:[],verification_diagnostics:[]}).mockResolvedValueOnce({date:'2026-06-13',confidence_date:0.8,printed_date:'26/06/13',verify_date:true,recovery_diagnostics:[],verification_diagnostics:[]});
 const first=extraction();const second={...extraction('STATEMENT'),vendor:null,issuer:'Other issuer',total:20};
 const {response}=await scan([first,second,extraction('INVOICE','2026-06-15')]);
 expect(recovery).toHaveBeenCalledTimes(2);expect(recovery.mock.calls[1]![2]).toEqual({vendor:'Other issuer',doc_type:'STATEMENT',total:20});
 expect(response.results.map(r=>r.extraction.date)).toEqual(['2026-07-13','2026-06-13','2026-06-15']);
 expect(response.results[0]!.extraction.confidence_date).toBe(0.2);expect(new Set(response.results.map(r=>r.extractionId)).size).toBe(3);
});

