// Probe server. Liveness must stay 200 while the process is alive; readiness
// only flips after the Kafka consumer has joined its group and the provider is
// configured. Kubernetes restarts on liveness, removes endpoints on readiness.

import { createServer, type Server } from 'node:http';
import type { Logger } from './logger.ts';

export interface HealthState {
  ready: boolean;
  provider: string;
  providerReady: boolean;
  kafkaReady: boolean;
  reason?: string;
}

export interface HealthHandle {
  close(): Promise<void>;
}

export interface StartHealthServerOptions {
  port: number;
  logger: Logger;
  getState: () => HealthState;
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function startHealthServer({ port, logger, getState }: StartHealthServerOptions): Promise<HealthHandle> {
  const startedAt = Date.now();

  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      json(res, 200, {
        status: 'ok',
        service: 'triplanner-email-service',
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/ready') {
      const state = getState();
      json(res, state.ready ? 200 : 503, {
        status: state.ready ? 'ready' : 'not_ready',
        provider: state.provider,
        providerReady: state.providerReady,
        kafkaReady: state.kafkaReady,
        ...(state.reason ? { reason: state.reason } : {}),
      });
      return;
    }

    json(res, 404, { error: 'not_found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      logger.info('health.listening', { port });
      resolve({
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
