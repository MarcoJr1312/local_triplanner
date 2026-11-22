import type { AsyncDb } from '../pg/db.ts';
import { LocalUsersStore } from './local.ts';
import { RemoteUsersStore } from './remote.ts';
import type { UsersStore } from './types.ts';

export type UsersMode = 'local' | 'remote';

export interface CreateUsersStoreOptions {
  mode: UsersMode;
  db: AsyncDb;
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * `remote` is the production path (users service); `local` keeps the platform
 * users table for tests and the M10 cutover window only.
 */
export function createUsersStore(options: CreateUsersStoreOptions): UsersStore {
  if (options.mode === 'remote') {
    return new RemoteUsersStore({
      baseUrl: options.baseUrl,
      internalToken: options.internalToken,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }
  return new LocalUsersStore(options.db);
}

export type { UsersStore } from './types.ts';
