// Carga de configuracion del entorno local.
// HASDATA_API_KEY se lee SOLO desde process.env (nunca se imprime ni se loguea).

import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

try {
  process.loadEnvFile(ENV_PATH);
} catch {
  // .env opcional: la key tambien puede venir del entorno del proceso
}

export const HASDATA_API_KEY = process.env.HASDATA_API_KEY === 'unset' ? '' : (process.env.HASDATA_API_KEY ?? '');
export const hasHasDataKey = () => HASDATA_API_KEY.length > 0;

// ---- Resend (emails de invitacion) ----
export const RESEND_API_KEY = process.env.RESEND_API_KEY === 'unset' ? '' : (process.env.RESEND_API_KEY ?? '');
// Free tier: 'Triplanner <onboarding@resend.dev>' solo envia al email verificado
// de la cuenta; con dominio verificado se cambia por 'Triplanner <viajes@tudominio>'.
export const RESEND_FROM = process.env.RESEND_FROM ?? 'Triplanner <onboarding@resend.dev>';
// Base publica del frontend para los links magicos (server-side, no NEXT_PUBLIC).
export const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export const PORT = Number(process.env.LOCAL_PORT ?? 4000);

// ---- Servicio agente (FastAPI, :4100) ----
// Base para llamadas backend -> agente (p. ej. sync de intereses). En dev el
// agente corre en 127.0.0.1:4100 (ver local/agent-service/README.md).
export const AGENT_BASE_URL = (process.env.AGENT_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '');

// ---- Token interno (endpoints REST /internal/*) ----
// Lo consumen agentes internos (ej. el agente de sugerencias Python M3). En dev
// sin configurar usa un default seguro; en produccion DEBE venir de env.
// NUNCA se imprime ni se loguea.
export const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? 'dev-internal-token';

// Indica si se esta usando el default de desarrollo (para emitir warning al boot).
export function isUsingDefaultInternalToken(): boolean {
  return !process.env.INTERNAL_TOKEN;
}

// Validacion en tiempo constante del header X-Internal-Token.
export function verifyInternalToken(provided: string | null | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---- Firebase Auth (IdP) ----
// La verificacion de ID tokens (M1) solo necesita el project id: la firma RS256
// se valida contra las claves publicas de Google (JWKS), sin secretos nuevos.
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? '';
// Config web publica del proyecto (la usa el frontend); el backend NO la usa para
// verificar firmas, pero se carga/valida junto al resto de la config Firebase.
export const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY ?? '';
// Service account (Admin SDK) para generar links de verificacion SIN enviar email.
// Default: firebase-service-account.json en local/ (misma resolucion que db.ts).
// Un valor relativo se resuelve contra local/ (no contra el cwd del proceso).
function resolveServiceAccountPath(): string {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!raw) return path.resolve(__dirname, '..', '..', 'firebase-service-account.json');
  return path.isAbsolute(raw) ? raw : path.resolve(__dirname, '..', '..', raw);
}
export const FIREBASE_SERVICE_ACCOUNT_PATH = resolveServiceAccountPath();

// ---- Modo local-only ----
// LOCAL_ONLY=1 permite arrancar el backend sin Firebase (auth demo via x-user-id).
// No usar en produccion. Si hay config Firebase y llega un Bearer, se sigue
// verificando el token con jose; el flag solo relaja el arranque.
export const LOCAL_ONLY = ['1', 'true', 'yes', 'on'].includes(
  (process.env.LOCAL_ONLY ?? '').toLowerCase(),
);

// Local-only bootstrapping (schema + DynamoDB table). It is implicit in
// LOCAL_ONLY, but ECS sets BOOTSTRAP_LOCAL=0: the demo still uses LOCAL_ONLY=1
// for x-user-id auth while Terraform owns the infrastructure.
export const BOOTSTRAP_LOCAL =
  process.env.BOOTSTRAP_LOCAL !== undefined
    ? ['1', 'true', 'yes', 'on'].includes(process.env.BOOTSTRAP_LOCAL.toLowerCase())
    : LOCAL_ONLY;

// Valida la config Firebase al arranque. Nunca imprime valores.
export function assertFirebaseEnv(): void {
  const missing: string[] = [];
  if (!FIREBASE_PROJECT_ID) missing.push('FIREBASE_PROJECT_ID');
  if (!FIREBASE_WEB_API_KEY) missing.push('FIREBASE_WEB_API_KEY');
  if (!existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
    missing.push(`FIREBASE_SERVICE_ACCOUNT_PATH (${FIREBASE_SERVICE_ACCOUNT_PATH})`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Config Firebase incompleta: faltan ${missing.join(', ')} en local/.env (ver local/.env.example)`,
    );
  }
}

// ---- Adjuntos: secreto de firma de URLs (HMAC) ----
// En dev sin definir usa un default documentado; en produccion DEBE venir de env.
// NUNCA se imprime ni se loguea.
export const ATTACHMENT_TOKEN_SECRET = process.env.ATTACHMENT_TOKEN_SECRET || 'dev-attachment-secret';
