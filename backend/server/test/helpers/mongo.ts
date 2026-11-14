// Shared Mongo fixture for catalogue tests. Retries while the container starts.
// Tests skip when Mongo is unreachable.

import { MongoLocationCatalogue } from '../../src/catalogue/mongo.ts';
import { MONGODB_URL } from '../../src/env.ts';

export async function connectMongo(collectionName: string): Promise<MongoLocationCatalogue | null> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await MongoLocationCatalogue.connect({ url: MONGODB_URL, collectionName });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
}
