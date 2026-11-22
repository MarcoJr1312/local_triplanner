import { RemoteUsersStore } from './remote.ts';
import type { UsersStore } from './types.ts';

export interface CreateUsersStoreOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * The users service owns accounts and notifications after the M10.13
 * decommission; there is no local adapter and no USERS_MODE.
 */
export function createUsersStore(options: CreateUsersStoreOptions): UsersStore {
  return new RemoteUsersStore(options);
}

export type { UsersStore } from './types.ts';
