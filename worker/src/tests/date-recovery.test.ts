import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapters/GeminiAdapter';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00Z')); vi.spyOn(console,'info').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
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
  ['02/30/26',null],
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
  expect((await recover([candidate('07/20'),candidate('2025','copyright year')])).date).toBe('2026-07-20');
  expect((await recover([candidate('07/20'),candidate('2026','transaction year'),candidate('2025','transaction year')])).date).toBeNull();
});
it('returns null for conflicting equally ranked transaction dates',async()=>{
  expect((await recover([candidate('07/13/26'),candidate('07/20/26')])).date).toBeNull();
});
it('returns null for unreadable source and never inserts the frozen current date',async()=>{
  expect((await recover([])).date).toBeNull();
  expect((await recover([candidate('unreadable')])).date).toBeNull();
});

it.each(['Date/Time','Timestamp','receipt date','transaction time','purchase time','sale date','Date'])('accepts receipt label %s',async label=>{
  expect((await recover([candidate('07/20/26 14:32',label)])).date).toBe('2026-07-20');
});
it.each(['Due Date','return-by date','Expiry Date','expiration timestamp','copyright year','loyalty date','member purchase date','period start','unrelated transaction date'])('rejects receipt label %s',async label=>{
  expect((await recover([candidate('07/20/26',label)])).date).toBeNull();
});
it('prefers transaction date over timestamp and generic date',async()=>{
  expect((await recover([candidate('07/01/26','Date'),candidate('07/02/26','Timestamp'),candidate('07/20/26','purchase date')])).date).toBe('2026-07-20');
});
it('prefers receipt timestamp over generic date',async()=>{
  expect((await recover([candidate('07/01/26','Date'),candidate('07/20/26','Date/Time')])).date).toBe('2026-07-20');
});
it('requires generic dates to agree and ignores ineligible evidence',async()=>{
  expect((await recover([candidate('07/20/26','Date'),candidate('07/21/26','unrelated date')])).date).toBe('2026-07-20');
  expect((await recover([candidate('07/20/26','Date'),candidate('unreadable','unrelated date')])).date).toBe('2026-07-20');
});
it.each(['INVOICE','STATEMENT'])('does not broaden labels for %s',async type=>{
  for (const label of ['Date','Date/Time','Timestamp']) {
    expect((await recover([candidate('07/20/26',label)],type)).date).toBeNull();
  }
});

it('logs target, complete transcription and per-candidate decisions without source bytes',async()=>{
  const input=[candidate('07/20/26','transaction date'),candidate('07/21/26','Timestamp'),candidate('07/30/26','Due Date')];
  const result=await recover(input);
  expect(result).toMatchObject({date:'2026-07-20',confidence_date:0.7,printed_date:'07/20/26',verify_date:true});
  const logs=vi.mocked(console.info).mock.calls.map(call=>JSON.parse(String(call[0])));
  expect(new Set(logs.map(log=>log.attemptId)).size).toBe(1);
  expect(logs[0]).toMatchObject({event:'date-recovery',stage:'start',target:{vendor:'Target vendor',doc_type:'RECEIPT',total:112.34}});
  expect(logs.find(log=>log.stage==='transcription')).toMatchObject({matched:true,date_candidates:input});
  expect(logs.find(log=>log.stage==='processing')).toMatchObject({final_date:'2026-07-20',candidates:[
    {printed:'07/20/26',label:'transaction date',location:'matching document',confidence:0.7,normalized_date:'2026-07-20',rank:3,reason:'accepted'},
    {normalized_date:'2026-07-21',rank:2,reason:'lower_priority_label'},
    {normalized_date:'2026-07-30',rank:0,reason:'label_ineligible_or_standalone_year'},
  ]});
  expect(JSON.stringify(logs)).not.toContain('original-image');
});

it('logs normalization rejection and null selection without changing the result',async()=>{
  expect((await recover([candidate('02/30')])).date).toBeNull();
  const logs=vi.mocked(console.info).mock.calls.map(call=>JSON.parse(String(call[0])));
  expect(logs.find(log=>log.stage==='processing')).toMatchObject({final_date:null,candidates:[{normalized_date:null,rank:3,reason:'normalization_rejected_or_year_unavailable'}]});
});

it('keeps recovery working even when diagnostic logging fails',async()=>{
  vi.mocked(console.info).mockImplementation(()=>{throw new Error('Log unavailable');});
  expect((await recover([candidate('07/20/26')])).date).toBe('2026-07-20');
});

