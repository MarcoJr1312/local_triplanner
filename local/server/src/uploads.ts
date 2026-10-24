// Serving estatico de /uploads/*.
// - Adjuntos (/uploads/attachments/*): SOLO con URL firmada (sig+exp+uid).
//   Sin firma, firma invalida o exp vencida -> 403.
// - Avatares y portadas: publicos por diseno (se muestran fuera del contexto
//   del viaje). Cache publica; los adjuntos firmados usan Cache-Control private.
// - Se mantiene el guard de path traversal.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { UPLOADS_DIR } from './profile.ts';
import { verifyAttachmentUrl } from './attachment-tokens.ts';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

function uploadsBase(): string {
  return process.env.TRIPLANNER_UPLOADS_OVERRIDE
    ? path.resolve(process.env.TRIPLANNER_UPLOADS_OVERRIDE)
    : UPLOADS_DIR;
}

export function serveUploads(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/uploads/')) return false;

  const isAttachment = url.pathname.startsWith('/uploads/attachments/');
  if (isAttachment && !verifyAttachmentUrl(url)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }

  const rel = decodeURIComponent(url.pathname.slice('/uploads/'.length));
  const base = uploadsBase();
  const abs = path.resolve(base, rel);
  // Guard contra path traversal: el archivo debe quedar dentro de uploads/
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    res.writeHead(404).end('Not found');
    return true;
  }
  if (!existsSync(abs) || path.extname(abs) === '') {
    res.writeHead(404).end('Not found');
    return true;
  }
  const ext = path.extname(abs).toLowerCase();
  const isPdf = ext === '.pdf';
  res.writeHead(200, {
    'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
    // inline para que el iframe del navegador renderice el PDF
    'Content-Disposition': isPdf ? 'inline' : 'inline; filename="upload"',
    'Cache-Control': isAttachment ? 'private, no-store' : 'public, max-age=86400',
  });
  res.end(readFileSync(abs));
  return true;
}
