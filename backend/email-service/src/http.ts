// Internal HTTP surface: liveness/readiness probes plus the BYOK settings API.
// The settings API is ClusterIP-only and the write path is protected by the
// shared INTERNAL_TOKEN, mirroring the agent-service config endpoint.

import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from './logger.ts';
import { EmailSettingsValidationError, type EmailSettingsStore } from './settings.ts';
import { instrumentNodeRequest, renderMetrics } from './metrics.ts';

export interface HealthState {
  ready: boolean;
  provider: string;
  providerReady: boolean;
  brokerReady: boolean;
  reason?: string;
}

export interface HttpHandle {
  port: number;
  close(): Promise<void>;
}

export interface StartHttpServerOptions {
  port: number;
  logger: Logger;
  getState: () => HealthState;
  settings: EmailSettingsStore;
  internalToken: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const MAX_BODY_BYTES = 64 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokenMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new HttpError(413, 'EMAIL_CONFIG_TOO_LARGE', 'request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'EMAIL_CONFIG_INVALID', 'body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function startHttpServer({
  port,
  logger,
  getState,
  settings,
  internalToken,
}: StartHttpServerOptions): Promise<HttpHandle> {
  const startedAt = Date.now();

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/metrics') {
      try {
        const { body, contentType } = await renderMetrics();
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
      } catch (error) {
        logger.error('metrics.render_failed', {
          reason: error instanceof Error ? error.message : 'unknown error',
        });
        json(res, 500, { error: { code: 'METRICS_ERROR', message: 'metrics unavailable' } });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, {
        status: 'ok',
        service: 'triplanner-email-service',
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/ready') {
      const state = getState();
      json(res, state.ready ? 200 : 503, {
        status: state.ready ? 'ready' : 'not_ready',
        provider: state.provider,
        providerReady: state.providerReady,
        brokerReady: state.brokerReady,
        ...(state.reason ? { reason: state.reason } : {}),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/email/config') {
      json(res, 200, settings.public());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/email/config') {
      if (!tokenMatches(req.headers['x-internal-token'], internalToken)) {
        json(res, 401, { error: { code: 'AUTH_INVALID', message: 'invalid internal token' } });
        return;
      }

      try {
        const body = await readJsonBody(req);
        if (!isRecord(body)) {
          throw new HttpError(400, 'EMAIL_CONFIG_INVALID', 'body must be an object');
        }
        if (typeof body.provider !== 'string') {
          throw new HttpError(400, 'EMAIL_CONFIG_INVALID', 'provider must be a string');
        }
        const stringField = (value: unknown, field: string): string | undefined => {
          if (value === undefined || value === null) return undefined;
          if (typeof value !== 'string') {
            throw new HttpError(400, 'EMAIL_CONFIG_INVALID', `${field} must be a string`);
          }
          return value;
        };
        if (body.clearKey !== undefined && typeof body.clearKey !== 'boolean') {
          throw new HttpError(400, 'EMAIL_CONFIG_INVALID', 'clearKey must be a boolean');
        }
        const saved = settings.update({
          provider: body.provider,
          apiKey: stringField(body.apiKey, 'apiKey'),
          from: stringField(body.from, 'from'),
          replyTo: stringField(body.replyTo, 'replyTo'),
          clearKey: body.clearKey === true,
        });
        json(res, 200, saved);
      } catch (error) {
        if (error instanceof HttpError) {
          json(res, error.status, { error: { code: error.code, message: error.message } });
          return;
        }
        if (error instanceof EmailSettingsValidationError) {
          json(res, 400, { error: { code: 'EMAIL_CONFIG_INVALID', message: error.message } });
          return;
        }
        logger.error('email.settings.persist_failed', {
          reason: error instanceof Error ? error.message : 'unknown error',
        });
        json(res, 500, {
          error: {
            code: 'EMAIL_SETTINGS_PERSIST_FAILED',
            message: 'could not persist email settings',
          },
        });
      }
      return;
    }

    json(res, 404, { error: 'not_found' });
  };

  const server: Server = createServer((req, res) => {
    instrumentNodeRequest(req, res);
    void route(req, res).catch((error: unknown) => {
      logger.error('http.request_failed', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      if (!res.headersSent) {
        json(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'internal error' } });
      } else {
        res.end();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      logger.info('http.listening', { port: boundPort });
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
