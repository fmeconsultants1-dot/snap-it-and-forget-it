import { afterEach, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapters/GeminiAdapter';
afterEach(()=>{ vi.unstubAllGlobals(); vi.useRealTimers(); });
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

it.each([
  {name:'receipt timestamp with two-digit year',type:'RECEIPT',printed:'07/20/26 14:32',date:'2026-07-20',dateType:'transaction_date',reason:'Transaction timestamp at receipt bottom',instruction:'07/20/26 14:32 means the business date is 2026-07-20'},
  {name:'invoice date instead of due date',type:'INVOICE',printed:'Invoice Date: 06/15/2026',date:'2026-06-15',dateType:'invoice_date',reason:'Invoice header; ignored Due Date 07/15/2026',instruction:'Do NOT use Due Date when an invoice, issue or bill date exists'},
  {name:'statement date',type:'STATEMENT',printed:'Statement Date: June 15, 2026',date:'2026-06-15',dateType:'statement_date',reason:'Statement header',instruction:'use Statement Date or explicit Statement Period End date'},
  {name:'statement period end',type:'STATEMENT',printed:'Statement Period: June 1 - June 30, 2026',date:'2026-06-30',dateType:'period_end',reason:'Explicit statement period end, not payment due date',instruction:'Do not use payment due dates'},
  {name:'MM/DD with year elsewhere on same document',type:'RECEIPT',printed:'Purchase 07/20; Transaction year 2026',date:'2026-07-20',dateType:'transaction_date',reason:'Purchase line and transaction-year header on same receipt',instruction:'Include both exact text fragments in printed_date'},
])('date recovery contract: $name', async ({type,printed,date,dateType,reason,instruction}) => {
  const target={vendor:'Target vendor',doc_type:type,total:112.34};
  const raw={matched:true,printed_date:printed,date,confidence_date:0.85,date_type:dateType,reason};
  const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]})});
  vi.stubGlobal('fetch',fetchMock);
  const result=await new GeminiAdapter('test').recoverDate('original-image','image/png',target);
  const payload=JSON.parse(fetchMock.mock.calls[0]![1].body);
  const prompt=payload.contents[0].parts[0].text;
  expect(prompt).toContain(JSON.stringify(target));
  expect(prompt).toContain(instruction);
  expect(prompt).toContain('Transcribe visible date strings exactly before normalizing them');
  expect(prompt).toContain('Never take a date or year from another document in the same image');
  expect(payload.contents[0].parts[1]).toEqual({inline_data:{mime_type:'image/png',data:'original-image'}});
  expect(result).toMatchObject({date,printed_date:printed,confidence_date:0.85});
});

it.each([
  {name:'another document in a multi-document image',matched:false,printed_date:'07/20/26',date:'2026-07-20'},
  {name:'genuinely unreadable date',matched:true,printed_date:null,date:null},
  {name:'unsupported date with no printed evidence',matched:true,printed_date:null,date:'2026-09-11'},
  {name:'missing year on matching document',matched:true,printed_date:'07/20',date:null},
  {name:'malformed date',matched:true,printed_date:'02/30/26',date:'2026-02-30'},
  {name:'out-of-range date',matched:true,printed_date:'07/20/1900',date:'1900-07-20'},
])('returns null without substituting today: $name',async raw=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
  const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...raw,confidence_date:0.9})}]}}]})});
  vi.stubGlobal('fetch',fetchMock);
  const result=await new GeminiAdapter('test').recoverDate('original','image/jpeg',{vendor:'Target',doc_type:'RECEIPT',total:10});
  expect(result.date).toBeNull();
  expect(result.confidence_date).toBe(0);
  const prompt=JSON.parse(fetchMock.mock.calls[0]![1].body).contents[0].parts[0].text;
  expect(prompt).toContain("Never use today's date, the scan date or the current year");
  expect(prompt).toContain('If the year truly cannot be determined from the matching document, return null');
});
