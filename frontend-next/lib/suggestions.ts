// Cliente del servicio agente (M4). El navegador habla con el proxy
// /api/agent/suggestions (rewrite de Next → 127.0.0.1:4100) y con la fachada
// GraphQL para leer el historial que el agente guarda por su cuenta.

import { ApiError, api, getAuthHeaders } from './api';
import type { SuggestionChat, SuggestionChatMessage } from './types';

const AGENT_ENDPOINT = '/api/agent/suggestions';
const AGENT_CONFIG_ENDPOINT = '/api/agent/config';

export interface AgentConfig {
  provider: string;
  model: string;
  demo: boolean;
}

// Provider status for the AI badge; never fails the panel.
export async function getAgentConfig(): Promise<AgentConfig | null> {
  try {
    const res = await fetch(AGENT_CONFIG_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<AgentConfig>;
    if (typeof json.demo !== 'boolean' || typeof json.provider !== 'string') return null;
    return {
      provider: json.provider,
      model: typeof json.model === 'string' ? json.model : '',
      demo: json.demo,
    };
  } catch {
    return null;
  }
}

// El agente tarda (llamada LLM + RAG); damos margen sobre su propio timeout de
// 90s. Si aquí se agota, se mapea a un AGENT_TIMEOUT local.
const AGENT_TIMEOUT_MS = 95_000;

type AgentErrorCode = 'AGENT_TIMEOUT' | 'AGENT_ERROR' | 'CONTEXT_FORBIDDEN';

interface AgentErrorBody {
  error?: { code?: string; message?: string };
}

// Normaliza los códigos del agente a los que el frontend sabe traducir
// (errors.AGENT_TIMEOUT / AGENT_ERROR / CONTEXT_FORBIDDEN).
function normalizeCode(code: string | undefined): AgentErrorCode {
  if (code === 'AGENT_TIMEOUT' || code === 'CONTEXT_FORBIDDEN') return code;
  return 'AGENT_ERROR';
}

export async function postSuggestion(
  tripId: string,
  day: string,
  messages: SuggestionChatMessage[],
  locale: string,
): Promise<{ answer: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders()),
    };

    let res: Response;
    try {
      res = await fetch(AGENT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripId, day, locale, messages }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ApiError('El agente tardó demasiado en responder.', { code: 'AGENT_TIMEOUT' });
      }
      throw new ApiError('No se pudo conectar con el agente.', { code: 'AGENT_ERROR' });
    }

    const json = (await res.json().catch(() => null)) as
      | ({ answer?: string } & AgentErrorBody)
      | null;

    if (res.ok && json && typeof json.answer === 'string') {
      return { answer: json.answer };
    }

    const code = normalizeCode(json?.error?.code);
    throw new ApiError(json?.error?.message ?? 'El agente no pudo responder.', { code });
  } finally {
    clearTimeout(timer);
  }
}

export async function getSuggestionChats(tripId: string, day: string): Promise<SuggestionChat[]> {
  return api.getSuggestionChats(tripId, day);
}

// Sugerencia accionable que el agente adjunta al final de su respuesta dentro
// del bloque delimitado. Es independiente del tipo `Suggestion` (fallback del
// backend sin IA), que no trae `placeId`.
export interface SuggestionItem {
  placeId: string;
  title: string;
  category: string;
  cost: number;
}

// El agente cierra su respuesta con un bloque ```suggestions ... ``` que
// contiene un array JSON. Capturamos el contenido hasta el cierre, tolerando
// espacios/saltos de línea.
const SUGGESTIONS_BLOCK_RE = /```suggestions\s*([\s\S]*?)```/;

// Extrae las sugerencias accionables del mensaje del asistente. Devuelve []
// cuando no hay bloque, el JSON no es válido o el contenido no es un array.
export function extractSuggestions(content: string): SuggestionItem[] {
  const match = SUGGESTIONS_BLOCK_RE.exec(content);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null)
      .map((raw) => ({
        placeId: typeof raw.placeId === 'string' ? raw.placeId : '',
        title: typeof raw.title === 'string' ? raw.title : '',
        category: typeof raw.category === 'string' ? raw.category : '',
        cost: typeof raw.cost === 'number' ? raw.cost : 0,
      }))
      .filter((item) => item.placeId !== '' && item.title !== '');
  } catch {
    return [];
  }
}

// Devuelve el texto natural del mensaje sin el bloque de sugerencias.
export function stripSuggestionsBlock(content: string): string {
  return content.replace(SUGGESTIONS_BLOCK_RE, '').trim();
}
