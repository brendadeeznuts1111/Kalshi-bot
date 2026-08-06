import type { AdapterDefinition, AdapterHealth } from "../types.ts";

type CachePolicy = AdapterDefinition["cachePolicy"];

/** Shared adapter health/circuit state; success means fetch + parse + projection completed. */
export class SourceAdapterHealthState {
  private consecutiveFailures = 0;
  private lastSuccessAtMs: number | undefined;
  private circuitOpenedAtMs: number | undefined;

  constructor(
    private readonly label: string,
    private readonly definition: AdapterDefinition,
    private readonly now: () => number,
    private readonly policy: CachePolicy = definition.cachePolicy,
  ) {}

  beforeRequest(): void {
    if (
      this.circuitOpenedAtMs !== undefined &&
      this.now() - this.circuitOpenedAtMs < this.policy.circuitResetMs
    ) {
      throw new Error(`${this.label} adapter circuit is open`);
    }
  }

  observedAtMs(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${this.label} adapter clock must return a timestamp`);
    }
    return value;
  }

  succeed(observedAtMs: number): void {
    this.consecutiveFailures = 0;
    this.circuitOpenedAtMs = undefined;
    this.lastSuccessAtMs = observedAtMs;
  }

  fail(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.policy.failureThreshold) {
      this.circuitOpenedAtMs = this.now();
    }
  }

  read(): AdapterHealth {
    const now = this.now();
    if (
      this.circuitOpenedAtMs !== undefined &&
      now - this.circuitOpenedAtMs < this.policy.circuitResetMs
    ) {
      return {
        state: "circuit_open",
        consecutiveFailures: this.consecutiveFailures,
        ...(this.lastSuccessAtMs === undefined ? {} : { lastSuccessAtMs: this.lastSuccessAtMs }),
        staleSinceMs: this.circuitOpenedAtMs,
      };
    }
    if (this.consecutiveFailures > 0) {
      return {
        state: "degraded",
        consecutiveFailures: this.consecutiveFailures,
        ...(this.lastSuccessAtMs === undefined ? {} : { lastSuccessAtMs: this.lastSuccessAtMs }),
      };
    }
    if (
      this.lastSuccessAtMs !== undefined &&
      now - this.lastSuccessAtMs > this.policy.freshForMs
    ) {
      return {
        state: "stale",
        consecutiveFailures: 0,
        lastSuccessAtMs: this.lastSuccessAtMs,
        staleSinceMs: this.lastSuccessAtMs + this.policy.freshForMs,
      };
    }
    return this.lastSuccessAtMs === undefined
      ? { state: "stale", consecutiveFailures: 0, staleSinceMs: now }
      : { state: "healthy", consecutiveFailures: 0, lastSuccessAtMs: this.lastSuccessAtMs };
  }
}
