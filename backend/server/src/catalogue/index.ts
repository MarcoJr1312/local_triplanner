// Fabrica del catalogo. En modo remoto la API llama al servicio de locations;
// en modo local mantiene el adaptador MongoDB para rollback y tests.

import { INTERNAL_TOKEN, LOCATIONS_MODE, LOCATIONS_TIMEOUT_MS, LOCATIONS_URL, MONGODB_URL } from '../env.ts';
import { MongoLocationCatalogue } from './mongo.ts';
import { RemoteLocationCatalogue } from './remote.ts';
import type { LocationCatalogue } from './types.ts';

export * from './types.ts';
export { MongoLocationCatalogue, DEFAULT_MONGO_URL, DEFAULT_COLLECTION } from './mongo.ts';
export { RemoteLocationCatalogue, CatalogueUnavailableError } from './remote.ts';

export async function createCatalogue(): Promise<LocationCatalogue> {
  if (LOCATIONS_MODE === 'remote') {
    return new RemoteLocationCatalogue({
      baseUrl: LOCATIONS_URL,
      token: INTERNAL_TOKEN,
      timeoutMs: LOCATIONS_TIMEOUT_MS,
    });
  }
  return MongoLocationCatalogue.connect({ url: MONGODB_URL });
}
