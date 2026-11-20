import type { InvitePayload, Language } from '../events.ts';
import { ctaButton, escapeHtml, layout, linkFallback, palette } from './layout.ts';
import type { RenderedEmail } from './types.ts';

function roleLine(role: InvitePayload['role'], language: Language): string {
  if (role === 'editor') {
    return language === 'en'
      ? 'Role: Editor — can edit the itinerary and invite'
      : 'Rol: Editor — puede editar el itinerario e invitar';
  }
  return language === 'en' ? 'Role: Viewer — read only' : 'Rol: Lector — solo lectura';
}

export function renderInvite(payload: InvitePayload): RenderedEmail {
  const language = payload.language ?? 'es';
  const en = language === 'en';
  const subject = en
    ? `${payload.ownerName} invited you to "${payload.tripName}" on Triplanner`
    : `${payload.ownerName} te invita a "${payload.tripName}" en Triplanner`;

  const html = layout(
    `
    <h1 style="margin:24px 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${
      en ? `${escapeHtml(payload.ownerName)} invited you on a trip` : `${escapeHtml(payload.ownerName)} te invita a un viaje`
    }</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${palette.TEXT_MUTED};">
      ${
        en
          ? `You have been invited to collaborate on <strong style="color:#ffffff;">${escapeHtml(payload.tripName)}</strong>. Open the link and you will be added automatically, or use the code in the app.`
          : `Te han invitado a colaborar en <strong style="color:#ffffff;">${escapeHtml(payload.tripName)}</strong>. Abre el link y quedarás añadido automáticamente, o usa el código en la app.`
      }
    </p>
    <p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:${palette.TEXT_MUTED};">
      ${escapeHtml(roleLine(payload.role, language))}
    </p>
    <div style="background:rgba(108,59,255,0.10);border:1px solid rgba(108,59,255,0.35);border-radius:12px;padding:16px;margin-bottom:22px;text-align:center;">
      <p style="margin:0 0 6px;font-size:11px;color:${palette.VIOLET_LIGHT};text-transform:uppercase;letter-spacing:0.12em;">${
        en ? 'Your code' : 'Tu código'
      }</p>
      <p style="margin:0;font-size:24px;font-weight:800;letter-spacing:0.2em;color:#ffffff;">${escapeHtml(payload.code)}</p>
    </div>
    ${ctaButton(payload.joinUrl, en ? 'Join the trip' : 'Unirme al viaje')}
    ${linkFallback(payload.joinUrl, language)}
  `,
    language,
  );

  const text = [
    en
      ? `${payload.ownerName} invited you to a trip on Triplanner: ${payload.tripName}`
      : `${payload.ownerName} te invita a un viaje en Triplanner: ${payload.tripName}`,
    '',
    roleLine(payload.role, language),
    '',
    `${en ? 'Invitation code' : 'Tu código de invitación'}: ${payload.code}`,
    '',
    `${en ? 'Join here' : 'Únete aquí'}: ${payload.joinUrl}`,
  ].join('\n');

  return { subject, html, text };
}