it.each(['transaction date','purchase time','Date','Timestamp'])('uses current year for a single matched receipt MM/DD: %s',async label=>{
  const result=await recover([candidate('07/20',label)]);
  expect(result).toMatchObject({date:'2026-07-20',printed_date:'07/20',confidence_date:0.5,verify_date:true});
});
it.each(['07/20/25','07/20/2025'])('never overrides printed year: %s',async printed=>{
  expect((await recover([candidate(printed)])).date).toBe('2025-07-20');
});
it.each(['07/21/25','07/21','2025 and 2026'])('does not guess current year when other eligible evidence exists: %s',async printed=>{
  expect((await recover([candidate('07/20'),candidate(printed,'transaction date')])).date).toBe(printed === '07/21/25' ? '2025-07-21' : null);
});
it.each(['Due Date','return-by date','Expiry Date','loyalty date'])('never applies MM/DD fallback to %s',async label=>{
  expect((await recover([candidate('07/20',label)])).date).toBeNull();
});
it('requires an exact match and only one eligible receipt candidate',async()=>{
  expect((await recover([candidate('07/20')],'RECEIPT',false)).date).toBeNull();
  expect((await recover([candidate('07/20'),candidate('07/21','Timestamp')])).date).toBeNull();
});
it.each([['INVOICE','invoice date'],['STATEMENT','statement date']])('keeps undated %s recovery unchanged',async(type,label)=>{
  expect((await recover([candidate('07/20',label)],type)).date).toBeNull();
});

it.each(['2020-07-20','2020-07-13','07/13/2020'])('offers old-year receipt %s only as a low-confidence review candidate',async printed=>{
  const result=await recover([candidate(printed)]);
  expect(result.date).toBe(printed.includes('20-07-20') ? '2026-07-20' : '2026-07-13');
  expect(result.confidence_date).toBe(0.4);
  expect(result.verify_date).toBe(true);
  expect(result.printed_date).toBe(printed);
});
it.each(['2025-07-20','2026-07-20'])('preserves in-range receipt date %s',async printed=>{
  expect((await recover([candidate(printed)])).date).toBe(printed);
});
it.each(['return policy deadline','Expiry Date','Due Date','return-by date','loyalty date','member date','copyright','unrelated date'])('ignores ineligible %s when checking receipt fallback conflicts',async label=>{
  const result=await recover([candidate('2020/07/13 14:30:35'),candidate('DEC 10 2020',label)]);
  expect(result).toMatchObject({date:'2026-07-13',printed_date:'2020/07/13 14:30:35',verify_date:true});
  expect(result.confidence_date).toBeLessThanOrEqual(0.4);
  expect((await recover([candidate('07/13'),candidate('DEC 10 2020',label)])).date).toBe('2026-07-13');
});
it.each(['2020-07-13','2025-07-20','07/21'])('blocks old-year fallback when other eligible date evidence exists: %s',async printed=>{
  expect((await recover([candidate('2020-07-20'),candidate(printed,'transaction date')])).date).toBe(printed === '2025-07-20' ? printed : null);
});
it.each(['Due Date','return-by date','Expiry Date','loyalty date'])('rejects old receipt date labeled %s',async label=>{
  expect((await recover([candidate('2020-07-20',label)])).date).toBeNull();
});
it.each(['2020-02-30','2020-13-20','2028-07-20'])('does not repair invalid calendar dates or future years: %s',async printed=>{
  expect((await recover([candidate(printed)])).date).toBeNull();
});
it.each([['INVOICE','invoice date'],['STATEMENT','statement date']])('leaves old %s dates rejected',async(type,label)=>{
  expect((await recover([candidate('2020-07-20',label)],type)).date).toBeNull();
});
it('does not repair an old date without an exact document match',async()=>{
  expect((await recover([candidate('2020-07-20')],'RECEIPT',false)).date).toBeNull();
});

