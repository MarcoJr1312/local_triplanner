import type { AppConfig } from '../config.ts';
import type { Logger } from '../logger.ts';
import { createResendProvider } from './resend.ts';
import { createSinkProvider } from './sink.ts';
import type { EmailProvider } from './types.ts';

export function createEmailProvider(config: AppConfig['email'], logger: Logger): EmailProvider {
  if (config.provider === 'sink') {
    logger.warn('email.provider.sink', {
      message: 'EMAIL_PROVIDER=sink: messages are logged and dropped',
    });
    return createSinkProvider(logger);
  }

  return createResendProvider({
    apiKey: config.resendApiKey ?? '',
    from: config.from,
    replyTo: config.replyTo,
    endpoint: config.resendEndpoint,
    timeoutMs: config.timeoutMs,
  });
}

export type { EmailProvider } from './types.ts';
export { EmailProviderError } from './types.ts';
