import { afterEach, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapters/GeminiAdapter';
afterEach(()=>vi.unstubAllGlobals());
it.each([
  [{matched:true,date:'2026-07-13',printed_date:'26/07/13',confidence_date:0.7},'2026-07-13'],
  [{matched:true,date:'2020-07-13',printed_date:'20/07/13',confidence_date:0.95},null],
  [{matched:false,date:'2026-07-13',printed_date:'26/07/13',confidence_date:0.95},null],
  [{matched:true,date:'2026-07-13',printed_date:null,confidence_date:0.95},null],
  [{matched:true,date:null,printed_date:null,confidence_date:0.1},null],
])('date-only recovery requires matching source evidence and valid in-range dates',async(raw,expected)=>{
  const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]})});
  vi.stubGlobal('fetch',fetchMock);
  const result=await new GeminiAdapter('test').recoverDate('aA==','image/jpeg',{vendor:'Canadian Tire',doc_type:'RECEIPT',total:10});
  expect(result.date).toBe(expected); expect(result.verify_date).toBe(true);
  if(expected) expect(result.confidence_date).toBe(0.7);
  expect(fetchMock.mock.calls[0]?.[0]).toContain('gemini-3.5-flash');
});
