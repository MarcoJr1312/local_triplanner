// Direct fetch client for Resend (no SDK). The API key is read once at startup,
// never logged and never included in error messages.
//
// Docs: https://resend.com/docs/api-reference/emails/send-email
// Idempotency: https://resend.com/docs/dashboard/emails/idempotency-keys

import {
  EmailProviderError,
  type EmailProvider,
  type OutgoingEmail,
  type ProviderReadiness,
  type SendReceipt,
} from './types.ts';

export interface ResendProviderOptions {
  apiKey: string;
  from: string;
  replyTo?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

interface ResendErrorBody {
  name?: unknown;
  message?: unknown;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function errorDetails(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const { name, message } = body as ResendErrorBody;
  return {
    code: typeof name === 'string' ? name : undefined,
    message:
      typeof message === 'string'
        ? message.replace(EMAIL_PATTERN, '[redacted]').slice(0, 300)
        : undefined,
  };
}

function isRetryable(status: number, code: string | undefined): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  // A concurrent request with the same idempotency key is safe to retry.
  if (status === 409 && code === 'concurrent_idempotent_requests') return true;
  return false;
}

export function createResendProvider(options: ResendProviderOptions): EmailProvider {
  const endpoint = options.endpoint ?? 'https://api.resend.com/emails';
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? 'triplanner-email-service/0.1.0';
  const apiKey = options.apiKey.trim();

  const ready = (): ProviderReadiness => {
    if (!apiKey) return { ok: false, reason: 'RESEND_API_KEY is empty' };
    if (!options.from.trim()) return { ok: false, reason: 'RESEND_FROM is empty' };
    return { ok: true };
  };

  return {
    name: 'resend',
    ready,
    async send(email: OutgoingEmail): Promise<SendReceipt> {
      if (!ready().ok) throw new EmailProviderError('Resend provider is not configured', false);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': email.idempotencyKey,
              'User-Agent': userAgent,
            },
            body: JSON.stringify({
              from: options.from,
              to: [email.to],
              subject: email.subject,
              html: email.html,
              text: email.text,
              ...(options.replyTo ? { reply_to: options.replyTo } : {}),
            }),
            signal: controller.signal,
          });
        } catch (error) {
          const aborted = error instanceof Error && error.name === 'AbortError';
          throw new EmailProviderError(
            aborted ? `Resend timed out after ${timeoutMs}ms` : 'Resend request failed before a response',
            true,
          );
        }

        let rawBody: string;
        try {
          rawBody = await response.text();
        } catch {
          throw new EmailProviderError('Resend response could not be read', true);
        }
        let body: unknown = null;
        if (rawBody.length > 0) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = null;
          }
        }

        if (!response.ok) {
          const details = errorDetails(body);
          const suffix = details.message ? `: ${details.message}` : '';
          throw new EmailProviderError(
            `Resend HTTP ${response.status}${suffix}`,
            isRetryable(response.status, details.code),
            response.status,
            details.code,
          );
        }

        const id =
          typeof body === 'object' && body !== null && typeof (body as { id?: unknown }).id === 'string'
            ? (body as { id: string }).id
            : '';
        return { providerMessageId: id };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
