// Provider router for BYOK settings. The underlying provider is rebuilt only
// when the runtime settings change; the key is never logged or included in a
// readiness/error message.

import type { EmailSettingsStore } from '../settings.ts';
import type { Logger } from '../logger.ts';
import { createResendProvider } from './resend.ts';
import { createSinkProvider } from './sink.ts';
import { EmailProviderError, type EmailProvider, type OutgoingEmail, type ProviderReadiness, type SendReceipt } from './types.ts';

export interface SettingsProviderOptions {
  endpoint: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export function createSettingsProvider(
  store: EmailSettingsStore,
  logger: Logger,
  { endpoint, timeoutMs, fetchImpl }: SettingsProviderOptions,
): EmailProvider {
  let cached: EmailProvider | undefined;
  let cachedFingerprint = '';

  const ready = (): ProviderReadiness => {
    const settings = store.get();
    if (settings.provider === 'sink') return { ok: true };
    if (!settings.apiKey) return { ok: false, reason: 'Resend API key is not configured' };
    if (!settings.from) return { ok: false, reason: 'Resend sender is not configured' };
    return { ok: true };
  };

  const current = (): EmailProvider => {
    const settings = store.get();
    const fingerprint = JSON.stringify([
      settings.provider,
      settings.apiKey,
      settings.from,
      settings.replyTo,
      endpoint,
      timeoutMs,
    ]);
    if (!cached || fingerprint !== cachedFingerprint) {
      cached =
        settings.provider === 'sink'
          ? createSinkProvider(logger)
          : createResendProvider({
              apiKey: settings.apiKey,
              from: settings.from,
              replyTo: settings.replyTo || undefined,
              endpoint,
              timeoutMs,
              fetchImpl,
            });
      cachedFingerprint = fingerprint;
    }
    return cached;
  };

  return {
    get name() {
      return store.get().provider;
    },
    ready,
    async send(email: OutgoingEmail): Promise<SendReceipt> {
      const state = ready();
      if (!state.ok) throw new EmailProviderError(`email provider is not ready: ${state.reason}`, false);
      return current().send(email);
    },
  };
}
