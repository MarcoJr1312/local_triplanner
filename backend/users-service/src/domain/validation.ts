// Input validation for the users contract. Returns normalized values or a
// stable AppError; the HTTP layer never validates on its own.

import { AppError } from '../errors.ts';

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MAX = 80;
export const QUERY_MAX = 80;
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 50;
export const BATCH_MAX = 200;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function pathUuid(value: string, field = 'user_id'): string {
  if (!isUuid(value)) {
    throw new AppError('USER_NOT_FOUND', 'Usuario no encontrado.');
  }
  return value;
}

export function pathNotificationId(value: string): string {
  if (!isUuid(value)) {
    throw new AppError('NOTIFICATION_NOT_FOUND', 'Notificación no encontrada.');
  }
  return value;
}

/** Opaque catalogue ids are trimmed but never validated against locations. */
export function favoriteLocationId(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > 128) {
    throw new AppError(
      'INVALID_ARGUMENT',
      'location_id debe tener entre 1 y 128 caracteres.',
    );
  }
  return trimmed;
}

export function requiredId(value: unknown, field: string, max = 128): string {
  return requiredString(value, field, 1, max);
}

export function notificationRole(value: unknown): 'editor' | 'viewer' {
  if (value !== 'editor' && value !== 'viewer') {
    throw new AppError('INVALID_ARGUMENT', "role debe ser 'editor' o 'viewer'.");
  }
  return value;
}

export function notificationStatus(value: unknown): 'read' | 'accepted' | 'declined' {
  if (value !== 'read' && value !== 'accepted' && value !== 'declined') {
    throw new AppError(
      'INVALID_ARGUMENT',
      "status debe ser 'read', 'accepted' o 'declined'.",
    );
  }
  return value;
}

export function notificationStatusFilter(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (
    value !== 'unread' &&
    value !== 'read' &&
    value !== 'accepted' &&
    value !== 'declined'
  ) {
    throw new AppError('INVALID_ARGUMENT', 'status inválido.');
  }
  return value;
}

export function notificationLimit(value: unknown): number {
  if (value === null || value === undefined || value === '') return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError('INVALID_ARGUMENT', 'limit inválido.');
  }
  return Math.min(parsed, 100);
}

/** Login and invite lookups normalize casing; the stored value is lowercase. */
export function normalizeUsername(value: unknown, field = 'username'): string {
  const raw = requiredString(value, field, 1, 64).toLowerCase();
  if (!USERNAME_PATTERN.test(raw)) {
    throw new AppError(
      'INVALID_ARGUMENT',
      `${field} debe tener 3-32 caracteres: minúsculas, números, guion o guion bajo.`,
    );
  }
  return raw;
}

export function loginUsername(value: unknown): string {
  return requiredString(value, 'username', 1, 64).trim().toLowerCase();
}

export function requiredPassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError('INVALID_ARGUMENT', 'La contraseña es obligatoria.');
  }
  // Never trim: leading/trailing spaces are valid password characters.
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    throw new AppError(
      'INVALID_ARGUMENT',
      `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`,
    );
  }
  return value;
}

export function requiredString(
  value: unknown,
  field: string,
  min = 1,
  max = 255,
): string {
  if (typeof value !== 'string') {
    throw new AppError('INVALID_ARGUMENT', `${field} es obligatorio.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new AppError(
      'INVALID_ARGUMENT',
      `${field} debe tener entre ${min} y ${max} caracteres.`,
    );
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) {
    throw new AppError('INVALID_ARGUMENT', `${field} no puede ser null.`);
  }
  return requiredString(value, field, min, max);
}

export function optionalLanguage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 'es' && value !== 'en') {
    throw new AppError('INVALID_ARGUMENT', "language debe ser 'es' o 'en'.");
  }
  return value;
}

export function optionalColor(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value.trim())) {
    throw new AppError('INVALID_ARGUMENT', 'color debe ser un hex #rrggbb.');
  }
  return value.trim();
}

export function optionalAvatarUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const url = requiredString(value, 'avatar_url', 1, 2048);
  if (!url.startsWith('/') && !url.startsWith('http://') && !url.startsWith('https://')) {
    throw new AppError('INVALID_ARGUMENT', 'avatar_url debe ser una URL válida.');
  }
  return url;
}

export function optionalEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const email = requiredString(value, 'email', 3, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new AppError('INVALID_ARGUMENT', 'email inválido.');
  }
  return email;
}

export function searchQuery(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') {
    throw new AppError('INVALID_ARGUMENT', 'query inválida.');
  }
  return value.trim().slice(0, QUERY_MAX);
}

export function searchLimit(value: unknown): number {
  if (value === null || value === undefined || value === '') return SEARCH_LIMIT_DEFAULT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError('INVALID_ARGUMENT', 'limit inválido.');
  }
  return Math.min(parsed, SEARCH_LIMIT_MAX);
}

export function batchIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new AppError('INVALID_ARGUMENT', 'ids debe ser una lista.');
  }
  if (value.length > BATCH_MAX) {
    throw new AppError('INVALID_ARGUMENT', `ids admite como máximo ${BATCH_MAX} valores.`);
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && isUuid(item)) unique.add(item);
  }
  return [...unique];
}
