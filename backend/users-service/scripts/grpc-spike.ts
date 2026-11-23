import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';

const protoPath = fileURLToPath(
  new URL('../../../proto/triplanner/users/v1/users.proto', import.meta.url),
);
const definition = loader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(definition) as any;
const service = proto.triplanner.users.v1.UsersService;

const server = new grpc.Server();
server.addService(service.service, {
  GetUser: (call: any, callback: any) => {
    callback(null, {
      user: {
        id: call.request.user_id,
        username: 'spike',
        display_name: 'Spike',
        language: 'en',
        created_at: 'now',
      },
    });
  },
});

await new Promise<void>((resolve, reject) => {
  server.bindAsync('127.0.0.1:50059', grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) reject(error);
    else resolve();
  });
});

const client = new service('127.0.0.1:50059', grpc.credentials.createInsecure());
const response = await new Promise<any>((resolve, reject) => {
  client.GetUser({ user_id: 'u1' }, { deadline: Date.now() + 3000 }, (error: any, value: any) => {
    if (error) reject(error);
    else resolve(value);
  });
});
console.log(JSON.stringify(response));
client.close();
server.forceShutdown();
