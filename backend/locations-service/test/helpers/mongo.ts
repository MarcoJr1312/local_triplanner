// Fixture de MongoDB. Los tests se saltan si Mongo no responde. Prueba la URL
// explicita, luego sin auth y por ultimo las credenciales demo de Compose.

import { MongoLocationCatalogue } from '../../src/catalogue/mongo.ts';

const host = process.env.MONGODB_HOST ?? '127.0.0.1:27017';
const candidates = [
  process.env.MONGODB_URL,
  `mongodb://${host}/triplanner`,
  `mongodb://${encodeURIComponent(process.env.MONGODB_USERNAME ?? 'triplanner')}:${encodeURIComponent(process.env.MONGODB_PASSWORD ?? 'triplanner')}@${host}/triplanner?authSource=${process.env.MONGODB_AUTH_SOURCE ?? 'admin'}`,
].filter((value): value is string => Boolean(value));

export async function connectMongo(collectionName: string): Promise<MongoLocationCatalogue | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const url of candidates) {
      try {
        return await MongoLocationCatalogue.connect({ url, collectionName });
      } catch {
        // Try the next URL/auth mode.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}
