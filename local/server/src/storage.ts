// Byte storage behind a small interface, so attachments and avatars stop
// caring whether the bytes live on local disk or in S3.
//
// Keys are storage-relative ('attachments/<itemId>/<file>'), never absolute
// paths. The DB stores the key; the public URL is derived by the backend.

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

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

export interface S3StorageOptions {
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

// S3 backend. AWS uses the task role (no credentials in env); MinIO in tests
// passes an endpoint plus local credentials.
export class S3Storage implements Storage {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(bucket: string, options: S3StorageOptions = {}) {
    this.bucket = bucket;
    this.client = new S3Client({
      region: options.region ?? process.env.AWS_REGION ?? 'us-east-1',
      ...(options.endpoint
        ? { endpoint: options.endpoint, forcePathStyle: options.forcePathStyle ?? true }
        : {}),
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, bytes: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 delete is idempotent; deleting a missing key succeeds.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (listed.Contents ?? []).map((item) => ({ Key: item.Key as string }));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys, Quiet: true },
          }),
        );
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  // Same-origin URL: the Next app proxies /uploads to the API, which validates
  // the HMAC signature before streaming the S3 object.
  publicPath(key: string): string {
    return `/uploads/${key}`;
  }
}

export function defaultStorage(): Storage {
  const bucket = process.env.S3_BUCKET?.trim();
  if (bucket) {
    return new S3Storage(bucket, {
      region: process.env.AWS_REGION,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1',
    });
  }
  return new LocalDiskStorage(uploadsRoot());
}
