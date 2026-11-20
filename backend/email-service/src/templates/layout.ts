// Shared HTML shell. Mirrors the product's dark/violet look without importing
// frontend code: the email service must stay independently deployable.

import type { Language } from '../events.ts';

const FONT_STACK = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BLACK = '#000000';
const CARD_BG = '#0d0d12';
const VIOLET = '#6C3BFF';
const VIOLET_LIGHT = '#8b7bff';
const BORDER = 'rgba(108,59,255,0.35)';
const TEXT_MUTED = '#a1a1aa';
const TEXT_FAINT = '#52525b';

// Minimal compass (lucide style, no emoji) for the wordmark.
const COMPASS_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C3BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:8px;"><circle cx="12" cy="12" r="9" stroke="rgba(108,59,255,0.5)"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5" fill="#6C3BFF" stroke="none"/></svg>';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wordmark(): string {
  return `<span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-0.01em;">${COMPASS_ICON}Triplanner</span>`;
}

export function ctaButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:block;text-align:center;background:${VIOLET};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:14px 20px;border-radius:10px;">${escapeHtml(label)}</a>`;
}

export function linkFallback(href: string, language: Language = 'es'): string {
  const copy =
    language === 'en'
      ? 'If the button does not work, copy this link:'
      : 'Si el botón no funciona, copia este link:';
  return `<p style="margin:20px 0 0;font-size:12px;color:${TEXT_FAINT};text-align:center;line-height:1.5;">
    ${copy}<br />
    <span style="color:${VIOLET_LIGHT};word-break:break-all;">${escapeHtml(href)}</span>
  </p>`;
}

export function layout(bodyHtml: string, language: Language = 'es'): string {
  const footer =
    language === 'en'
      ? 'Triplanner · plan your trips, day by day'
      : 'Triplanner · organiza tus viajes, día a día';
  return `<!DOCTYPE html>
<html lang="${language}">
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
            <p style="margin:0;font-size:11px;color:${TEXT_FAINT};">${footer}</p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const palette = { TEXT_MUTED, VIOLET_LIGHT, VIOLET, BORDER, BLACK, CARD_BG } as const;
