// Local/demo provider. It accepts every message and logs metadata only, so the
// Kafka pipeline can be exercised without a Resend key. Never use this in an
// environment where mail must actually arrive.

import { redactEmail } from '../events.ts';
import type { Logger } from '../logger.ts';
import type { EmailProvider, OutgoingEmail, SendReceipt } from './types.ts';

export function createSinkProvider(logger: Logger): EmailProvider {
  return {
    name: 'sink',
    ready: () => ({ ok: true }),
    async send(email: OutgoingEmail): Promise<SendReceipt> {
      logger.warn('email.sink.drop', {
        eventId: email.eventId,
        eventType: email.eventType,
        recipient: redactEmail(email.to),
      });
      return { providerMessageId: `sink/${email.idempotencyKey}` };
    },
  };
}
