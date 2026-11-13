// Byte storage behind a small interface, so attachments and avatars stop
// caring whether the bytes live on local disk or in S3.
//
// Keys are storage-relative ('attachments/<itemId>/<file>'), never absolute
// paths. The DB stores the key; the public URL is derived by the backend.

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Storage {
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  /** URL the browser uses for this key (signed separately when needed). */
  publicPath(key: string): string;
}

export class LocalDiskStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private absolute(key: string): string {
    const abs = path.resolve(this.root, key);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error('Clave de almacenamiento inválida.');
    }
    return abs;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const abs = this.absolute(key);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }

  async read(key: string): Promise<Buffer | null> {
    const abs = this.absolute(key);
    return existsSync(abs) ? readFileSync(abs) : null;
  }

  async delete(key: string): Promise<void> {
    try {
      unlinkSync(this.absolute(key));
    } catch {
      // already gone or in use: deleting bytes is best effort
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    rmSync(this.absolute(prefix), { recursive: true, force: true });
  }

  publicPath(key: string): string {
    return `/uploads/${key}`;
  }
}

export function uploadsRoot(): string {
  return process.env.TRIPLANNER_UPLOADS_OVERRIDE
    ? path.resolve(process.env.TRIPLANNER_UPLOADS_OVERRIDE)
    : path.resolve(__dirname, '..', 'uploads');
}

export function defaultStorage(): Storage {
  return new LocalDiskStorage(uploadsRoot());
}
