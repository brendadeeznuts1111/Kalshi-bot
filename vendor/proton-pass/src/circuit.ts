/**
 * Circuit breaker — protects against cascading pass-cli failures.
 * Tracks failure rate; opens circuit when threshold exceeded.
 */

import { createLogger } from './logger.ts';

const log = createLogger({ prefix: 'circuit' });

export type CircuitState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerOptions = {
  failureThreshold?: number; // failures before opening
  recoveryTimeoutMs?: number; // time before half-open
  halfOpenMaxCalls?: number; // test calls in half-open
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  private failureThreshold: number;
  private recoveryTimeoutMs: number;
  private halfOpenMaxCalls: number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 30_000;
    this.halfOpenMaxCalls = opts.halfOpenMaxCalls ?? 2;
  }

  get currentState(): CircuitState {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenCalls = 0;
        log.info('Circuit entering half-open state');
      }
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;

    if (state === 'open') {
      throw new CircuitOpenError(this.recoveryTimeoutMs);
    }

    if (state === 'half-open' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new CircuitOpenError(this.recoveryTimeoutMs);
    }

    if (state === 'half-open') {
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.successes++;
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
      this.halfOpenCalls = 0;
      log.info('Circuit closed — service recovered');
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      log.warn('Circuit re-opened — failure in half-open state');
      return;
    }

    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      log.error('Circuit opened', {
        failures: this.failures,
        threshold: this.failureThreshold,
        recoveryMs: this.recoveryTimeoutMs,
      });
    }
  }

  get stats(): { state: CircuitState; failures: number; successes: number } {
    return { state: this.currentState, failures: this.failures, successes: this.successes };
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Circuit breaker OPEN — retry after ${retryAfterMs}ms`);
  }
}
