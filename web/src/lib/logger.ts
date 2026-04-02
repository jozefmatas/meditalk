/**
 * Lightweight structured logger.
 *
 * - `debug` → silenced in production (no-ops)
 * - `info`  → always logs
 * - `warn`  → always logs
 * - `error` → always logs
 *
 * Works in both server and client contexts.
 */

const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  /** Debug-level logs — silenced in production. */
  debug: isDev ? (...args: unknown[]) => console.log(...args) : () => {},

  /** Informational logs — always visible. */
  info: (...args: unknown[]) => console.info(...args),

  /** Warning logs — always visible. */
  warn: (...args: unknown[]) => console.warn(...args),

  /** Error logs — always visible. */
  error: (...args: unknown[]) => console.error(...args),
};
