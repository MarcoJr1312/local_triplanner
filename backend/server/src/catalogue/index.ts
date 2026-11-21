// Fabrica del catalogo. La API ya no abre MongoDB: todos los reads van al
// servicio `triplanner-locations` por HTTP interno.

import { INTERNAL_TOKEN, LOCATIONS_TIMEOUT_MS, LOCATIONS_URL } from '../env.ts';
import { RemoteLocationCatalogue } from './remote.ts';
import type { LocationCatalogue } from './types.ts';

export * from './types.ts';
export { RemoteLocationCatalogue, CatalogueUnavailableError } from './remote.ts';

export async function createCatalogue(): Promise<LocationCatalogue> {
  return new RemoteLocationCatalogue({
    baseUrl: LOCATIONS_URL,
    token: INTERNAL_TOKEN,
    timeoutMs: LOCATIONS_TIMEOUT_MS,
  });
}
