import { GrpcUsersStore } from './grpc.ts';
import { RemoteUsersStore } from './remote.ts';
import type { UsersStore } from './types.ts';

export interface CreateUsersStoreOptions {
  baseUrl: string;
  grpcUrl?: string;
  transport?: 'http' | 'grpc';
  internalToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * The users service owns accounts and notifications after the M10.13
 * decommission; there is no local adapter and no USERS_MODE. During M15 the
 * HTTP adapter remains the default and the gRPC adapter is selected by
 * USERS_TRANSPORT=grpc.
 */
export function createUsersStore(options: CreateUsersStoreOptions): UsersStore {
  if (options.transport === 'grpc') {
    return new GrpcUsersStore({
      baseUrl: options.grpcUrl ?? '127.0.0.1:50051',
      internalToken: options.internalToken,
      timeoutMs: options.timeoutMs,
    });
  }
  return new RemoteUsersStore(options);
}

export type { UsersStore } from './types.ts';
