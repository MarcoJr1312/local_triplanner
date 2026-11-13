// DynamoDB implementation of the location catalogue.
//
// Table (mirrors aws-infra/modules/data): pk `id`, GSIs place_id-index and
// data_id-index, TTL on `expires_at`. There is no FTS: search is a bounded Scan
// with a `contains(name_lower, token)` filter, which is fine at demo scale.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { LocationRow, UpsertLocationInput } from '../schema-types.ts';
import { LOCATION_FIELDS, tokenize, type LocationCatalogue } from './types.ts';

export const LOCAL_DYNAMO_ENDPOINT = 'http://localhost:8000';
export const DEFAULT_TABLE = 'triplanner-locations';
const TTL_DAYS = 30;
const MAX_SCAN_PAGES = 5;

export interface CatalogueOptions {
  tableName?: string;
  endpoint?: string;
  region?: string;
}

export function resolveEndpoint(explicit?: string): string | undefined {
  if (explicit !== undefined) return explicit || undefined;
  if (process.env.DYNAMODB_ENDPOINT !== undefined) return process.env.DYNAMODB_ENDPOINT || undefined;
  // Fargate sets AWS_EXECUTION_ENV; there the SDK must use the regional endpoint.
  if (process.env.AWS_EXECUTION_ENV) return undefined;
  return LOCAL_DYNAMO_ENDPOINT;
}

function buildClient(endpoint: string | undefined, region: string): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    region,
    ...(endpoint
      ? {
          endpoint,
          // DynamoDB Local accepts any credentials; never used in AWS.
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
  return DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
}

function toRow(item: Record<string, unknown> | undefined): LocationRow | null {
  if (!item) return null;
  const row = {} as Record<string, unknown>;
  for (const field of LOCATION_FIELDS) row[field] = item[field] ?? null;
  return row as unknown as LocationRow;
}

export class DynamoLocationCatalogue implements LocationCatalogue {
  private readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;

  constructor(options: CatalogueOptions = {}) {
    const endpoint = resolveEndpoint(options.endpoint);
    const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1';
    this.tableName = options.tableName ?? process.env.DYNAMODB_TABLE ?? DEFAULT_TABLE;
    this.doc = buildClient(endpoint, region);
  }

  async getById(id: string): Promise<LocationRow | null> {
    const out = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { id } }));
    return toRow(out.Item);
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    return this.queryIndex('place_id-index', 'place_id', placeId);
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    return this.queryIndex('data_id-index', 'data_id', dataId);
  }

  private async queryIndex(index: string, key: string, value: string): Promise<LocationRow | null> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: index,
        KeyConditionExpression: '#k = :v',
        ExpressionAttributeNames: { '#k': key },
        ExpressionAttributeValues: { ':v': value },
        Limit: 1,
      }),
    );
    return toRow(out.Items?.[0]);
  }

  async upsert(loc: UpsertLocationInput): Promise<LocationRow> {
    let existing: LocationRow | null = null;
    if (loc.place_id) existing = await this.getByPlaceId(loc.place_id);
    if (!existing && loc.data_id) existing = await this.getByDataId(loc.data_id);

    const id = existing?.id ?? loc.id;
    const now = new Date().toISOString();
    const source = { ...(existing ?? {}), ...loc, id } as Record<string, unknown>;
    source.created_at = existing?.created_at ?? now;
    source.last_updated = loc.last_updated ?? now;
    source.expires_at = Math.floor(Date.now() / 1000) + TTL_DAYS * 86_400;
    source.name_lower = String(source.name ?? '').toLowerCase();

    // DynamoDB rejects NULL as a GSI key value, so absent optional fields must
    // be omitted rather than written as null (place_id/data_id are indexed).
    const item = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== null && value !== undefined));

    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }));
    const row = await this.getById(id);
    if (!row) throw new Error('No se pudo guardar el lugar');
    return row;
  }

  async search(q: string, limit = 20): Promise<LocationRow[]> {
    const tokens = tokenize(q).slice(0, 4);
    if (tokens.length === 0) return [];

    const filters = tokens.map((_, i) => `contains(#name, :t${i})`).join(' AND ');
    const expressionNames: Record<string, string> = { '#name': 'name_lower', '#category': 'category' };
    const expressionValues: Record<string, string> = {};
    tokens.forEach((token, i) => {
      expressionValues[`:t${i}`] = token;
    });

    const items: LocationRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      const out = await this.doc.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: `attribute_exists(#category) AND ${filters}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of out.Items ?? []) {
        const row = toRow(item);
        if (row) items.push(row);
        if (items.length >= 100) break;
      }
      startKey = out.LastEvaluatedKey;
      if (!startKey || items.length >= 100) break;
    }
    return items.slice(0, limit);
  }

  async listDestinations(): Promise<LocationRow[]> {
    return this.scanAll('attribute_exists(#slug)', { '#slug': 'slug' }).then((rows) =>
      rows.sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async listByParent(parentId: string): Promise<LocationRow[]> {
    const rows = await this.scanAll('parent_id = :parent AND attribute_exists(#category)', {
      '#category': 'category',
    }, { ':parent': parentId });
    return rows.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name));
  }

  async listPlaces(): Promise<LocationRow[]> {
    return this.scanAll('attribute_exists(#category)', { '#category': 'category' });
  }

  private async scanAll(
    filter: string,
    names: Record<string, string>,
    values: Record<string, unknown> = {},
  ): Promise<LocationRow[]> {
    const rows: LocationRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      const out = await this.doc.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: filter,
          ExpressionAttributeNames: names,
          ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of out.Items ?? []) {
        const row = toRow(item);
        if (row) rows.push(row);
      }
      startKey = out.LastEvaluatedKey;
      if (!startKey) break;
    }
    return rows;
  }

  async clear(): Promise<void> {
    let startKey: Record<string, unknown> | undefined;
    do {
      const out = await this.doc.send(
        new ScanCommand({
          TableName: this.tableName,
          ProjectionExpression: 'id',
          ExclusiveStartKey: startKey,
        }),
      );
      const keys = (out.Items ?? []).map((item) => ({ id: item.id as string }));
      for (let i = 0; i < keys.length; i += 25) {
        await this.doc.send(
          new BatchWriteCommand({
            RequestItems: { [this.tableName]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) },
          }),
        );
      }
      startKey = out.LastEvaluatedKey;
    } while (startKey);
  }
}
