/**
 * docStore.ts - Snap It & Forget It
 * Module-level cache to pass documents between CameraPage → ProcessingPage.
 * React Router location.state has a ~640KB limit and silently truncates arrays.
 * This store survives re-renders, StrictMode remounts, and navigation.
 */

interface Doc {
  dataUrl: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

let docs: Doc[] | null = null;

export const docStore = {
  set(documents: Doc[]) {
    docs = documents;
  },
  get(): Doc[] | null {
    return docs;
  },
  clear() {
    docs = null;
  },
};
