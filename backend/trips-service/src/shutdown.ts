// Bounded, idempotent shutdown. Extracted from index.ts so it can be tested
// without starting a real server.

export interface StoppableServer {
  stop(): void | Promise<void>;
}

export interface ClosableDb {
  close(): Promise<void>;
}

export interface ShutdownOptions {
  server: StoppableServer;
  db: ClosableDb;
  timeoutMs: number;
  exit: (code: number) => void;
  log?: (message: string) => void;
  /** Stops background work (the outbox relay) before the server and pool. */
  beforeClose?: () => Promise<void>;
}

export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  let stopping = false;

  return async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;

    options.log?.(`[trips] ${signal}; shutting down`);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const hardStop = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, options.timeoutMs);
    });

    try {
      await Promise.race([
        (async () => {
          await options.beforeClose?.();
          await options.server.stop();
          await options.db.close();
        })(),
        hardStop,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.log?.(`[trips] shutdown error: ${message}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options.exit(0);
    }
  };
}
