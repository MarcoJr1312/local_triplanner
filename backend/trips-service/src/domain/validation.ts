// Request validation. Every failure is an AppError with a stable code, so the
// API can map it without parsing messages.

import { AppError } from '../errors.ts';
import type { Role } from './types.ts';

export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'];
export const INVITE_ROLES: readonly Role[] = ['editor', 'viewer'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(field: string, detail: string): never {
  throw new AppError('INVALID_ARGUMENT', `${field}: ${detail}`);
}

export function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
  maxLength = 512,
): string {
  const value = body[key];
  if (typeof value !== 'string') invalid(key, 'se requiere un string');
  const trimmed = value.trim();
  if (trimmed === '') invalid(key, 'no puede estar vacío');
  if (trimmed.length > maxLength) invalid(key, `máximo ${maxLength} caracteres`);
  return trimmed;
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  maxLength = 512,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== 'string') invalid(key, 'se requiere un string o null');
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maxLength) invalid(key, `máximo ${maxLength} caracteres`);
  return trimmed;
}

export function requiredId(body: Record<string, unknown>, key: string): string {
  return requiredString(body, key, 128);
}

/** Validates an id coming from a URL path. */
export function pathId(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('INVALID_ARGUMENT', `${name}: id requerido`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 128) throw new AppError('INVALID_ARGUMENT', `${name}: id demasiado largo`);
  return trimmed;
}

export function optionalId(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return optionalString(body, key, 128);
}

export function requiredDate(body: Record<string, unknown>, key: string): string {
  const value = requiredString(body, key, 10);
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    invalid(key, 'se espera YYYY-MM-DD');
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    invalid(key, 'fecha inexistente');
  }
  return value;
}

export function optionalDate(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  return requiredDate(body, key);
}

export function requiredTime(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(body, key, 5);
  if (!TIME_RE.test(value)) invalid(key, 'se espera HH:MM');
  return value;
}

export function optionalTime(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  return requiredTime(body, key);
}

export function requiredNumber(
  body: Record<string, unknown>,
  key: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(key, 'se requiere un número');
  }
  if (value < min || value > max) invalid(key, `debe estar entre ${min} y ${max}`);
  return value;
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number | null | undefined {
  if (!has(body, key)) return undefined;
  if (body[key] === null) return null;
  return requiredNumber(body, key, min, max);
}

export function optionalInteger(
  body: Record<string, unknown>,
  key: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number | null | undefined {
  const value = optionalNumber(body, key, min, max);
  if (value === undefined || value === null) return value;
  if (!Number.isInteger(value)) invalid(key, 'se requiere un entero');
  return value;
}

export function requiredInteger(
  body: Record<string, unknown>,
  key: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = requiredNumber(body, key, min, max);
  if (!Number.isInteger(value)) invalid(key, 'se requiere un entero');
  return value;
}

export function requiredBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== 'boolean') invalid(key, 'se requiere un booleano');
  return value;
}

export function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  if (!has(body, key)) return undefined;
  return requiredBoolean(body, key);
}

export function requiredRole(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly Role[],
): Role {
  const value = requiredString(body, key, 16);
  if (!allowed.includes(value as Role)) {
    throw new AppError('INVALID_MEMBER_ROLE', `Rol de miembro no válido: ${value}`);
  }
  return value as Role;
}

export function requiredEmail(body: Record<string, unknown>, key: string): string {
  const value = requiredString(body, key, 320).toLowerCase();
  if (!EMAIL_RE.test(value)) invalid(key, 'email no válido');
  return value;
}

export function optionalEmail(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  if (body[key] === null) return null;
  return requiredEmail(body, key);
}

/** Validates an IANA time zone with the platform Intl data. */
export function validateTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    throw new AppError('INVALID_ARGUMENT', `timezone: zona no válida (${value})`);
  }
}
