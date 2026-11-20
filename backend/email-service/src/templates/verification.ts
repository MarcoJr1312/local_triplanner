import type { VerificationPayload } from '../events.ts';
import { ctaButton, escapeHtml, layout, linkFallback, palette } from './layout.ts';
import type { RenderedEmail } from './types.ts';

export function renderVerification(payload: VerificationPayload): RenderedEmail {
  const en = payload.language === 'en';
  const name = payload.name?.trim();
  const greeting = name
    ? `<p style="margin:24px 0 0;font-size:15px;font-weight:600;color:#ffffff;">${en ? 'Hi' : 'Hola'}, ${escapeHtml(name)}:</p>`
    : '';

  const html = layout(
    `
    ${greeting}
    <h1 style="margin:${name ? '8px' : '24px'} 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${
      en ? 'Confirm your email' : 'Confirma tu email'
    }</h1>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:${palette.TEXT_MUTED};">
      ${
        en
          ? 'Press the button to verify your address and activate your Triplanner account.'
          : 'Pulsa el botón para verificar tu dirección y activar tu cuenta de Triplanner.'
      }
    </p>
    ${ctaButton(payload.link, en ? 'Verify my email' : 'Verificar mi email')}
    ${linkFallback(payload.link, en ? 'en' : 'es')}
  `,
    en ? 'en' : 'es',
  );

  const text = [
    name
      ? `${en ? `Hi, ${name}` : `Hola, ${name}`}:\n`
      : '',
    en
      ? 'Confirm your email to activate your Triplanner account:'
      : 'Confirma tu email para activar tu cuenta de Triplanner:',
    '',
    payload.link,
  ].join('\n');

  return {
    subject: en ? 'Confirm your email on Triplanner' : 'Confirma tu email en Triplanner',
    html,
    text,
  };
}
