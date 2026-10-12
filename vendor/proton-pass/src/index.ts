/**
 * @factorywager/proton-pass — portable Proton Pass CLI integration.
 *
 * Resolve secrets at the process boundary; domain code only reads Bun.env.
 * @see https://protonpass.github.io/pass-cli/
 */

export { PassError, PASS_ERROR_CODES, redactErrorMessage, type PassErrorCode } from './errors.ts';
export { argValue, hasFlag } from './argv.ts';
export {
  createLogger,
  defaultLogger,
  type LogLevel,
  type LogMode,
  type LogEntry,
} from './logger.ts';
export { withRetry, RetryExhaustedError, type RetryOptions } from './retry.ts';
export { spawnWithTimeout, withTimeout, TimeoutError, type SpawnResult } from './timeout.ts';
export {
  SecretCacheManager,
  type CacheOptions,
  type SecretCache,
  type CacheEntry,
} from './cache.ts';
export {
  fetchSecret,
  fetchSecretsParallel,
  type SecretUri,
  type SecretFetchResult,
  type ParallelFetchOptions,
} from './parallel-fetch.ts';
export {
  auditSecretHealth,
  printHealthTable,
  type SecretHealthScore,
  type SecretHealthConfig,
} from './health.ts';
export { writeSecureTemp, writePemTemp, withTempFile, type TempFile } from './ssh-temp.ts';
export {
  runStartupGate,
  assertGate,
  envPrefixPresence,
  type GateCheck,
  type GateResult,
} from './gate.ts';
export { CircuitBreaker, CircuitOpenError, type CircuitState } from './circuit.ts';
export {
  SecretTelemetry,
  type SecretTelemetryEvent,
  type TelemetrySummary,
} from './secret-telemetry.ts';
export { findPassCli, passCliCandidates } from './cli-locate.ts';
export { checkEnvFile, templateToRunEnv, runEnvToTemplate, type EnvFileCheck } from './env-file.ts';
export {
  ensureAgentSession,
  loadPatToken,
  probePassSession,
  parsePassInfoJson,
  isPassSessionReady,
  vaultNamesFromListJson,
  KALSHI_AGENT_SESSION,
  FACTORYWAGER_AGENT_SESSION,
  type AgentSessionConfig,
  type AgentSessionResult,
  type PassSessionProbe,
  type PassInfoJson,
} from './session.ts';
export { agentConfigFor, type NamedAgent } from './agents.ts';
export {
  injectEnvFile,
  runWithEnvFile,
  type InjectOptions,
  type InjectResult,
  type RunOptions,
  type RunResult,
} from './inject.ts';
