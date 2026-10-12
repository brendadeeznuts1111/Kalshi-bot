// @see https://bun.com/docs/runtime/utils#bun-inspect — Bun.inspect
// @updated Bun.inspect · fixed v1.1.43 · 2025-01-08 · https://bun.com/blog/bun-v1.1.43
// @updated Bun.inspect · fixed v1.2.1 · 2025-01-27 · https://bun.com/blog/bun-v1.2.1
// @updated Bun.inspect · fixed v1.2.19 · 2025-07-19 · https://bun.com/blog/bun-v1.2.19
// @updated Bun.inspect · fixed v1.3.0 · 2025-10-10 · https://bun.com/blog/bun-v1.3
// @updated Bun.inspect · fixed v1.3.13 · 2026-04-20 · https://bun.com/blog/bun-v1.3.13
// @verified Bun.inspect · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/utils#bun-inspect
/**
 * Bun-native structured logger — JSON / pretty / quiet modes.
 * Zero dependencies, uses Bun.inspect for rich output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export type LogMode = 'json' | 'pretty' | 'quiet';

export type LogEntry = {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function createLogger(
  opts: {
    level?: LogLevel;
    mode?: LogMode;
    prefix?: string;
  } = {}
) {
  const level = opts.level ?? 'info';
  const mode = opts.mode ?? 'pretty';
  const prefix = opts.prefix ? `[${opts.prefix}] ` : '';
  const min = LEVELS[level];

  function log(lvl: LogLevel, msg: string, extra: Record<string, unknown> = {}) {
    if (LEVELS[lvl] < min) return;
    const entry: LogEntry = {
      ts: nowIso(),
      level: lvl,
      msg: prefix + msg,
      ...extra,
    };
    if (mode === 'json') {
      console.log(JSON.stringify(entry));
    } else if (mode === 'pretty') {
      const color =
        lvl === 'error'
          ? '\x1b[31m'
          : lvl === 'warn'
            ? '\x1b[33m'
            : lvl === 'debug'
              ? '\x1b[90m'
              : '\x1b[0m';
      const reset = '\x1b[0m';
      const extras = Object.entries(extra).length
        ? ' ' + Bun.inspect(extra, { colors: true, depth: 2, compact: true })
        : '';
      console.log(`${color}[${entry.ts}] ${lvl.toUpperCase()}${reset} ${entry.msg}${extras}`);
    }
  }

  return {
    debug: (msg: string, extra?: Record<string, unknown>) => log('debug', msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra),
    child: (childPrefix: string) =>
      createLogger({ level, mode, prefix: `${prefix}${childPrefix}` }),
  };
}

export const defaultLogger = createLogger();
