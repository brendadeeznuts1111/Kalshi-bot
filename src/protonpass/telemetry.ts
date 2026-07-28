/**
 * Telemetry — per-secret latency and success tracking.
 * Writes append-only JSONL for external analysis.
 */

import { appendFile } from "node:fs/promises";

export type SecretTelemetryEvent = {
  ts: string;
  uri: string;
  durationMs: number;
  status: "ok" | "error" | "cached";
  error?: string;
  fromCache: boolean;
};

export type TelemetrySummary = {
  totalEvents: number;
  okCount: number;
  errorCount: number;
  cacheHitCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  slowestUri: string | null;
  slowestMs: number;
};

export class SecretTelemetry {
  private events: SecretTelemetryEvent[] = [];
  private logPath: string | null = null;

  constructor(opts: { logPath?: string } = {}) {
    this.logPath = opts.logPath ?? null;
  }

  record(event: Omit<SecretTelemetryEvent, "ts">): void {
    const full: SecretTelemetryEvent = {
      ...event,
      ts: new Date().toISOString(),
    };
    this.events.push(full);

    if (this.logPath) {
      appendFile(this.logPath, `${JSON.stringify(full)}\n`).catch(() => {
        // Best effort — don't block on telemetry
      });
    }
  }

  summary(): TelemetrySummary {
    const ev = this.events;
    if (ev.length === 0) {
      return {
        totalEvents: 0,
        okCount: 0,
        errorCount: 0,
        cacheHitCount: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
        slowestUri: null,
        slowestMs: 0,
      };
    }

    const durations = ev.map((e) => e.durationMs).sort((a, b) => a - b);
    const okCount = ev.filter((e) => e.status === "ok").length;
    const errorCount = ev.filter((e) => e.status === "error").length;
    const cacheHitCount = ev.filter((e) => e.fromCache).length;
    const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    const p95Idx = Math.floor(durations.length * 0.95);
    const p95 = durations[Math.min(p95Idx, durations.length - 1)] ?? 0;
    const slowest = [...ev].sort((a, b) => b.durationMs - a.durationMs)[0];

    return {
      totalEvents: ev.length,
      okCount,
      errorCount,
      cacheHitCount,
      avgDurationMs: avg,
      p95DurationMs: p95,
      slowestUri: slowest?.uri ?? null,
      slowestMs: slowest?.durationMs ?? 0,
    };
  }

  printSummary(): void {
    const s = this.summary();
    console.log("\n=== Secret Fetch Telemetry ===\n");
    console.log(`Total fetches: ${s.totalEvents}`);
    console.log(`  ✅ OK: ${s.okCount}`);
    console.log(`  ❌ Errors: ${s.errorCount}`);
    console.log(`  💾 Cache hits: ${s.cacheHitCount}`);
    console.log(`  ⏱️  Avg: ${s.avgDurationMs}ms`);
    console.log(`  ⏱️  P95: ${s.p95DurationMs}ms`);
    if (s.slowestUri) {
      console.log(`  🐢 Slowest: ${s.slowestUri} (${s.slowestMs}ms)`);
    }
  }
}
