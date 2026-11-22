// Stable error codes shared by every route. The API maps these to GraphQL
// errors; the service never returns free-text-only failures.

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'ACTOR_REQUIRED'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'USERNAME_TAKEN'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'PROTECTED_USER'
  | 'NOTIFICATION_NOT_FOUND'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

const DEFAULT_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  ACTOR_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  EMAIL_TAKEN: 409,
  PROTECTED_USER: 403,
  NOTIFICATION_NOT_FOUND: 404,
  UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code] ?? 400;
  }
}

export interface ErrorBody {
  error: ErrorCode;
  message: string;
}

export function toErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.code, message: error.message } };
  }
  return {
    status: 500,
    body: { error: 'INTERNAL_ERROR', message: 'Error interno.' },
  };
}
