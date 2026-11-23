import { GrpcTripsStore } from './grpc.ts';
import { RemoteTripsStore } from './remote.ts';
import type { TripsStore } from './types.ts';

export interface CreateTripsStoreOptions {
  baseUrl: string;
  grpcUrl?: string;
  transport?: 'http' | 'grpc';
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * The trips service owns trip data. After the M9.11 decommission there is no
 * local adapter and no `TRIPS_MODE`; during M15 the HTTP adapter remains the
 * default and the gRPC adapter is selected by TRIPS_TRANSPORT=grpc.
 */
export function createTripsStore(options: CreateTripsStoreOptions): TripsStore {
  if (options.transport === 'grpc') {
    return new GrpcTripsStore({
      baseUrl: options.grpcUrl ?? '127.0.0.1:50052',
      internalToken: options.internalToken,
      timeoutMs: options.timeoutMs,
    });
  }
  return new RemoteTripsStore(options);
}

export type { TripsStore } from './types.ts';
