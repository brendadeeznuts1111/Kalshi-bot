/**
 * ProtonPass Bun-native capability suite.
 *
 * | Capability | Module | Bun API |
 * |------------|--------|---------|
 * | Parallel secret fetch | `parallel-fetch.ts` | Promise.allSettled |
 * | Secret caching (TTL) | `cache.ts` | Bun.file + Bun.write |
 * | Retry with backoff | `retry.ts` | Bun.sleep |
 * | Command timeout | `timeout.ts` | Promise.race + proc.kill() |
 * | Structured logging | `logger.ts` | Bun.inspect |
 * | Secret health score | `health.ts` | Bun.inspect.table |
 * | SSH temp file | `ssh-temp.ts` | Bun.write + chmod |
 * | Startup gate | `gate.ts` | — |
 * | Circuit breaker | `circuit.ts` | — |
 * | Telemetry | `telemetry.ts` | — |
 */

export { createLogger, defaultLogger } from "./logger.ts";
export { withRetry, RetryExhaustedError, type RetryOptions } from "./retry.ts";
export { spawnWithTimeout, withTimeout, TimeoutError, type SpawnResult } from "./timeout.ts";
export { SecretCacheManager, type CacheOptions, type SecretCache, type CacheEntry } from "./cache.ts";
export {
  fetchSecret,
  fetchSecretsParallel,
  type SecretUri,
  type SecretFetchResult,
  type ParallelFetchOptions,
} from "./parallel-fetch.ts";
export { auditSecretHealth, printHealthTable, type SecretHealthScore } from "./health.ts";
export {
  writeSecureTemp,
  writePemTemp,
  withTempFile,
  type TempFile,
} from "./ssh-temp.ts";
export { runStartupGate, assertGate, DEFAULT_GATE_CHECKS, type GateCheck, type GateResult } from "./gate.ts";
export { CircuitBreaker, CircuitOpenError, type CircuitState } from "./circuit.ts";
export { SecretTelemetry, type SecretTelemetryEvent, type TelemetrySummary } from "./telemetry.ts";
export {
  ensureKalshiAgentSession,
  loadKalshiBotToken,
  KALSHI_SESSION_DIR,
  KALSHI_TOKEN_ENV,
  PASS_TOKENS_FILE,
  type AgentSessionResult,
} from "./agent-session.ts";
