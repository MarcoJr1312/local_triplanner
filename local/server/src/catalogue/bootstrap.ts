// Creates the local catalogue table with the same shape Terraform provisions:
// pk `id`, GSIs place_id-index / data_id-index, TTL on expires_at.
// Idempotent: safe to run on every dev boot.

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DEFAULT_TABLE, resolveEndpoint } from './dynamo.ts';

export interface EnsureTableOptions {
  tableName?: string;
  endpoint?: string;
  region?: string;
}

export async function ensureTable(options: EnsureTableOptions = {}): Promise<'created' | 'exists'> {
  const endpoint = resolveEndpoint(options.endpoint);
  const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const tableName = options.tableName ?? process.env.DYNAMODB_TABLE ?? DEFAULT_TABLE;

  const client = new DynamoDBClient({
    region,
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  });

  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return 'exists';
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'place_id', AttributeType: 'S' },
        { AttributeName: 'data_id', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'place_id-index',
          KeySchema: [{ AttributeName: 'place_id', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'data_id-index',
          KeySchema: [{ AttributeName: 'data_id', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );

  await waitUntilTableExists({ client, maxWaitTime: 60, minDelay: 1 }, { TableName: tableName });
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
    }),
  );
  return 'created';
}

if (import.meta.main) {
  ensureTable()
    .then((result) => console.log(`catalogue table ${result}`))
    .catch((err) => {
      console.error('catalogue bootstrap failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
