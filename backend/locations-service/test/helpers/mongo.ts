// Fixture compartido de MongoDB. Los tests se saltan si Mongo no responde.

import { MongoLocationCatalogue } from '../../src/catalogue/mongo.ts';

const URL = process.env.MONGODB_URL ?? 'mongodb://127.0.0.1:27017/triplanner';

export async function connectMongo(collectionName: string): Promise<MongoLocationCatalogue | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await MongoLocationCatalogue.connect({ url: URL, collectionName });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
}
