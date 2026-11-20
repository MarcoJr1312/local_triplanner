import type { EmailEvent } from '../events.ts';
import { renderInvite } from './invite.ts';
import { renderReminder } from './reminder.ts';
import { renderVerification } from './verification.ts';
import { renderWelcome } from './welcome.ts';
import type { RenderedEmail } from './types.ts';

export type { RenderedEmail } from './types.ts';

export interface RenderOptions {
  appUrl: string;
}

export function renderEmail(event: EmailEvent, { appUrl }: RenderOptions): RenderedEmail {
  switch (event.type) {
    case 'email.invite.v1':
      return renderInvite(event.payload);
    case 'email.reminder.v1':
      return renderReminder(event.payload);
    case 'email.verification.v1':
      return renderVerification(event.payload);
    case 'email.welcome.v1':
      return renderWelcome(event.payload, appUrl);
  }
}
