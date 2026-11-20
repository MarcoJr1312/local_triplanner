// BYOK runtime settings for the email service.
//
// Precedence: runtime override (PVC) > environment defaults. The Resend key is
// never returned by the public accessor and never logged. This mirrors the
// agent-service LLM settings store (`backend/agent-service/src/tripsuggest/settings.py`).

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.ts';

export type EmailProviderName = 'sink' | 'resend';

export interface EmailEnvDefaults {
  provider: EmailProviderName;
  apiKey: string;
  from: string;
  replyTo: string;
}

export interface EmailSettingsInput {
  provider: string;
  apiKey?: string | null;
  from?: string | null;
  replyTo?: string | null;
  clearKey?: boolean | null;
}

export interface EmailRuntimeSettings {
  provider: EmailProviderName;
  apiKey: string;
  from: string;
  replyTo: string;
}

export interface PublicEmailSettings {
  provider: EmailProviderName;
  from: string;
  replyTo: string;
  hasKey: boolean;
  ready: boolean;
}

interface SettingsFile {
  provider?: EmailProviderName;
  api_key?: string;
  from?: string;
  reply_to?: string;
}

export class EmailSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSettingsValidationError';
  }
}

const PROVIDERS: readonly EmailProviderName[] = ['sink', 'resend'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProvider(value: unknown): EmailProviderName {
  if (typeof value !== 'string') throw new EmailSettingsValidationError('provider must be a string');
  const provider = value.trim().toLowerCase();
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new EmailSettingsValidationError('provider must be sink or resend');
  }
  return provider as EmailProviderName;
}

function parseFile(raw: unknown): SettingsFile {
  if (!isRecord(raw)) throw new EmailSettingsValidationError('settings file must be an object');
  const result: SettingsFile = {};
  if ('provider' in raw) result.provider = parseProvider(raw.provider);
  if ('api_key' in raw) {
    if (typeof raw.api_key !== 'string') throw new EmailSettingsValidationError('api_key must be a string');
    result.api_key = raw.api_key;
  }
  if ('from' in raw) {
    if (typeof raw.from !== 'string') throw new EmailSettingsValidationError('from must be a string');
    result.from = raw.from.trim();
  }
  if ('reply_to' in raw) {
    if (typeof raw.reply_to !== 'string') throw new EmailSettingsValidationError('reply_to must be a string');
    result.reply_to = raw.reply_to.trim();
  }
  return result;
}

export interface EmailSettingsStoreOptions {
  filePath: string;
  defaults: EmailEnvDefaults;
  logger: Logger;
}

export class EmailSettingsStore {
  private readonly filePath: string;
  private readonly defaults: EmailEnvDefaults;
  private readonly logger: Logger;
  private override: SettingsFile = {};

  constructor({ filePath, defaults, logger }: EmailSettingsStoreOptions) {
    this.filePath = path.resolve(filePath);
    this.defaults = {
      provider: defaults.provider,
      apiKey: defaults.apiKey.trim(),
      from: defaults.from.trim(),
      replyTo: defaults.replyTo.trim(),
    };
    this.logger = logger;
    this.load();
  }

  get(): EmailRuntimeSettings {
    const provider = this.override.provider ?? this.defaults.provider;
    const apiKey =
      this.override.api_key !== undefined ? this.override.api_key.trim() : this.defaults.apiKey;
    return {
      provider,
      apiKey,
      from: (this.override.from ?? this.defaults.from).trim(),
      replyTo: (this.override.reply_to ?? this.defaults.replyTo).trim(),
    };
  }

  public(): PublicEmailSettings {
    const settings = this.get();
    return {
      provider: settings.provider,
      from: settings.from,
      replyTo: settings.replyTo,
      hasKey: settings.apiKey.length > 0,
      ready: settings.provider === 'sink' || (settings.apiKey.length > 0 && settings.from.length > 0),
    };
  }

  update(input: EmailSettingsInput): PublicEmailSettings {
    const provider = parseProvider(input.provider);
    if (input.apiKey !== undefined && input.apiKey !== null && typeof input.apiKey !== 'string') {
      throw new EmailSettingsValidationError('apiKey must be a string');
    }
    if (input.from !== undefined && input.from !== null && typeof input.from !== 'string') {
      throw new EmailSettingsValidationError('from must be a string');
    }
    if (input.replyTo !== undefined && input.replyTo !== null && typeof input.replyTo !== 'string') {
      throw new EmailSettingsValidationError('replyTo must be a string');
    }

    const current = this.get();
    const providedKey = (input.apiKey ?? '').trim();
    const clearKey = Boolean(input.clearKey);
    const from = (input.from ?? current.from).trim();
    const replyTo = (input.replyTo ?? current.replyTo).trim();

    if (clearKey && provider !== 'sink') {
      throw new EmailSettingsValidationError('clearKey requires provider=sink');
    }

    let effectiveKey: string;
    let persistKey: string | undefined;
    if (clearKey) {
      effectiveKey = '';
      persistKey = '';
    } else if (providedKey) {
      effectiveKey = providedKey;
      persistKey = providedKey;
    } else if (provider === 'sink') {
      effectiveKey = '';
      persistKey = '';
    } else if (current.apiKey) {
      // Keep the current key. If it came from env, do not copy the secret to
      // disk; if it came from a previous override, keep persisting it.
      effectiveKey = current.apiKey;
      persistKey = this.override.api_key;
    } else {
      throw new EmailSettingsValidationError('API key required for provider=resend');
    }

    if (provider === 'resend') {
      if (!effectiveKey) throw new EmailSettingsValidationError('API key required for provider=resend');
      if (!from) throw new EmailSettingsValidationError('A sender address is required for Resend');
    }

    const next: SettingsFile = {
      provider,
      from,
      reply_to: replyTo,
    };
    if (persistKey !== undefined) next.api_key = persistKey;

    this.write(next);
    this.override = next;
    this.logger.info('email.settings.updated', {
      provider,
      hasKey: effectiveKey.length > 0,
    });
    return this.public();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return;
    }

    try {
      const parsed = parseFile(JSON.parse(raw));
      const provider = parsed.provider ?? this.defaults.provider;
      const apiKey = parsed.api_key !== undefined ? parsed.api_key.trim() : this.defaults.apiKey;
      const from = (parsed.from ?? this.defaults.from).trim();
      if (provider === 'resend' && (!apiKey || !from)) {
        throw new EmailSettingsValidationError('override provider=resend without a key or sender');
      }
      this.override = parsed;
      this.logger.info('email.settings.loaded', {
        provider,
        hasKey: apiKey.length > 0,
        source: 'runtime',
      });
    } catch (error) {
      this.override = {};
      this.logger.warn('email.settings.invalid', {
        reason: error instanceof Error ? error.message : 'invalid settings file',
      });
    }
  }

  private write(next: SettingsFile): void {
    const directory = path.dirname(this.filePath);
    const tempPath = path.join(directory, `.email-${process.pid}-${Date.now()}.tmp`);

    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      try {
        chmodSync(directory, 0o700);
      } catch {
        // A Kubernetes PVC may be group-owned by fsGroup; 0700 can fail even
        // when the file itself is writable.
      }
      writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      chmodSync(tempPath, 0o600);
      renameSync(tempPath, this.filePath);
      chmodSync(this.filePath, 0o600);
    } catch (error) {
      try {
        unlinkSync(tempPath);
      } catch {
        // temp file may not exist
      }
      throw new Error(
        `could not persist email settings: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
