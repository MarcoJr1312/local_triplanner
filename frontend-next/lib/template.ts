// Cliente del agente para el "día plantilla" (M2). El navegador habla con el
// proxy /api/agent/day-plan (rewrite de Next → 127.0.0.1:4100), igual que las
// sugerencias. El agente responde con una lista cronológica de 4-8 paradas.

import { ApiError, getAuthHeaders } from './api';

const DAY_PLAN_ENDPOINT = '/api/agent/day-plan';

// El agente tarda (LLM + RAG); damos el mismo margen que en suggestions sobre
// su propio timeout de 90s. Si aquí se agota, se mapea a DAY_PLAN_FAILED.
const DAY_PLAN_TIMEOUT_MS = 95_000;

export interface DayPlanItem {
  placeId: string;
  title: string;
  category: string;
  cost: number | null;
  startTime: string | null;
}

export interface DayPlan {
  answer: string;
  plan: DayPlanItem[];
}

// Categorías que el itinerario/badges conocen; cualquier otra cae a 'activity'.
const KNOWN_CATEGORIES = new Set([
  'sight',
  'food',
  'activity',
  'nightlife',
  'transporte',
  'alojamiento',
]);

// Normaliza la categoría que devuelve el agente a una que el itinerario pinta.
export function normalizeCategory(category: string): string {
  return KNOWN_CATEGORIES.has(category) ? category : 'activity';
}

// Defensa ante payloads parciales del agente: coacciona cada campo a su tipo y
// descarta entradas sin título.
function normalizeItem(raw: unknown): DayPlanItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const title = typeof item.title === 'string' ? item.title : '';
  if (title === '') return null;
  return {
    placeId: typeof item.placeId === 'string' ? item.placeId : '',
    title,
    category: typeof item.category === 'string' ? item.category : '',
    cost: typeof item.cost === 'number' ? item.cost : null,
    startTime: typeof item.startTime === 'string' ? item.startTime : null,
  };
}

interface DayPlanErrorBody {
  error?: { code?: string; message?: string };
}

// Pide al agente un día plantilla para el viaje. Lanza ApiError con code
// 'DAY_PLAN_FAILED' ante timeout, error de red o respuesta inválida.
export async function requestDayPlan(tripId: string, locale: string): Promise<DayPlan> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DAY_PLAN_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders()),
    };

    let res: Response;
    try {
      res = await fetch(DAY_PLAN_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripId, locale }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new ApiError('El agente tardó demasiado en responder.', { code: 'DAY_PLAN_FAILED' });
      }
      throw new ApiError('No se pudo conectar con el agente.', { code: 'DAY_PLAN_FAILED' });
    }

    const json = (await res.json().catch(() => null)) as
      | ({ answer?: string; plan?: unknown } & DayPlanErrorBody)
      | null;

    if (res.ok && json && Array.isArray(json.plan)) {
      const plan = json.plan
        .map(normalizeItem)
        .filter((item): item is DayPlanItem => item !== null);
      return { answer: typeof json.answer === 'string' ? json.answer : '', plan };
    }

    throw new ApiError(json?.error?.message ?? 'El agente no pudo armar el plan.', {
      code: 'DAY_PLAN_FAILED',
    });
  } finally {
    clearTimeout(timer);
  }
}
