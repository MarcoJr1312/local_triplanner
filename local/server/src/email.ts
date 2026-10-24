// Envio de emails con Resend (https://resend.com) via fetch directo (sin SDK).
// - La key vive SOLO en el entorno del server (local/.env); nunca se loguea.
// - Plantillas HTML en espanol con el look de la app (login): fondo NEGRO
//   dominante, acentos violeta #6C3BFF, card con borde violeta sutil.
// - Sin emojis (regla del design system): wordmark con icono SVG brújula.

import { RESEND_FROM, APP_URL } from './env.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// La key se lee en tiempo de llamada (no al import) para que los tests puedan
// inyectarla via process.env tras cargar el modulo.
function getResendKey(): string {
  return process.env.RESEND_API_KEY ?? '';
}

export function hasResendKey(): boolean {
  return getResendKey().length > 0;
}

export interface InviteEmailInput {
  to: string;
  tripName: string;
  ownerName: string;
  code: string;
  joinUrl: string;
  // Rol con el que se incorpora el invitado ('editor' | 'viewer'). Opcional por
  // compatibilidad: por defecto 'viewer'.
  role?: string;
}

export interface SendEmailResult {
  id: string;
  from: string;
  to: string;
}

// URL publica del link magico: APP_URL (server-side) + /join?trip=<id>&code=<code>.
export function buildJoinUrl(tripId: string, code: string): string {
  const base = APP_URL.replace(/\/+$/, '');
  const params = new URLSearchParams({ trip: tripId, code });
  return `${base}/join?${params.toString()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---- Look compartido (espejo del /login de la app) ----

const FONT_STACK = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BLACK = '#000000';
const CARD_BG = '#0d0d12';
const VIOLET = '#6C3BFF';
const VIOLET_LIGHT = '#8b7bff';
const BORDER = 'rgba(108,59,255,0.35)';
const TEXT_MUTED = '#a1a1aa';
const TEXT_FAINT = '#52525b';

// Brújula minimalista (estilo lucide, sin emojis) para el wordmark.
const COMPASS_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C3BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:8px;"><circle cx="12" cy="12" r="9" stroke="rgba(108,59,255,0.5)"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5" fill="#6C3BFF" stroke="none"/></svg>';

function wordmark(): string {
  return `<span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-0.01em;">${COMPASS_ICON}Triplanner</span>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:block;text-align:center;background:${VIOLET};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:14px 20px;border-radius:10px;">${escapeHtml(label)}</a>`;
}

function linkFallback(href: string): string {
  return `<p style="margin:20px 0 0;font-size:12px;color:${TEXT_FAINT};text-align:center;line-height:1.5;">
    Si el botón no funciona, copia este link:<br />
    <span style="color:${VIOLET_LIGHT};word-break:break-all;">${escapeHtml(href)}</span>
  </p>`;
}

// Layout base: fondo negro con acento violeta en la esquina, card oscura.
function layout(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${BLACK};font-family:${FONT_STACK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#000000 55%,#140a2e 100%);">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <tr><td style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:16px;padding:36px 32px;box-shadow:0 8px 40px rgba(108,59,255,0.18);">
            ${wordmark()}
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:20px 8px 0;text-align:center;">
            <p style="margin:0;font-size:11px;color:${TEXT_FAINT};">Triplanner · organiza tus viajes, día a día</p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---- Invitación ----

// Línea de rol mostrada en el email, en español y consistente con la app.
function inviteRoleLine(role?: string): string {
  return role === 'editor'
    ? 'Rol: Editor — puede editar el itinerario e invitar'
    : 'Rol: Lector — solo lectura';
}

export function inviteEmailHtml({ tripName, ownerName, code, joinUrl, role }: Omit<InviteEmailInput, 'to'>): string {
  return layout(`
    <h1 style="margin:24px 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${escapeHtml(ownerName)} te invita a un viaje</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${TEXT_MUTED};">
      Te han invitado a colaborar en <strong style="color:#ffffff;">${escapeHtml(tripName)}</strong>.
      Abre el link y quedarás añadido automáticamente, o usa el código en la app.
    </p>
    <p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:${TEXT_MUTED};">
      ${escapeHtml(inviteRoleLine(role))}
    </p>
    <div style="background:rgba(108,59,255,0.10);border:1px solid rgba(108,59,255,0.35);border-radius:12px;padding:16px;margin-bottom:22px;text-align:center;">
      <p style="margin:0 0 6px;font-size:11px;color:${VIOLET_LIGHT};text-transform:uppercase;letter-spacing:0.12em;">Tu código</p>
      <p style="margin:0;font-size:24px;font-weight:800;letter-spacing:0.2em;color:#ffffff;">${escapeHtml(code)}</p>
    </div>
    ${ctaButton(joinUrl, 'Unirme al viaje')}
    ${linkFallback(joinUrl)}
  `);
}

export function inviteEmailText({ tripName, ownerName, code, joinUrl, role }: Omit<InviteEmailInput, 'to'>): string {
  return [
    `${ownerName} te invita a un viaje en Triplanner: ${tripName}`,
    '',
    inviteRoleLine(role),
    '',
    `Tu código de invitación: ${code}`,
    '',
    `Únete aquí: ${joinUrl}`,
  ].join('\n');
}

// ---- Bienvenida ----

export function welcomeEmailHtml(name: string): string {
  return layout(`
    <h1 style="margin:24px 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">¡Bienvenido/a, ${escapeHtml(name)}!</h1>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:${TEXT_MUTED};">
      Tu cuenta de Triplanner ya está lista. Organiza tus viajes, invita a quien quieras
      y planead juntos las actividades día a día.
    </p>
    ${ctaButton(APP_URL, 'Empezar a planear')}
  `);
}

export function welcomeEmailText(name: string): string {
  return [
    `¡Bienvenido/a a Triplanner, ${name}!`,
    '',
    'Tu cuenta ya está lista. Empieza a planear tus viajes:',
    APP_URL,
  ].join('\n');
}

export async function sendWelcomeEmail(to: string, name: string): Promise<SendEmailResult> {
  return postResend({
    to,
    subject: 'Bienvenido/a a Triplanner',
    html: welcomeEmailHtml(name),
    text: welcomeEmailText(name),
  });
}

// ---- Recordatorio de actividad ----

export interface ReminderEmailInput {
  to: string;
  // Idioma del destinatario (users.language): 'en' -> inglés; resto -> español.
  language: string | null;
  tripName: string;
  itemTitle: string;
  day: string;
  startTime: string;
}

export function reminderEmailHtml({
  language,
  tripName,
  itemTitle,
  day,
  startTime,
}: Omit<ReminderEmailInput, 'to'>): string {
  const en = language === 'en';
  return layout(`
    <h1 style="margin:24px 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${
      en ? 'Activity reminder' : 'Recordatorio de actividad'
    }</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${TEXT_MUTED};">
      ${
        en
          ? `Your activity <strong style="color:#ffffff;">${escapeHtml(itemTitle)}</strong> starts soon.`
          : `Tu actividad <strong style="color:#ffffff;">${escapeHtml(itemTitle)}</strong> empieza pronto.`
      }
    </p>
    <div style="background:rgba(108,59,255,0.10);border:1px solid rgba(108,59,255,0.35);border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:11px;color:${VIOLET_LIGHT};text-transform:uppercase;letter-spacing:0.12em;">${
        en ? 'When' : 'Cuándo'
      }</p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;">${escapeHtml(day)} · ${escapeHtml(startTime)}</p>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.6;color:${TEXT_MUTED};">
      ${en ? 'Trip' : 'Viaje'}: <strong style="color:#ffffff;">${escapeHtml(tripName)}</strong>
    </p>
  `);
}

export function reminderEmailText({
  language,
  tripName,
  itemTitle,
  day,
  startTime,
}: Omit<ReminderEmailInput, 'to'>): string {
  const en = language === 'en';
  return [
    en ? `Reminder: ${itemTitle}` : `Recordatorio: ${itemTitle}`,
    '',
    en ? `Your activity starts on ${day} at ${startTime}.` : `Tu actividad empieza el ${day} a las ${startTime}.`,
    `${en ? 'Trip' : 'Viaje'}: ${tripName}`,
  ].join('\n');
}

export async function sendReminderEmail(input: ReminderEmailInput): Promise<SendEmailResult> {
  const en = input.language === 'en';
  return postResend({
    to: input.to,
    subject: `${en ? 'Reminder' : 'Recordatorio'}: ${input.itemTitle}`,
    html: reminderEmailHtml(input),
    text: reminderEmailText(input),
  });
}

// ---- Verificación de email ----

export function verificationEmailHtml(link: string, name?: string): string {
  const trimmed = name?.trim();
  const greeting = trimmed
    ? `<p style="margin:24px 0 0;font-size:15px;font-weight:600;color:#ffffff;">Hola, ${escapeHtml(trimmed)}:</p>`
    : '';
  return layout(`
    ${greeting}
    <h1 style="margin:${trimmed ? '8px' : '24px'} 0 10px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">Confirma tu email</h1>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:${TEXT_MUTED};">
      Pulsa el botón para verificar tu dirección y activar tu cuenta de Triplanner.
    </p>
    ${ctaButton(link, 'Verificar mi email')}
    ${linkFallback(link)}
  `);
}

export function verificationEmailText(link: string, name?: string): string {
  const trimmed = name?.trim();
  const greeting = trimmed ? `Hola, ${trimmed}:\n\n` : '';
  return [`${greeting}Confirma tu email para activar tu cuenta de Triplanner:`, '', link].join('\n');
}

export async function sendVerificationEmail(to: string, link: string, name?: string): Promise<SendEmailResult> {
  return postResend({
    to,
    subject: 'Confirma tu email en Triplanner',
    html: verificationEmailHtml(link, name),
    text: verificationEmailText(link, name),
  });
}

// ---- POST compartido a Resend ----

interface ResendPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// POST a Resend compartido por todos los emails. Lanza Error descriptivo (sin la
// key) si falla. La key se lee en tiempo de llamada.
async function postResend({ to, subject, html, text }: ResendPayload): Promise<SendEmailResult> {
  if (!hasResendKey()) {
    throw new Error('RESEND_API_KEY no configurada en local/.env');
  }
  const payload = { from: RESEND_FROM, to: [to], subject, html, text };

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getResendKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('No se pudo conectar con Resend');
  }
  if (!res.ok) {
    // Incluir el mensaje de Resend (nunca la key ni datos sensibles) para que
    // el usuario sepa el motivo exacto (ej. free tier: solo tu propio email).
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) detail = `: ${body.message}`;
    } catch {
      // body no-JSON: solo el status
    }
    throw new Error(`Resend HTTP ${res.status}${detail}`);
  }
  const data = (await res.json()) as { id?: string };
  return { id: data.id ?? '', from: RESEND_FROM, to };
}

// Envia el email de invitacion. Lanza Error descriptivo (sin la key) si Resend falla.
export async function sendInviteEmail(input: InviteEmailInput): Promise<SendEmailResult> {
  const { to, tripName, ownerName, code, joinUrl, role } = input;
  return postResend({
    to,
    subject: `${ownerName} te invita a "${tripName}" en Triplanner`,
    html: inviteEmailHtml({ tripName, ownerName, code, joinUrl, role }),
    text: inviteEmailText({ tripName, ownerName, code, joinUrl, role }),
  });
}
