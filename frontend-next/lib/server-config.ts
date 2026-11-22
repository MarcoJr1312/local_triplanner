// Server-side runtime configuration for the Next proxies and probes. Every
// value is read at request time so the same image works in Compose, Helm and
// local development.

export type RuntimeEnv = Record<string, string | undefined>;

function trim(value: string | undefined): string {
  return (value ?? '').trim();
}

export function backendGraphqlUrl(env: RuntimeEnv = process.env): string {
  return (trim(env.NEXT_PRIVATE_BACKEND_URL) || 'http://127.0.0.1:4000/graphql').replace(
    /\/+$/,
    '',
  );
}

export function backendOrigin(env: RuntimeEnv = process.env): string {
  const explicit = trim(env.NEXT_PRIVATE_BACKEND_ORIGIN);
  if (explicit) return explicit.replace(/\/+$/, '');

  const graphql = trim(env.NEXT_PRIVATE_BACKEND_URL);
  if (graphql) return graphql.replace(/\/graphql\/?$/, '').replace(/\/+$/, '');

  return 'http://127.0.0.1:4000';
}

export function agentOrigin(env: RuntimeEnv = process.env): string {
  return (trim(env.NEXT_PRIVATE_AGENT_URL) || 'http://127.0.0.1:4100').replace(
    /\/+$/,
    '',
  );
}

/** Variables the Helm/Compose deployment must provide. */
export function missingRuntimeConfig(env: RuntimeEnv = process.env): string[] {
  const missing: string[] = [];
  if (!trim(env.NEXT_PRIVATE_BACKEND_URL)) missing.push('NEXT_PRIVATE_BACKEND_URL');
  if (!trim(env.NEXT_PRIVATE_AGENT_URL)) missing.push('NEXT_PRIVATE_AGENT_URL');
  return missing;
}
