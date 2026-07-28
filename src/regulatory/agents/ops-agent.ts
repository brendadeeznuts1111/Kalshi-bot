/**
 * OpsAgent — violation spike detection + line-move alert integration.
 *
 * Wraps ViolationAlerts and surfaces ops-ready summaries.
 */

import { AGENT_ROLE, ALERT } from "../constants";
import type { Agent, AgentContext, AgentResult, AgentTask } from "./orchestrator.ts";
import { ViolationAlerts } from "../lib/alerting.ts";

export class OpsAgent implements Agent {
  readonly role = AGENT_ROLE.OPS;

  constructor(private alerts: ViolationAlerts) {}

  async run(task: AgentTask, _ctx: AgentContext): Promise<AgentResult> {
    const start = performance.now();

    switch (task.type) {
      case "SPIKE_DETECT": {
        const p = task.payload;
        const spike = this.alerts.checkSpike({
          windowSeconds: p.windowSeconds ?? ALERT.DEFAULT_WINDOW_SECONDS,
          threshold: p.threshold ?? ALERT.DEFAULT_THRESHOLD,
        });
        return {
          role: this.role,
          ok: true,
          data: {
            triggered: spike.triggered,
            count: spike.count,
            windowSeconds: spike.windowSeconds,
            threshold: spike.threshold,
            topReasons: spike.topReasons,
            topStates: spike.topStates,
          },
          latencyMs: Math.round(performance.now() - start),
        };
      }

      default:
        return {
          role: this.role,
          ok: false,
          error: `Unsupported task type: ${task.type}`,
          latencyMs: Math.round(performance.now() - start),
        };
    }
  }

  /** Convenience wrapper for dashboard summaries. */
  summary(lastMinutes?: number): ReturnType<ViolationAlerts["summary"]> {
    return this.alerts.summary(lastMinutes);
  }
}
