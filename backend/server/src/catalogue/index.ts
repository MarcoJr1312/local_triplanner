// Fabrica del catalogo. La API ya no abre MongoDB: todos los reads van al
// servicio `triplanner-locations` por HTTP o gRPC interno.

import {
  INTERNAL_TOKEN,
  LOCATIONS_GRPC_URL,
  LOCATIONS_TIMEOUT_MS,
  LOCATIONS_TRANSPORT,
  LOCATIONS_URL,
} from '../env.ts';
import { GrpcLocationCatalogue } from './grpc.ts';
import { RemoteLocationCatalogue } from './remote.ts';
import type { LocationCatalogue } from './types.ts';

export * from './types.ts';
export { RemoteLocationCatalogue, CatalogueUnavailableError } from './remote.ts';
export { GrpcLocationCatalogue } from './grpc.ts';

export async function createCatalogue(): Promise<LocationCatalogue> {
  if (LOCATIONS_TRANSPORT === 'grpc') {
    return new GrpcLocationCatalogue({
      baseUrl: LOCATIONS_GRPC_URL,
      token: INTERNAL_TOKEN,
      timeoutMs: LOCATIONS_TIMEOUT_MS,
    });
  }
  return new RemoteLocationCatalogue({
    baseUrl: LOCATIONS_URL,
    token: INTERNAL_TOKEN,
    timeoutMs: LOCATIONS_TIMEOUT_MS,
  });
}
