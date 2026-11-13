export * from './types.ts';
export { DynamoLocationCatalogue, DEFAULT_TABLE, LOCAL_DYNAMO_ENDPOINT } from './dynamo.ts';
export { ensureTable } from './bootstrap.ts';

import { DynamoLocationCatalogue } from './dynamo.ts';
import type { LocationCatalogue } from './types.ts';

export function createCatalogue(): LocationCatalogue {
  return new DynamoLocationCatalogue();
}
