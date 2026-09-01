/**
 * docStore.ts - Document cache to bypass React Router state limits.
 * Stores captured docs in module-level memory (survives re-renders,
 * NOT one-shot — stays until explicitly cleared).
 */

export interface CapturedDoc {
  dataUrl: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

let pendingDocs: CapturedDoc[] | null = null;

export const docStore = {
  set(docs: CapturedDoc[]) {
    pendingDocs = docs;
    console.log('[docStore] set', docs.length, 'docs');
  },
  /** Returns docs WITHOUT clearing — safe across re-renders / StrictMode */
  get(): CapturedDoc[] | null {
    console.log('[docStore] get →', pendingDocs?.length ?? 0, 'docs');
    return pendingDocs;
  },
  clear() {
    console.log('[docStore] cleared');
    pendingDocs = null;
  },
};
