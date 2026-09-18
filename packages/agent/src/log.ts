/**
 * The logger is the only thing in this package that prints. It redacts anything
 * shaped like a private key on the way out, so an accidental `log.info(config)`
 * cannot leak one. Keys are never written to disk by this package at all.
 */

const SECRET_SHAPE = /0x[0-9a-fA-F]{64}\b/g;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function redact(value: string): string {
  return value.replace(SECRET_SHAPE, '0x<redacted>');
}

function render(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return value.message;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    } catch {
      return '[unserialisable]';
    }
  }
  return String(value);
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const min = ORDER[level];

  const emit = (at: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[at] < min) return;
    const parts: string[] = [];
    if (fields) {
      for (const [key, value] of Object.entries(fields)) parts.push(`${key}=${render(value)}`);
    }
    const line = redact(`${at.padEnd(5)} ${message}${parts.length ? ` ${parts.join(' ')}` : ''}`);
    if (at === 'error' || at === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
