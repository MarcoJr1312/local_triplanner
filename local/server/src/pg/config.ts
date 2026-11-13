// Resolves the Postgres connection string for both local and ECS.
//
// Local: DATABASE_URL or the documented default.
// AWS:   DB_SECRET_ARN (RDS-managed master credential) + DB_HOST/DB_PORT/DB_NAME
//        from the task definition. Nothing is logged.

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DEFAULT_DATABASE_URL } from './db.ts';

let cached: string | null = null;

export async function resolveDatabaseUrl(): Promise<string> {
  if (cached) return cached;
  if (process.env.DATABASE_URL) {
    cached = process.env.DATABASE_URL;
    return cached;
  }

  const secretArn = process.env.DB_SECRET_ARN;
  if (!secretArn) {
    cached = DEFAULT_DATABASE_URL;
    return cached;
  }

  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT ?? '5432';
  const database = process.env.DB_NAME ?? 'postgres';
  if (!host) throw new Error('DB_HOST is required when DB_SECRET_ARN is set');

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secret = JSON.parse(response.SecretString ?? '{}') as { username?: string; password?: string };
  if (!secret.username || !secret.password) {
    throw new Error('RDS secret does not contain username/password');
  }

  // rds.force_ssl=1 is set in the Terraform parameter group. `no-verify`
  // keeps the connection encrypted; the demo does not ship the RDS CA bundle.
  cached = `postgres://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${host}:${port}/${database}?sslmode=no-verify`;
  return cached;
}
