// Helm gRPC smoke: health plus one real RPC per service through port-forwards.
// Usage (from backend/server):
//   INTERNAL_TOKEN=... bun scripts/grpc-helm-smoke.ts

import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../proto/', import.meta.url);
const token = process.env.INTERNAL_TOKEN ?? 'dev-internal-token';
const demo = '11111111-1111-4111-8111-111111111111';

function load(path: string): any {
  return grpc.loadPackageDefinition(
    loader.loadSync(fileURLToPath(new URL(path, root)), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
    }),
  ) as any;
}

function call(client: any, method: string, request: unknown, actor?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const metadata = new grpc.Metadata();
    metadata.set('x-internal-token', token);
    if (actor) metadata.set('x-actor-id', actor);
    client[method](request, metadata, { deadline: Date.now() + 3000 }, (error: any, value: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function checkHealth(port: number): Promise<string> {
  const healthProto = load('grpc/health/v1/health.proto');
  const client = new healthProto.grpc.health.v1.Health(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure(),
  );
  return new Promise((resolve, reject) => {
    client.Check({ service: '' }, (error: any, value: any) => {
      client.close();
      if (error) reject(error);
      else resolve(value.status);
    });
  });
}

const usersProto = load('triplanner/users/v1/users.proto');
const tripsProto = load('triplanner/trips/v1/trips.proto');
const locationsProto = load('triplanner/locations/v1/locations.proto');

const users = new usersProto.triplanner.users.v1.UsersService(
  '127.0.0.1:50051',
  grpc.credentials.createInsecure(),
);
const trips = new tripsProto.triplanner.trips.v1.TripsService(
  '127.0.0.1:50052',
  grpc.credentials.createInsecure(),
);
const locations = new locationsProto.triplanner.locations.v1.LocationsService(
  '127.0.0.1:50053',
  grpc.credentials.createInsecure(),
);

const health = {
  users: await checkHealth(50051),
  trips: await checkHealth(50052),
  locations: await checkHealth(50053),
};
const user = await call(users, 'GetUser', { user_id: demo });
const tripList = await call(trips, 'ListTrips', {}, demo);
const trip = await call(trips, 'GetTrip', { trip_id: 'demo-trip' }, demo);
const destination = await call(locations, 'GetById', { id: 'toronto' });
const search = await call(locations, 'Search', { q: 'CN Tower', limit: 3 });

console.log(
  JSON.stringify(
    {
      health,
      users: { id: user.user.id, username: user.user.username },
      trips: {
        count: (tripList.items ?? []).length,
        demo: { id: trip.trip.trip.id, items: (trip.trip.items ?? []).length },
      },
      locations: {
        destination: destination.item?.name,
        search: (search.items ?? []).slice(0, 3).map((item: any) => item.name),
      },
    },
    null,
    2,
  ),
);

users.close();
trips.close();
locations.close();
