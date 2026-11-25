// Locations service gRPC listener. It wraps the catalogue service (MongoDB +
// optional HasData cache) behind the internal contract used by the API.

import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import type { LocationRow } from '../catalogue/types.ts';
import { observeGrpcRequest } from '../metrics.ts';

const PROTO_PATH =
  process.env.PROTO_PATH ??
  fileURLToPath(
    new URL('../../../../proto/triplanner/locations/v1/locations.proto', import.meta.url),
  );
const HEALTH_PROTO_PATH =
  process.env.HEALTH_PROTO_PATH ??
  fileURLToPath(new URL('../../../../proto/grpc/health/v1/health.proto', import.meta.url));

export interface LocationsGrpcCatalogue {
  getById(id: string): Promise<LocationRow | null>;
  getByPlaceId(placeId: string): Promise<LocationRow | null>;
  getByDataId(dataId: string): Promise<LocationRow | null>;
  search(
    q: string,
    options?: { lat?: number | null; lng?: number | null; limit?: number },
  ): Promise<LocationRow[]>;
  listDestinations(): Promise<LocationRow[]>;
  listByParent(parentId: string, limit?: number): Promise<LocationRow[]>;
  listPlaces(): Promise<LocationRow[]>;
}

class GrpcFailure extends Error {
  constructor(
    readonly status: grpc.status,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

function asServiceError(error: unknown): grpc.ServiceError {
  const failure =
    error instanceof GrpcFailure
      ? error
      : new GrpcFailure(grpc.status.UNAVAILABLE, 'UNAVAILABLE', 'Catalogue unavailable');
  const metadata = new grpc.Metadata();
  metadata.set('x-error-code', failure.reason);
  const serviceError = new Error(failure.message) as grpc.ServiceError;
  serviceError.code = failure.status;
  serviceError.metadata = metadata;
  return serviceError;
}

function requireToken(call: grpc.ServerUnaryCall<unknown, unknown>, expected: string): void {
  const values = call.metadata.get('x-internal-token');
  const provided = Array.isArray(values) ? String(values[0] ?? '') : '';
  if (!expected || provided !== expected) {
    throw new GrpcFailure(grpc.status.UNAUTHENTICATED, 'UNAUTHORIZED', 'Token interno inválido.');
  }
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

function iso(value: string | Date | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function toLocation(row: LocationRow) {
  return {
    id: row.id,
    source: optional(row.source),
    place_id: optional(row.place_id),
    data_id: optional(row.data_id),
    slug: optional(row.slug),
    name: row.name,
    category: optional(row.category),
    raw_type: optional(row.raw_type),
    country: optional(row.country),
    description: optional(row.description),
    lat: optional(row.lat),
    lng: optional(row.lng),
    address: optional(row.address),
    rating: optional(row.rating),
    rating_count: optional(row.rating_count),
    hours_json: optional(row.hours_json),
    website_url: optional(row.website_url),
    social_links_json: optional(row.social_links_json),
    phone: optional(row.phone),
    price_level: optional(row.price_level),
    image_url: optional(row.image_url),
    cost: optional(row.cost),
    tags_json: optional(row.tags_json),
    duration_hours: optional(row.duration_hours),
    parent_id: optional(row.parent_id),
    last_updated: optional(row.last_updated),
    version: Number(row.version ?? 0),
    content_hash: String(row.content_hash ?? ''),
    created_at: optional(row.created_at),
    expires_at: iso(row.expires_at),
  };
}

function requireItem(row: LocationRow | null): LocationRow {
  if (!row) throw new GrpcFailure(grpc.status.NOT_FOUND, 'NOT_FOUND', 'Location not found');
  return row;
}

type UnaryHandler = (
  call: grpc.ServerUnaryCall<any, any>,
  callback: grpc.sendUnaryData<any>,
) => void | Promise<void>;

function grpcStatusName(code: grpc.status): string {
  return grpc.status[code] ?? 'UNKNOWN';
}

// Wraps every unary handler so successful and failed RPCs share one metric path.
function instrumentHandlers(
  handlers: Record<string, UnaryHandler>,
): Record<string, UnaryHandler> {
  return Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      (call, callback) => {
        const started = performance.now();
        let settled = false;
        const finish: grpc.sendUnaryData<any> = (error, value) => {
          if (settled) return;
          settled = true;
          observeGrpcRequest({
            method,
            status: grpcStatusName(error?.code ?? grpc.status.OK),
            durationSeconds: (performance.now() - started) / 1000,
          });
          callback(error, value);
        };
        try {
          const result = handler(call, finish);
          if (result && typeof result.then === 'function') {
            result.catch((error: unknown) => finish(error as grpc.ServiceError));
          }
        } catch (error) {
          finish(error as grpc.ServiceError);
        }
      },
    ]),
  );
}

export interface LocationsGrpcOptions {
  catalogue: LocationsGrpcCatalogue;
  port: number;
  internalToken: string;
}

export interface LocationsGrpcHandle {
  server: grpc.Server;
  stop: () => Promise<void>;
}

export async function startLocationsGrpcServer(
  options: LocationsGrpcOptions,
): Promise<LocationsGrpcHandle> {
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  const descriptor = proto.triplanner.locations.v1.LocationsService;
  const catalogue = options.catalogue;

  const guard = (call: grpc.ServerUnaryCall<any, any>): void => {
    requireToken(call, options.internalToken);
  };

  const server = new grpc.Server();
  const healthDefinition = loader.loadSync(HEALTH_PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const healthProto = grpc.loadPackageDefinition(healthDefinition) as any;
  server.addService(healthProto.grpc.health.v1.Health.service, {
    Check: (_call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      callback(null, { status: 'SERVING' });
    },
  });
  const handlers: Record<string, UnaryHandler> = {
    GetById: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        guard(call);
        callback(null, { item: toLocation(requireItem(await catalogue.getById(call.request.id))) });
      } catch (error) {
        callback(asServiceError(error));
      }
    },
    GetByPlaceId: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        guard(call);
        callback(null, {
          item: toLocation(requireItem(await catalogue.getByPlaceId(call.request.place_id))),
        });
      } catch (error) {
        callback(asServiceError(error));
      }
    },
    GetByDataId: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        guard(call);
        callback(null, {
          item: toLocation(requireItem(await catalogue.getByDataId(call.request.data_id))),
        });
      } catch (error) {
        callback(asServiceError(error));
      }
    },
    Search: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        guard(call);
        const request = call.request;
        if ((request.lat === undefined) !== (request.lng === undefined)) {
          throw new GrpcFailure(
            grpc.status.INVALID_ARGUMENT,
            'INVALID_ARGUMENT',
            'lat and lng must be provided together',
          );
        }
        const items = await catalogue.search(request.q ?? '', {
          lat: request.lat ?? null,
          lng: request.lng ?? null,
          limit: request.limit > 0 ? request.limit : 20,
        });
        callback(null, { items: items.map(toLocation) });
      } catch (error) {
        callback(asServiceError(error));
      }
    },
    ListDestinations: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        guard(call);
        const items = await catalogue.listDestinations();
        callback(null, { items: items.map(toLocation) });
      } catch (error) {
        callback(asServiceError(error));
      }
    },
    ListByParent: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        guard(call);
        const limit = call.request.limit > 0 ? Math.min(call.request.limit, 200) : 50;
        const items = await catalogue.listByParent(call.request.parent_id, 200);
        callback(null, { items: items.slice(0, limit).map(toLocation) });
      } catch (error) {
        callback(asServiceError(error));
      }
    },
    ListPlaces: async (
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ) => {
      try {
        guard(call);
        const items = await catalogue.listPlaces();
        callback(null, { items: items.map(toLocation) });
      } catch (error) {
        callback(asServiceError(error));
      }
    },
  };
  server.addService(descriptor.service, instrumentHandlers(handlers));

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${options.port}`,
      grpc.ServerCredentials.createInsecure(),
      (error) => (error ? reject(error) : resolve()),
    );
  });

  return {
    server,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve());
      });
    },
  };
}
