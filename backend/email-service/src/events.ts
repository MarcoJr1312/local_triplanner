// Versioned event contract for `triplanner.email.requests.v1`.
//
// Producers emit a JSON envelope; this service is the only component that knows
// how an email is rendered or delivered. Validation errors are non-retryable:
// a malformed event goes straight to the dead-letter topic instead of blocking
// the partition.

export const EMAIL_EVENT_TYPES = [
  'email.invite.v1',
  'email.reminder.v1',
  'email.verification.v1',
  'email.welcome.v1',
  'email.member.joined.v1',
] as const;

export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];
export type Language = 'es' | 'en';
export type InviteRole = 'editor' | 'viewer';

export interface InvitePayload {
  to: string;
  tripName: string;
  ownerName: string;
  code: string;
  joinUrl: string;
  role?: InviteRole;
  language?: Language;
}

export interface ReminderPayload {
  to: string;
  tripName: string;
  itemTitle: string;
  day: string;
  startTime: string;
  language?: Language;
}

export interface VerificationPayload {
  to: string;
  link: string;
  name?: string;
  language?: Language;
}

export interface WelcomePayload {
  to: string;
  name: string;
  language?: Language;
}

export interface MemberJoinedPayload {
  to: string;
  ownerName: string;
  memberName: string;
  tripName: string;
  language?: Language;
}

interface Envelope<TType extends EmailEventType, TPayload> {
  id: string;
  type: TType;
  version: 1;
  occurredAt: string;
  source: string;
  payload: TPayload;
}

export type InviteEvent = Envelope<'email.invite.v1', InvitePayload>;
export type ReminderEvent = Envelope<'email.reminder.v1', ReminderPayload>;
export type VerificationEvent = Envelope<'email.verification.v1', VerificationPayload>;
export type WelcomeEvent = Envelope<'email.welcome.v1', WelcomePayload>;
export type MemberJoinedEvent = Envelope<'email.member.joined.v1', MemberJoinedPayload>;
export type EmailEvent =
  | InviteEvent
  | ReminderEvent
  | VerificationEvent
  | WelcomeEvent
  | MemberJoinedEvent;

export type ParseResult = { ok: true; event: EmailEvent } | { ok: false; reason: string };

const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

