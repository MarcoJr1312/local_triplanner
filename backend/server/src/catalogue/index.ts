// Catalogue factory. MongoDB is the only location store in the local runner.

import { MONGODB_URL } from '../env.ts';
import { MongoLocationCatalogue } from './mongo.ts';

export * from './types.ts';
export { MongoLocationCatalogue, DEFAULT_MONGO_URL, DEFAULT_COLLECTION } from './mongo.ts';

export async function createCatalogue(): Promise<MongoLocationCatalogue> {
  return MongoLocationCatalogue.connect({ url: MONGODB_URL });
}
