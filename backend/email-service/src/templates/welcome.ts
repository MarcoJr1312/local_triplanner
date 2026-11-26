import type { WelcomePayload } from '../events.ts';
import { ctaButton, escapeHtml, layout, palette } from './layout.ts';
import type { RenderedEmail } from './types.ts';

export function renderWelcome(payload: WelcomePayload, appUrl: string): RenderedEmail {
  const en = payload.language === 'en';
  const subject = en ? 'Welcome to Triplanner' : 'Bienvenido/a a Triplanner';

  const html = layout(
    `
    <h1 style="margin:24px 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${
      en ? `Welcome, ${escapeHtml(payload.name)}!` : `¡Bienvenido/a, ${escapeHtml(payload.name)}!`
    }</h1>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:${palette.TEXT_MUTED};">
      ${
        en
          ? 'Your Triplanner account is ready. Organize your trips, invite whoever you want and plan activities together, day by day.'
          : 'Tu cuenta de Triplanner ya está lista. Organiza tus viajes, invita a quien quieras y planead juntos las actividades día a día.'
      }
    </p>
    ${ctaButton(appUrl, en ? 'Start planning' : 'Empezar a planear')}
  `,
    en ? 'en' : 'es',
  );

  const text = [
    en ? `Welcome to Triplanner, ${payload.name}!` : `¡Bienvenido/a a Triplanner, ${payload.name}!`,
    '',
    en ? 'Your account is ready. Start planning your trips:' : 'Tu cuenta ya está lista. Empieza a planear tus viajes:',
    appUrl,
  ].join('\n');

  return { subject, html, text };
}