class InvalidEvent extends Error {}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidEvent(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new InvalidEvent(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new InvalidEvent(`${field} must not be empty`);
  if (trimmed.length > maxLength) throw new InvalidEvent(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, field, maxLength);
}

function email(value: unknown, field: string): string {
  const address = text(value, field, 320);
  if (!EMAIL_RE.test(address)) throw new InvalidEvent(`${field} must be a valid email address`);
  return address;
}

function httpUrl(value: unknown, field: string): string {
  const raw = text(value, field, 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidEvent(`${field} must be an absolute URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidEvent(`${field} must use http or https`);
  }
  return raw;
}

function language(value: unknown, field: string): Language | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new InvalidEvent(`${field} must be a string`);
  return value.trim().toLowerCase() === 'en' ? 'en' : 'es';
}

function role(value: unknown, field: string): InviteRole | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 'editor' && value !== 'viewer') {
    throw new InvalidEvent(`${field} must be editor or viewer`);
  }
  return value;
}

function base(event: Record<string, unknown>): { id: string; occurredAt: string; source: string } {
  const id = text(event.id, 'id', 256);
  if (!EVENT_ID_RE.test(id)) throw new InvalidEvent('id contains unsupported characters');

  if (event.version !== 1) throw new InvalidEvent('version must be 1');

  const occurredAt = text(event.occurredAt, 'occurredAt', 64);
  if (!Number.isFinite(Date.parse(occurredAt))) throw new InvalidEvent('occurredAt must be an ISO-8601 timestamp');

  const source = text(event.source, 'source', 100);
  return { id, occurredAt, source };
}

function parsePayload(type: EmailEventType, envelope: Record<string, unknown>): EmailEvent {
  const payload = record(envelope.payload, 'payload');

  switch (type) {
    case 'email.invite.v1': {
      const event = base(envelope);
      return {
        ...event,
        type,
        version: 1,
        payload: {
          to: email(payload.to, 'payload.to'),
          tripName: text(payload.tripName, 'payload.tripName', 200),
          ownerName: text(payload.ownerName, 'payload.ownerName', 120),
          code: text(payload.code, 'payload.code', 64),
          joinUrl: httpUrl(payload.joinUrl, 'payload.joinUrl'),
          role: role(payload.role, 'payload.role'),
          language: language(payload.language, 'payload.language'),
        },
      };
    }
    case 'email.reminder.v1': {
      const event = base(envelope);
      const day = text(payload.day, 'payload.day', 10);
      if (!DAY_RE.test(day)) throw new InvalidEvent('payload.day must be YYYY-MM-DD');
      const startTime = text(payload.startTime, 'payload.startTime', 5);
      if (!TIME_RE.test(startTime)) throw new InvalidEvent('payload.startTime must be HH:MM');
      return {
        ...event,
        type,
        version: 1,
        payload: {
          to: email(payload.to, 'payload.to'),
          tripName: text(payload.tripName, 'payload.tripName', 200),
          itemTitle: text(payload.itemTitle, 'payload.itemTitle', 200),
          day,
          startTime,
          language: language(payload.language, 'payload.language'),
        },
      };
    }
    case 'email.verification.v1': {
      const event = base(envelope);
      return {
        ...event,
        type,
        version: 1,
        payload: {
          to: email(payload.to, 'payload.to'),
          link: httpUrl(payload.link, 'payload.link'),
          name: optionalText(payload.name, 'payload.name', 120),
          language: language(payload.language, 'payload.language'),
        },
      };
    }
    case 'email.welcome.v1': {
      const event = base(envelope);
      return {
        ...event,
        type,
        version: 1,
        payload: {
          to: email(payload.to, 'payload.to'),
          name: text(payload.name, 'payload.name', 120),
          language: language(payload.language, 'payload.language'),
        },
      };
    }
    case 'email.member.joined.v1': {
      const event = base(envelope);
      return {
        ...event,
        type,
        version: 1,
        payload: {
          to: email(payload.to, 'payload.to'),
          ownerName: text(payload.ownerName, 'payload.ownerName', 120),
          memberName: text(payload.memberName, 'payload.memberName', 120),
          tripName: text(payload.tripName, 'payload.tripName', 200),
          language: language(payload.language, 'payload.language'),
        },
      };
    }
  }
}

/**
 * Parses and normalizes one Kafka message. The result is deliberately a value,
 * not an exception: callers route `{ ok: false }` to the DLQ.
 */
export function parseEmailEvent(raw: unknown): ParseResult {
  try {
    const envelope = record(raw, 'event');
    const type = text(envelope.type, 'type', 64);
    if (!(EMAIL_EVENT_TYPES as readonly string[]).includes(type)) {
      return { ok: false, reason: `unsupported event type: ${type}` };
    }
    // `parsePayload()` validates id/version/occurredAt/source and the payload
    // together, returning one typed discriminated union.
    return { ok: true, event: parsePayload(type as EmailEventType, envelope) };
  } catch (error) {
    return { ok: false, reason: error instanceof InvalidEvent ? error.message : 'invalid event' };
  }
}

/** Safe for logs: keeps the domain, hides the local part. */
export function redactEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return '***';
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const visible = local.length > 1 ? local.slice(0, 1) : '';
  return `${visible}***@${domain}`;
}

export function eventLogFields(event: EmailEvent): Record<string, unknown> {
  return {
    eventId: event.id,
    eventType: event.type,
    recipient: redactEmail(event.payload.to),
    language: event.payload.language ?? 'es',
  };
}
