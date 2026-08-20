/**
 * StorageAdapter.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Wraps Cloudflare R2 for document image storage.
 * All business logic uses this adapter, not R2 directly.
 * Swapping storage provider: replace this file only.
 */

export interface StorageObject {
  key: string;
  size: number;
  contentType: string;
  body: ArrayBuffer;
}

export class StorageAdapter {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async upload(params: {
    key: string;
    data: Uint8Array | ArrayBuffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; size: number }> {
    await this.bucket.put(params.key, params.data, {
      httpMetadata: { contentType: params.contentType },
      customMetadata: params.metadata,
    });
    const size = params.data instanceof Uint8Array
      ? params.data.byteLength
      : params.data.byteLength;
    return { key: params.key, size };
  }

  async retrieve(key: string): Promise<StorageObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const body = await obj.arrayBuffer();
    return {
      key,
      size: body.byteLength,
      contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
      body,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const head = await this.bucket.head(key);
    return head !== null;
  }

  buildKey(runId: string, documentId: string, fileName: string): string {
    return `runs/${runId}/${documentId}/${fileName}`;
  }
}
