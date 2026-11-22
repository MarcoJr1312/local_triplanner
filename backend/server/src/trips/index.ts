import type { AsyncDb } from '../pg/db.ts';
import { LocalTripsStore } from './local.ts';
import { RemoteTripsStore } from './remote.ts';
import type { TripsStore } from './types.ts';

export interface CreateTripsStoreOptions {
  mode: 'local' | 'remote';
  db: AsyncDb;
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export function createTripsStore(options: CreateTripsStoreOptions): TripsStore {
  if (options.mode === 'remote') {
    return new RemoteTripsStore({
      baseUrl: options.baseUrl,
      internalToken: options.internalToken,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }
  return new LocalTripsStore(options.db);
}

export type { TripsStore } from './types.ts';
