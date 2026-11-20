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
    ? `${payload.ownerName} invited you to "${payload.tripName}" · demo`
    : `${payload.ownerName} te invita a "${payload.tripName}" · demo`;

  const html = layout(
    `
    <h1 style="margin:24px 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${
      en ? `You were invited to ${escapeHtml(payload.tripName)}` : `Te invitaron a ${escapeHtml(payload.tripName)}`
    }</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${palette.TEXT_MUTED};">
      ${
        en
          ? `<strong style="color:#ffffff;">${escapeHtml(payload.ownerName)}</strong> invited you to collaborate on this trip. Open the link and you will be added automatically, or use the code in the app.`
          : `<strong style="color:#ffffff;">${escapeHtml(payload.ownerName)}</strong> te invitó a colaborar en este viaje. Abre el link y quedarás añadido automáticamente, o usa el código en la app.`
      }
    </p>
    <div style="background:rgba(108,59,255,0.10);border:1px solid rgba(108,59,255,0.35);border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:12px;line-height:1.55;color:${palette.TEXT_MUTED};">
      ${
        en
          ? '<strong style="color:#ffffff;">Demo invitation.</strong> Triplanner is running with demo users and no real authentication. If you accept, you will appear as a demo member of this trip.'
          : '<strong style="color:#ffffff;">Invitación demo.</strong> Triplanner funciona con usuarios demo y sin autenticación real. Si aceptas, aparecerás como miembro demo de este viaje.'
      }
    </div>
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
    en
      ? 'Demo invitation: Triplanner is running with demo users and no real authentication. If you accept, you will appear as a demo member of this trip.'
      : 'Invitación demo: Triplanner funciona con usuarios demo y sin autenticación real. Si aceptas, aparecerás como miembro demo de este viaje.',
    '',
    roleLine(payload.role, language),
    '',
    `${en ? 'Invitation code' : 'Tu código de invitación'}: ${payload.code}`,
    '',
    `${en ? 'Join here' : 'Únete aquí'}: ${payload.joinUrl}`,
  ].join('\n');

  return { subject, html, text };
}
