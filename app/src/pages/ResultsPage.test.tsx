import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ResultsPage from './ResultsPage';

const mocked = vi.hoisted(() => ({
  state: {} as any, navigate: vi.fn(), manual: vi.fn(), skip: vi.fn(), approve: vi.fn(), scan: vi.fn(), duplicates: vi.fn(), recoverDate: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: mocked.state }), useNavigate: () => mocked.navigate }));
vi.mock('../lib/api', () => ({
  documentApi: { recoverDate: mocked.recoverDate, manual: mocked.manual, skip: mocked.skip },
  ledgerApi: { updateAndApprove: mocked.approve, duplicates: mocked.duplicates }, scanApi: { processDocumentRaw: mocked.scan },
}));
vi.mock('../lib/camera', () => ({ fileToCapture: async () => ({ base64: 'replacement', mimeType: 'image/jpeg', fileName: 'new.jpg' }) }));
const failed = () => Object.freeze({ documentId: 'original', ledgerEntryId: '', status: 'FAILED', error: 'Unreadable', extraction: Object.freeze({}) });
const success = () => Object.freeze({ documentId: 'success', ledgerEntryId: 'ledger', status: 'DONE', extraction: Object.freeze({ doc_type: 'RECEIPT', vendor: 'Shop', date: '2026-09-08', subtotal: 10, total: 10, tax: 0 }) });
let tree: ReactTestRenderer;
const label = (node: any): string => node.children.map((c: any) => typeof c === 'string' ? c : label(c)).join('');
const buttons = () => tree.root.findAllByType('button');
const button = (text: string) => buttons().find(b => label(b).includes(text))!;
async function click(text: string) { await act(async () => { await button(text).props.onClick(); }); }
function mount() { act(() => { tree = create(<ResultsPage />, { createNodeMock: () => ({ scrollIntoView() {}, click() {} }) }); }); }
beforeEach(() => {
  vi.clearAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  mocked.state = { runId: 'run', results: [failed()] };
  mocked.duplicates.mockResolvedValue({ candidates: [] });
  mocked.skip.mockResolvedValue({ success: true });
  mocked.manual.mockResolvedValue({ success: true, status: 'APPROVED' });
  mocked.approve.mockResolvedValue({ success: true });
});
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals(); });

describe('Bug E review completion', () => {
  it('shows final action only after the final failed item is explicitly skipped', async () => {
    mocked.state.results = [success(), failed()]; mount();
    await click('Approve & Save');
    expect(button('View Ledger')).toBeUndefined();
    await click('Skip');
    expect(mocked.skip).toHaveBeenCalledWith('original', undefined);
    expect(button('View Ledger')).toBeDefined();
    expect(mocked.state.results[1].status).toBe('FAILED');
  });
  it('allows an all-skipped run to exit and restores completion on remount', async () => {
    mount(); await click('Skip'); expect(button('View Ledger')).toBeDefined();
    act(() => tree.unmount()); mount();
    expect(button('View Ledger')).toBeDefined();
    expect(mocked.skip).toHaveBeenCalledTimes(1);
  });
  it('recovers a failed item through the document endpoint, not a missing ledger ID', async () => {
    mount(); await click('Enter Manually'); await click('Approve & Save');
    expect(mocked.manual).toHaveBeenCalledWith('original', expect.objectContaining({ doc_type: 'DOCUMENT' }));
    expect(mocked.approve).not.toHaveBeenCalled();
    expect(button('View Ledger')).toBeDefined();
    expect(mocked.state.results[0].ledgerEntryId).toBe('');
  });
  it('keeps manual input visible after failure and allows retry', async () => {
    mocked.manual.mockRejectedValueOnce(new Error('Temporary failure'));
    mount(); await click('Enter Manually'); await click('Approve & Save');
    expect(button('View Ledger')).toBeUndefined();
    expect(button('Approve & Save')).toBeDefined();
    await click('Approve & Save'); expect(button('View Ledger')).toBeDefined();
  });
  it('does not treat a failed skip as completion', async () => {
    mocked.skip.mockRejectedValueOnce(new Error('Offline')); mount(); await click('Skip');
    expect(button('View Ledger')).toBeUndefined();
    await click('Skip'); expect(button('View Ledger')).toBeDefined();
  });
  it('retakes inside the same run, retaining original objects and requiring replacement approval', async () => {
    mocked.scan.mockResolvedValue({ results: [success()] });
    mount(); await click('Retake');
    const file = tree.root.findAllByType('input').find(n => n.props.type === 'file')!;
    await act(async () => { file.props.onChange({ target: { files: [{}], value: 'new.jpg' } }); });
    // Allow the async capture/scan/skip chain to finish.
    await act(async () => {});
    expect(mocked.scan).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run', imageBase64: 'replacement' }));
    expect(mocked.navigate).not.toHaveBeenCalled();
    expect(mocked.state.results).toHaveLength(1);
    expect(mocked.state.results[0].documentId).toBe('original');
    expect(button('View Ledger')).toBeUndefined();
    await click('Approve & Save'); expect(button('View Ledger')).toBeDefined();
  });
});

it('prefills a valid 70% date and visibly asks the user to verify it', () => {
  const result = success();
  mocked.state.results = [{ ...result, extraction: { ...result.extraction, confidence_date: 0.70 } }];
  mount();
  expect(tree.root.findAllByType('input').find(n => n.props.type === 'date')?.props.value).toBe('2026-09-08');
  expect(JSON.stringify(tree.toJSON())).toContain('Verify date');
});

it('confirms deletion, removes only the selected unapproved item, and leaves other cards available', async () => {
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('window', { confirm });
  mocked.state.results = [success(), { ...success(), ledgerEntryId: 'second' }]; mount();
  await click('Delete'); expect(mocked.skip).not.toHaveBeenCalled();
  expect(tree.root.findAll(n => n.props.className === 'review-card')).toHaveLength(2);
  await click('Delete'); expect(mocked.skip).toHaveBeenCalledWith('success', 'ledger');
  expect(tree.root.findAll(n => n.props.className === 'review-card')).toHaveLength(1);
  await click('Approve & Save'); expect(button('View Ledger')).toBeDefined();
});
it('does not offer Delete for an already-approved ledger record', () => {
  mocked.state.results = [{ ...success(), approved: true }]; mount();
  expect(button('Delete')).toBeUndefined();
});
it('retains the item and entered values when deletion fails', async () => {
  vi.stubGlobal('window', { confirm: () => true });
  mocked.skip.mockRejectedValueOnce(new Error('Offline'));
  mocked.state.results = [success()]; mount(); await click('Delete');
  expect(tree.root.findAll(n => n.props.className === 'review-card')).toHaveLength(1);
  expect(tree.root.findAllByType('input').some(n => n.props.value === 'Shop')).toBe(true);
});

it('prefills a missing date from source recovery and marks it for verification', async () => {
  mocked.recoverDate.mockResolvedValue({date:'2026-07-13',confidence_date:0.7,printed_date:'26/07/13'});
  const item = success(); mocked.state.results=[{...item,extractionId:'date-test',extraction:{...item.extraction,date:null}}];
  await act(async()=>{mount();});
  expect(mocked.recoverDate).toHaveBeenCalledWith('date-test');
  expect(tree.root.findAllByType('input').find(n=>n.props.type==='date')?.props.value).toBe('2026-07-13');
  expect(JSON.stringify(tree.toJSON())).toContain('Verify date — recovered');
});