import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapters/GeminiAdapter';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00Z')); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const candidate = (printed: string, label = 'transaction timestamp') => ({printed,label,location:'matching document',confidence_date:0.7});
async function recover(date_candidates: ReturnType<typeof candidate>[], doc_type='RECEIPT', matched=true) {
  const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({matched,date_candidates,date:'2020-01-01'})}]}}]})});
  vi.stubGlobal('fetch',fetchMock);
  const target={vendor:'Target vendor',doc_type,total:112.34};
  const result=await new GeminiAdapter('test').recoverDate('original-image','image/png',target);
  const payload=JSON.parse(fetchMock.mock.calls[0]![1].body);
  expect(payload.contents[0].parts[1]).toEqual({inline_data:{mime_type:'image/png',data:'original-image'}});
  expect(payload.contents[0].parts[0].text).toContain(JSON.stringify(target));
  expect(payload.contents[0].parts[0].text).toContain('Do not normalize');
  expect(payload.contents[0].parts[0].text).toContain('Never borrow a date or year from another document');
  expect(result.verify_date).toBe(true);
  return result;
}

it.each([
  ['07/20/26 14:32','2026-07-20'],
  ['07/13/26','2026-07-13'],
  ['07-13-26','2026-07-13'],
  ['2026/07/13','2026-07-13'],
  ['2026-07-13','2026-07-13'],
  ['07/13/2025','2025-07-13'],
  ['07/13/25','2025-07-13'],
  ['07/13/2020',null],
  ['02/30/26',null],
  ['07/13',null],
  ['unreadable',null],
])('normalizes printed evidence %s to %s without today or model normalization',async(printed,date)=>{
  const result=await recover([candidate(printed)]);
  expect(result.date).toBe(date);
  expect(result.confidence_date).toBe(date ? 0.7 : 0);
  if(date) expect(result.printed_date).toBe(printed);
});

it('chooses invoice date over due date regardless of candidate order',async()=>{
  const result=await recover([candidate('07/15/26','payment due date'),candidate('06/15/26','Invoice Date')],'INVOICE');
  expect(result.date).toBe('2026-06-15');
});
it('does not substitute a due date for an unreadable invoice date',async()=>{
  expect((await recover([candidate('07/15/26','Due Date'),candidate('unreadable','Invoice Date')],'INVOICE')).date).toBeNull();
});
it('selects statement period end rather than start or payment due date',async()=>{
  const result=await recover([candidate('06/01/26','statement period start'),candidate('07/15/26','payment due date'),candidate('06/30/26','statement period end')],'STATEMENT');
  expect(result.date).toBe('2026-06-30');
});
it('prefers explicitly labeled statement date and retains named-month support',async()=>{
  expect((await recover([candidate('06/30/26','period end'),candidate('June 15, 2026','Statement Date')],'STATEMENT')).date).toBe('2026-06-15');
});
it('uses a primary labeled document date',async()=>{
  expect((await recover([candidate('06/15/26','primary document date')],'DOCUMENT')).date).toBe('2026-06-15');
});
it('rejects dates when the exact document in a multi-document image is not matched',async()=>{
  expect((await recover([candidate('07/20/26')],'RECEIPT',false)).date).toBeNull();
});
it('uses an explicit year elsewhere on the same matched document for MM/DD',async()=>{
  expect((await recover([candidate('07/20'),candidate('2026','transaction year')])).date).toBe('2026-07-20');
});
it('does not use copyright years or resolve conflicting years by guessing',async()=>{
  expect((await recover([candidate('07/20'),candidate('2026','copyright year')])).date).toBeNull();
  expect((await recover([candidate('07/20'),candidate('2026','transaction year'),candidate('2025','transaction year')])).date).toBeNull();
});
it('returns null for conflicting equally ranked transaction dates',async()=>{
  expect((await recover([candidate('07/13/26'),candidate('07/20/26')])).date).toBeNull();
});
it('returns null for unreadable source and never inserts the frozen current date',async()=>{
  expect((await recover([])).date).toBeNull();
  expect((await recover([candidate('09/11')])).date).toBeNull();
});
