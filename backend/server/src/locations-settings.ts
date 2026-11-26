// Client for the locations service BYOK settings. The browser never talks to
// the locations service directly and never receives the HasData key.

import { INTERNAL_TOKEN, LOCATIONS_URL } from './env.ts';

export interface LocationsSettingsGql {
  provider: string;
  hasKey: boolean;
  ready: boolean;
  cachedPlaces: number;
}

export interface UpdateLocationsSettingsInput {
  provider: string;
  apiKey?: string | null;
  clearKey?: boolean | null;
}

export type LocationsSettingsErrorCode = 'LOCATIONS_SETTINGS_FAILED' | 'LOCATIONS_CONFIG_INVALID';

export class LocationsSettingsError extends Error {
  constructor(
    message: string,
    readonly code: LocationsSettingsErrorCode,
  ) {
    super(message);
    this.name = 'LocationsSettingsError';
  }
}

export interface LocationsSettingsClient {
  get(): Promise<LocationsSettingsGql>;
  update(input: UpdateLocationsSettingsInput): Promise<LocationsSettingsGql>;
}

export interface LocationsSettingsClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePublic(value: unknown): LocationsSettingsGql {
  if (!isRecord(value)) {
    throw new LocationsSettingsError(
      'invalid response from the locations service',
      'LOCATIONS_SETTINGS_FAILED',
    );
  }
  if (value.provider !== 'preloaded' && value.provider !== 'hasdata') {
    throw new LocationsSettingsError(
      'invalid provider in locations settings response',
      'LOCATIONS_SETTINGS_FAILED',
    );
  }
  if (
    typeof value.hasKey !== 'boolean' ||
    typeof value.ready !== 'boolean' ||
    typeof value.cachedPlaces !== 'number'
  ) {
    throw new LocationsSettingsError(
      'invalid locations settings response',
      'LOCATIONS_SETTINGS_FAILED',
    );
  }
  return {
    provider: value.provider,
    hasKey: value.hasKey,
    ready: value.ready,
    cachedPlaces: value.cachedPlaces,
  };
}

export function createLocationsSettingsClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 5_000,
}: LocationsSettingsClientOptions): LocationsSettingsClient {
  const root = baseUrl.replace(/\/+$/, '');

  const request = async (path: string, init?: RequestInit): Promise<LocationsSettingsGql> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${root}${path}`, { ...init, signal: controller.signal });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        throw new LocationsSettingsError(
          aborted ? 'locations settings service timed out' : 'locations settings service unavailable',
          'LOCATIONS_SETTINGS_FAILED',
        );
      }

      const text = await response.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }

      if (!response.ok) {
        const detail = isRecord(body) && isRecord(body.error) ? body.error : {};
        const code =
          detail.code === 'LOCATIONS_CONFIG_INVALID'
            ? 'LOCATIONS_CONFIG_INVALID'
            : 'LOCATIONS_SETTINGS_FAILED';
        const message =
          typeof detail.message === 'string'
            ? detail.message.slice(0, 300)
            : `locations service HTTP ${response.status}`;
        throw new LocationsSettingsError(message, code);
      }

      return parsePublic(body);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get: () => request('/api/locations/config'),
    update: (input) =>
      request('/api/locations/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          provider: input.provider,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.clearKey ? { clearKey: true } : {}),
        }),
      }),
  };
}

export const locationsSettingsClient = createLocationsSettingsClient({
  baseUrl: LOCATIONS_URL,
  token: INTERNAL_TOKEN,
});
