// Stable error codes shared by every route. The API maps these to GraphQL
// errors; the service never returns free-text-only failures.

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'ACTOR_REQUIRED'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'TRIP_NOT_FOUND'
  | 'NOT_TRIP_MEMBER'
  | 'FORBIDDEN_EDIT'
  | 'NOT_TRIP_OWNER'
  | 'ITEM_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'OWNER_ROLE_PROTECTED'
  | 'OWNER_CANNOT_BE_REMOVED'
  | 'OWNER_MUST_TRANSFER'
  | 'INVALID_TRANSFER_TARGET'
  | 'INVALID_MEMBER_ROLE'
  | 'INVITE_CODE_NOT_FOUND'
  | 'INVITE_ALREADY_USED'
  | 'INVITE_EMAIL_MISMATCH'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_INVITEE_MISMATCH'
  | 'ALREADY_MEMBER'
  | 'FORBIDDEN'
  | 'INVALID_INVITE_ROLE'
  | 'LOCATIONS_UNAVAILABLE'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

const DEFAULT_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  ACTOR_REQUIRED: 401,
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  TRIP_NOT_FOUND: 404,
  NOT_TRIP_MEMBER: 403,
  FORBIDDEN_EDIT: 403,
  NOT_TRIP_OWNER: 403,
  ITEM_NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
  OWNER_ROLE_PROTECTED: 403,
  OWNER_CANNOT_BE_REMOVED: 403,
  OWNER_MUST_TRANSFER: 409,
  INVALID_TRANSFER_TARGET: 400,
  INVALID_MEMBER_ROLE: 400,
  INVITE_CODE_NOT_FOUND: 404,
  INVITE_ALREADY_USED: 409,
  INVITE_EMAIL_MISMATCH: 403,
  INVITE_NOT_FOUND: 404,
  INVITE_INVITEE_MISMATCH: 403,
  ALREADY_MEMBER: 409,
  FORBIDDEN: 403,
  INVALID_INVITE_ROLE: 400,
  LOCATIONS_UNAVAILABLE: 503,
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
