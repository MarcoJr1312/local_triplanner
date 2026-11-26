import type { ReminderPayload } from '../events.ts';
import { escapeHtml, layout, palette } from './layout.ts';
import type { RenderedEmail } from './types.ts';

export function renderReminder(payload: ReminderPayload): RenderedEmail {
  const en = payload.language === 'en';
  const subject = `${en ? 'Reminder' : 'Recordatorio'}: ${payload.itemTitle}`;

  const html = layout(
    `
    <h1 style="margin:24px 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${
      en ? 'Activity reminder' : 'Recordatorio de actividad'
    }</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${palette.TEXT_MUTED};">
      ${
        en
          ? `Your activity <strong style="color:#ffffff;">${escapeHtml(payload.itemTitle)}</strong> starts soon.`
          : `Tu actividad <strong style="color:#ffffff;">${escapeHtml(payload.itemTitle)}</strong> empieza pronto.`
      }
    </p>
    <div style="background:rgba(108,59,255,0.10);border:1px solid rgba(108,59,255,0.35);border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:11px;color:${palette.VIOLET_LIGHT};text-transform:uppercase;letter-spacing:0.12em;">${
        en ? 'When' : 'Cuándo'
      }</p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;">${escapeHtml(payload.day)} · ${escapeHtml(payload.startTime)}</p>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.6;color:${palette.TEXT_MUTED};">
      ${en ? 'Trip' : 'Viaje'}: <strong style="color:#ffffff;">${escapeHtml(payload.tripName)}</strong>
    </p>
  `,
    en ? 'en' : 'es',
  );

  const text = [
    en ? `Reminder: ${payload.itemTitle}` : `Recordatorio: ${payload.itemTitle}`,
    '',
    en
      ? `Your activity starts on ${payload.day} at ${payload.startTime}.`
      : `Tu actividad empieza el ${payload.day} a las ${payload.startTime}.`,
    `${en ? 'Trip' : 'Viaje'}: ${payload.tripName}`,
  ].join('\n');

  return { subject, html, text };
}
