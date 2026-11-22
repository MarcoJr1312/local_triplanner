import { RemoteTripsStore } from './remote.ts';
import type { TripsStore } from './types.ts';

export interface CreateTripsStoreOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * The trips service owns trip data. After the M9.11 decommission there is no
 * local adapter and no `TRIPS_MODE`; the API always calls the service.
 */
export function createTripsStore(options: CreateTripsStoreOptions): TripsStore {
  return new RemoteTripsStore(options);
}

export type { TripsStore } from './types.ts';
