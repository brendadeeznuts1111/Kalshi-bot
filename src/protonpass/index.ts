/**
 * ProtonPass capability suite for Kalshi-bot.
 *
 * Shared implementation: `@factorywager/proton-pass` (file:../packages/proton-pass).
 * Host-only: Kalshi DEFAULT_GATE_CHECKS + ensureKalshiAgentSession (force-reset).
 */

export {
  createLogger,
  defaultLogger,
  withRetry,
  RetryExhaustedError,
  type RetryOptions,
  spawnWithTimeout,
  withTimeout,
  TimeoutError,
  type SpawnResult,
  SecretCacheManager,
  type CacheOptions,
  type SecretCache,
  type CacheEntry,
  fetchSecret,
  fetchSecretsParallel,
  type SecretUri,
  type SecretFetchResult,
  type ParallelFetchOptions,
  auditSecretHealth,
  printHealthTable,
  type SecretHealthScore,
  writeSecureTemp,
  writePemTemp,
  withTempFile,
  type TempFile,
  runStartupGate,
  assertGate,
  type GateCheck,
  type GateResult,
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
  SecretTelemetry,
  type SecretTelemetryEvent,
  type TelemetrySummary,
} from '@factorywager/proton-pass';

export { DEFAULT_GATE_CHECKS } from './gate.ts';
export {
  ensureKalshiAgentSession,
  loadKalshiBotToken,
  KALSHI_SESSION_DIR,
  KALSHI_TOKEN_ENV,
  PASS_TOKENS_FILE,
  type AgentSessionResult,
} from './agent-session.ts';
