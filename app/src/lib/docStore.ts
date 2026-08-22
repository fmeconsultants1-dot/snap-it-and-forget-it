/**
 * docStore.ts - Minimal document cache to bypass React Router state limits.
 * Stores captured docs in memory (not history.state) so multi-photo runs
 * aren't truncated by the browser's history state size cap.
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
  },
  get(): CapturedDoc[] | null {
    const docs = pendingDocs;
    pendingDocs = null; // one-shot read
    return docs;
  },
  clear() {
    pendingDocs = null;
  },
};
