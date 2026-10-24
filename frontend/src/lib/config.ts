import rawAwsConfig from '../aws-config.json';
import rawLocalConfig from '../local-config.json';

export interface AwsConfig {
  graphqlEndpoint: string;
  realtimeEndpoint: string;
  apiId: string;
  userPoolId: string;
  userPoolClientId: string;
  region: string;
}

export interface LocalConfig {
  graphqlEndpoint: string;
}

export type DataMode = 'local' | 'aws' | 'mock';

const awsConfig = rawAwsConfig as AwsConfig;
const localConfig = rawLocalConfig as LocalConfig;

export function getAwsConfig(): AwsConfig {
  return awsConfig;
}

/**
 * URL del backend local (graphql-yoga). Prioridad de detección:
 *   1. VITE_LOCAL_GRAPHQL (variable de entorno de Vite)
 *   2. src/local-config.json -> graphqlEndpoint
 * Devuelve null cuando no hay backend local configurado.
 */
export function getLocalGraphqlUrl(): string | null {
  const fromEnv =
    typeof import.meta.env.VITE_LOCAL_GRAPHQL === 'string'
      ? import.meta.env.VITE_LOCAL_GRAPHQL.trim()
      : '';
  if (fromEnv) return fromEnv;
  const fromFile = (localConfig?.graphqlEndpoint ?? '').trim();
  if (fromFile) return fromFile;
  return null;
}

export function isAwsConfigured(): boolean {
  const c = getAwsConfig();
  return (
    c.graphqlEndpoint.trim() !== '' ||
    c.realtimeEndpoint.trim() !== '' ||
    c.apiId.trim() !== '' ||
    c.userPoolId.trim() !== '' ||
    c.userPoolClientId.trim() !== ''
  );
}

/**
 * Modo de datos del frontend: local > aws > mock.
 * Por defecto (sin VITE_LOCAL_GRAPHQL ni local-config.json y sin aws-config.json)
 * el modo es mock.
 */
export function getMode(): DataMode {
  if (getLocalGraphqlUrl()) return 'local';
  if (isAwsConfigured()) return 'aws';
  return 'mock';
}

export function isMockMode(): boolean {
  return getMode() === 'mock';
}
