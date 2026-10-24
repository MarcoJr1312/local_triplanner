// URLs firmadas de corta vida para los bytes de los adjuntos.
// - HMAC-SHA256 sobre `<pathname>:<userId>:<exp>` con ATTACHMENT_TOKEN_SECRET.
// - exp en segundos unix; TTL 15 min.
// - La firma es el token bearer: serveUploads NO conoce la sesion, solo valida
//   sig + exp. `uid` viaja en la URL para poder recomputar el HMAC.
// - NUNCA se imprime el secreto.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ATTACHMENT_TOKEN_SECRET } from './env.ts';

export const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;

export interface SignAttachmentUrlOptions {
  // Segundos unix. Si se pasa, manda sobre now + ttl.
  exp?: number;
  now?: number;
  ttlSeconds?: number;
}

export function attachmentSignature(pathname: string, userId: string, exp: number): string {
  return createHmac('sha256', ATTACHMENT_TOKEN_SECRET)
    .update(`${pathname}:${userId}:${exp}`)
    .digest('hex');
}

export function signAttachmentUrl(
  pathname: string,
  userId: string,
  options: SignAttachmentUrlOptions | number = {}
): string {
  const opts = typeof options === 'number' ? { exp: options } : options;
  const now = opts.now ?? Date.now();
  const exp = opts.exp ?? Math.floor(now / 1000) + (opts.ttlSeconds ?? ATTACHMENT_URL_TTL_SECONDS);
  const sig = attachmentSignature(pathname, userId, exp);
  const params = new URLSearchParams({
    uid: userId,
    exp: String(exp),
    sig,
  });
  return `${pathname}?${params.toString()}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyUploadSignature(
  pathname: string,
  userId: string | null | undefined,
  exp: string | number | null | undefined,
  sig: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!userId || !sig || exp === null || exp === undefined || exp === '') return false;
  const expNumber = typeof exp === 'number' ? exp : Number(exp);
  if (!Number.isInteger(expNumber)) return false;
  if (expNumber <= Math.floor(now / 1000)) return false;
  const expected = attachmentSignature(pathname, userId, expNumber);
  return safeEqual(sig, expected);
}

export function verifyAttachmentUrl(url: URL, now: number = Date.now()): boolean {
  return verifyUploadSignature(
    url.pathname,
    url.searchParams.get('uid'),
    url.searchParams.get('exp'),
    url.searchParams.get('sig'),
    now
  );
}
