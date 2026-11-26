// Minimal structured logger. One JSON object per line so Loki/CloudWatch can
// index it without a parser. Log callers are responsible for redacting PII:
// never pass a raw recipient address or a payload object.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(level: LogLevel, bindings: Record<string, unknown> = {}): Logger {
  const threshold = ORDER[level];

  const emit = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[entryLevel] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: entryLevel,
      service: 'triplanner-email-service',
      ...bindings,
      ...fields,
      msg: message,
    });
    // eslint-disable-next-line no-console
    if (entryLevel === 'error') console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (childBindings) => createLogger(level, { ...bindings, ...childBindings }),
  };
}
