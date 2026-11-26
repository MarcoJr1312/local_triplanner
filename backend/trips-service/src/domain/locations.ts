// Read-only client for the locations service. Trips calls it for destination
// and place snapshots. A failure degrades to the client text and never blocks
// a trip write.

import type { Config } from '../env.ts';

export interface LocationSnapshot {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface LocationsClient {
  getById(id: string): Promise<LocationSnapshot | null>;
}

export class LocationsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationsUnavailableError';
  }
}

interface LocationItem {
  id?: unknown;
  name?: unknown;
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
}

export function createLocationsClient(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): LocationsClient {
  const root = config.locations.url;

  return {
    async getById(id: string): Promise<LocationSnapshot | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.locations.timeoutMs);

      try {
        let response: Response;
        try {
          response = await fetchImpl(
            `${root}/internal/v1/locations/${encodeURIComponent(id)}`,
            {
              method: 'GET',
              headers: { 'x-internal-token': config.internalToken },
              signal: controller.signal,
            },
          );
        } catch (error) {
          const timedOut = error instanceof Error && error.name === 'AbortError';
          throw new LocationsUnavailableError(
            timedOut ? 'locations request timed out' : 'locations is unreachable',
          );
        }

        if (response.status === 404) return null;
        if (!response.ok) {
          throw new LocationsUnavailableError(`locations HTTP ${response.status}`);
        }

        const body = (await response.json()) as { item?: LocationItem };
        const item = body.item;
        if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') {
          throw new LocationsUnavailableError('locations returned an invalid item');
        }

        return {
          id: item.id,
          name: item.name,
          address: typeof item.address === 'string' ? item.address : null,
          lat: typeof item.lat === 'number' ? item.lat : null,
          lng: typeof item.lng === 'number' ? item.lng : null,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
