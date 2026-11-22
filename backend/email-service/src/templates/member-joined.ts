import type { MemberJoinedPayload } from '../events.ts';
import { ctaButton, escapeHtml, layout, palette } from './layout.ts';
import type { RenderedEmail } from './types.ts';

export function renderMemberJoined(
  payload: MemberJoinedPayload,
  appUrl: string,
): RenderedEmail {
  const en = payload.language === 'en';
  const member = escapeHtml(payload.memberName);
  const trip = escapeHtml(payload.tripName);
  const owner = escapeHtml(payload.ownerName);

  const subject = en
    ? `${payload.memberName} joined "${payload.tripName}"`
    : `${payload.memberName} se unió a "${payload.tripName}"`;

  const html = layout(
    `
    <p style="margin:22px 0 8px;font-size:13px;color:${palette.TEXT_MUTED};">${
      en ? `Hi ${owner},` : `Hola ${owner},`
    }</p>
    <h1 style="margin:0 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${
      en ? `${member} is on board!` : `¡${member} se ha unido!`
    }</h1>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:${palette.TEXT_MUTED};">${
      en
        ? `${member} accepted your invitation to ${trip}. You can now plan the itinerary together.`
        : `${member} aceptó tu invitación a ${trip}. Ya podéis planear el itinerario juntos.`
    }</p>
    ${ctaButton(appUrl, en ? 'Open the trip' : 'Abrir el viaje')}
  `,
    en ? 'en' : 'es',
  );

  const text = [
    en ? `Hi ${payload.ownerName},` : `Hola ${payload.ownerName},`,
    '',
    en
      ? `${payload.memberName} accepted your invitation to ${payload.tripName}.`
      : `${payload.memberName} aceptó tu invitación a ${payload.tripName}.`,
    '',
    en ? 'Open the trip:' : 'Abre el viaje:',
    appUrl,
  ].join('\n');

  return { subject, html, text };
}