const completeResponse = JSON.stringify({matched:true,date_candidates:[candidate('07/20/26')]});
const geminiResponse = (finishReason: string, text: string) => ({ok:true,json:async()=>({candidates:[{finishReason,content:{parts:[{text}]}}]})});
it.each(['STOP','MAX_TOKENS','OTHER'])('processes complete usable JSON with finishReason %s',async finishReason=>{
  const fetchMock=vi.fn().mockResolvedValue(geminiResponse(finishReason,completeResponse));
  vi.stubGlobal('fetch',fetchMock);
  const result=await new GeminiAdapter('test').recoverDate('original','image/jpeg',{vendor:'Target',doc_type:'RECEIPT',total:10});
  expect(result.date).toBe('2026-07-20');
  expect(result.recovery_diagnostics).toEqual([{finishReason,responseText:completeResponse,maxOutputTokens:1024}]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('retries truncated MAX_TOKENS once with a larger budget and succeeds',async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(geminiResponse('MAX_TOKENS','{"matched":true,')).mockResolvedValueOnce(geminiResponse('STOP',completeResponse));
  vi.stubGlobal('fetch',fetchMock);
  const result=await new GeminiAdapter('test').recoverDate('original','image/jpeg',{vendor:'Target',doc_type:'RECEIPT',total:10});
  expect(result.date).toBe('2026-07-20');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const bodies=fetchMock.mock.calls.map(call=>JSON.parse(call[1].body));
  expect(bodies[0].contents).toEqual(bodies[1].contents);
  expect(bodies.map(body=>body.generationConfig.maxOutputTokens)).toEqual([1024,4096]);
  expect(result.recovery_diagnostics.map(r=>r.finishReason)).toEqual(['MAX_TOKENS','STOP']);
});
it.each(['SAFETY','OTHER','STOP'])('reports exact finishReason and text for unusable JSON: %s',async finishReason=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(geminiResponse(finishReason,'{"matched":')));
  await expect(new GeminiAdapter('test').recoverDate('original','image/jpeg',{vendor:'Target',doc_type:'RECEIPT',total:10})).rejects.toMatchObject({
    message:`Date recovery response unusable (finishReason: ${finishReason})`,code:'DATE_RECOVERY_RESPONSE',
    recovery_diagnostics:[{finishReason,responseText:'{"matched":',maxOutputTokens:1024}],
  });
});
it('stops after one unsuccessful MAX_TOKENS retry',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(geminiResponse('MAX_TOKENS',''));
  vi.stubGlobal('fetch',fetchMock);
  await expect(new GeminiAdapter('test').recoverDate('original','image/jpeg',{vendor:'Target',doc_type:'RECEIPT',total:10})).rejects.toMatchObject({code:'DATE_RECOVERY_RESPONSE',recovery_diagnostics:[
    {finishReason:'MAX_TOKENS',responseText:'',maxOutputTokens:1024},
    {finishReason:'MAX_TOKENS',responseText:'',maxOutputTokens:4096},
  ]});
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('rejects complete JSON with incomplete candidate structure',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(geminiResponse('OTHER',JSON.stringify({matched:true,date_candidates:[{printed:'07/20/26'}]}))));
  await expect(new GeminiAdapter('test').recoverDate('original','image/jpeg',{vendor:'Target',doc_type:'RECEIPT',total:10})).rejects.toMatchObject({code:'DATE_RECOVERY_RESPONSE'});
});

it.each([
  [['2026/07/13 14:31:24','26/07/13','14:31','07/21'],'2026-07-13'],
  [['26/08/13 07:21:24','26/08/13','07:21'],'2026-08-13'],
  [['26/06/13','26/06/13 11:35:19'],'2026-06-13'],
  [['07/20/26','11:35:19'],'2026-07-20'],
  [['26-07-13'],'2026-07-13'],
  [['26/07/13','26/08/13'],null],
  [['14:31','07:21','11:35:19'],null],
])('resolves numeric interpretations and ignores times: %j',async(printed,date)=>{
  expect((await recover(printed.map(p=>candidate(p)))).date).toBe(date);
});
it('keeps ADP period ending and BC Hydro billing date',async()=>{
  expect((await recover([candidate('08/05/26','PAY DATE'),candidate('07/31/26','PERIOD ENDING')],'STATEMENT')).date).toBe('2026-07-31');
  expect((await recover([candidate('Jun 15, 2026','billing date'),candidate('Jul 06, 2026','due date')],'INVOICE')).date).toBe('2026-06-15');
});
it('requests compact recovery candidates',async()=>{
  await recover([candidate('26/07/13')]);
  const body=JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(body.contents[0].parts[0].text).toContain('Stop after 8 candidates');
  expect(body.contents[0].parts[0].text).toContain('standalone times');
  expect(body.generationConfig.maxOutputTokens).toBe(1024);
});
it('deduplicates generic dates and rejects different eligible generic dates',async()=>{
  expect((await recover([candidate('26/07/13','Date'),candidate('2026/07/13','Date'),candidate('14:31','Date')])).date).toBe('2026-07-13');
  expect((await recover([candidate('26/07/13','Date'),candidate('26/08/13','Date')])).date).toBeNull();
});
