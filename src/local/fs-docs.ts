/**
 * Filesystem R2-compatible docs bucket.
 */
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { DocsBucket, DocsObject } from '../types/env';

export class FsDocsBucket implements DocsBucket {
  constructor(private root: string) {}

  private full(key: string): string {
    const safe = key.replace(/\0/g, '').replace(/^\/+/, '');
    return join(this.root, safe);
  }

  async get(key: string): Promise<DocsObject | null> {
    try {
      const buf = await readFile(this.full(key));
      return {
        key,
        async text() {
          return buf.toString('utf8');
        },
      };
    } catch {
      return null;
    }
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    _options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown> {
    const path = this.full(key);
    await mkdir(dirname(path), { recursive: true });
    let data: string | Buffer;
    if (typeof value === 'string') data = value;
    else if (value instanceof ArrayBuffer) data = Buffer.from(value);
    else if (ArrayBuffer.isView(value)) {
      data = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (chunk) chunks.push(chunk);
      }
      data = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    }
    await writeFile(path, data);
    return {};
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string }[] }> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const objects: { key: string }[] = [];
    await walk(this.root, this.root, prefix, objects, limit);
    return { objects };
  }
}

async function walk(
  root: string,
  dir: string,
  prefix: string,
  out: { key: string }[],
  limit: number,
): Promise<void> {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= limit) return;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(root, full, prefix, out, limit);
    } else {
      const key = relative(root, full).replace(/\\/g, '/');
      if (!prefix || key.startsWith(prefix)) out.push({ key });
    }
  }
}
