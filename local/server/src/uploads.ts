// Serves /uploads/* from Storage.
// - Attachments require a valid short-lived signature (sig+exp+uid).
// - Avatars and covers are public by design.
// - Path traversal is rejected inside the storage backend.

import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Storage } from './storage.ts';
import { verifyAttachmentUrl } from './attachment-tokens.ts';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

export async function serveUploads(req: IncomingMessage, res: ServerResponse, storage: Storage): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/uploads/')) return false;

  const isAttachment = url.pathname.startsWith('/uploads/attachments/');
  if (isAttachment && !verifyAttachmentUrl(url)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }

  const key = decodeURIComponent(url.pathname.slice('/uploads/'.length));
  if (key.split('/').includes('..')) {
    res.writeHead(404).end('Not found');
    return true;
  }

  const ext = path.extname(key).toLowerCase();
  if (!ext) {
    res.writeHead(404).end('Not found');
    return true;
  }

  const bytes = await storage.read(key);
  if (!bytes) {
    res.writeHead(404).end('Not found');
    return true;
  }

  const isPdf = ext === '.pdf';
  res.writeHead(200, {
    'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
    'Content-Disposition': isPdf ? 'inline' : 'inline; filename="upload"',
    'Cache-Control': isAttachment ? 'private, no-store' : 'public, max-age=86400',
  });
  res.end(bytes);
  return true;
}
