// Client for the email service's BYOK settings endpoint. The browser never
// talks to the email service directly and never receives the API key.

import { EMAIL_SERVICE_URL, INTERNAL_TOKEN } from './env.ts';

export interface EmailSettingsGql {
  provider: string;
  from: string;
  replyTo: string;
  hasKey: boolean;
  ready: boolean;
}

export interface UpdateEmailSettingsInput {
  provider: string;
  apiKey?: string | null;
  from?: string | null;
  replyTo?: string | null;
  clearKey?: boolean | null;
}

export type EmailSettingsErrorCode = 'EMAIL_SETTINGS_FAILED' | 'EMAIL_CONFIG_INVALID';

export class EmailSettingsError extends Error {
  constructor(
    message: string,
    readonly code: EmailSettingsErrorCode,
  ) {
    super(message);
    this.name = 'EmailSettingsError';
  }
}

export interface EmailSettingsClient {
  get(): Promise<EmailSettingsGql>;
  update(input: UpdateEmailSettingsInput): Promise<EmailSettingsGql>;
}

export interface EmailSettingsClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePublic(value: unknown): EmailSettingsGql {
  if (!isRecord(value)) {
    throw new EmailSettingsError('invalid response from the email service', 'EMAIL_SETTINGS_FAILED');
  }
  const provider = value.provider;
  if (provider !== 'sink' && provider !== 'resend') {
    throw new EmailSettingsError('invalid provider in email settings response', 'EMAIL_SETTINGS_FAILED');
  }
  if (typeof value.from !== 'string' || typeof value.replyTo !== 'string') {
    throw new EmailSettingsError('invalid email settings response', 'EMAIL_SETTINGS_FAILED');
  }
  if (typeof value.hasKey !== 'boolean' || typeof value.ready !== 'boolean') {
    throw new EmailSettingsError('invalid email settings response', 'EMAIL_SETTINGS_FAILED');
  }
  return {
    provider,
    from: value.from,
    replyTo: value.replyTo,
    hasKey: value.hasKey,
    ready: value.ready,
  };
}

export function createEmailSettingsClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 5_000,
}: EmailSettingsClientOptions): EmailSettingsClient {
  const root = baseUrl.replace(/\/+$/, '');

  const request = async (path: string, init?: RequestInit): Promise<EmailSettingsGql> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${root}${path}`, { ...init, signal: controller.signal });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        throw new EmailSettingsError(
          aborted ? 'email settings service timed out' : 'email settings service unavailable',
          'EMAIL_SETTINGS_FAILED',
        );
      }

      const text = await response.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }

      if (!response.ok) {
        const detail = isRecord(body) && isRecord(body.error) ? body.error : {};
        const code =
          detail.code === 'EMAIL_CONFIG_INVALID' ? 'EMAIL_CONFIG_INVALID' : 'EMAIL_SETTINGS_FAILED';
        const message =
          typeof detail.message === 'string'
            ? detail.message.slice(0, 300)
            : `email service HTTP ${response.status}`;
        throw new EmailSettingsError(message, code);
      }

      return parsePublic(body);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get: () => request('/api/email/config'),
    update: (input) =>
      request('/api/email/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': token,
        },
        body: JSON.stringify({
          provider: input.provider,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.from !== undefined && input.from !== null ? { from: input.from } : {}),
          ...(input.replyTo !== undefined && input.replyTo !== null ? { replyTo: input.replyTo } : {}),
          ...(input.clearKey ? { clearKey: true } : {}),
        }),
      }),
  };
}

export const emailSettingsClient = createEmailSettingsClient({
  baseUrl: EMAIL_SERVICE_URL,
  token: INTERNAL_TOKEN,
});
