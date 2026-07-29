/**
 * /ops.json schema (v1) — kind + schemaVersion envelope and a hand-rolled
 * runtime validator (no deps). The handler self-checks before responding and
 * logs validator failures to stderr WITHOUT failing the endpoint — a broken
 * validator must never take down the data feed it guards.
 */
import type { KalshiAuthState, OpsDashboardData } from "./views.ts";

export const OPS_JSON_KIND = "ops-dashboard" as const;
export const OPS_JSON_SCHEMA_VERSION = 1 as const;

export type OpsDashboardJson = OpsDashboardData & {
  kind: typeof OPS_JSON_KIND;
  schemaVersion: typeof OPS_JSON_SCHEMA_VERSION;
};

export type OpsJsonValidation = { ok: boolean; errors: string[] };

const KALSHI_AUTH_STATES: readonly KalshiAuthState[] = ["valid", "invalid", "unreachable", "no-creds"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

export function validateOpsDashboardJson(data: unknown): OpsJsonValidation {
  const errors: string[] = [];
  if (!isRecord(data)) {
    return { ok: false, errors: ["payload is not an object"] };
  }

  if (data.kind !== OPS_JSON_KIND) {
    errors.push(`kind: expected "${OPS_JSON_KIND}", got ${JSON.stringify(data.kind)}`);
  }
  if (data.schemaVersion !== OPS_JSON_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${OPS_JSON_SCHEMA_VERSION}, got ${JSON.stringify(data.schemaVersion)}`);
  }
  if (!isIsoDate(data.generatedAt)) {
    errors.push("generatedAt: expected ISO date string");
  }

  if (!isRecord(data.agents)) {
    errors.push("agents: expected record of booleans");
  } else {
    for (const [name, up] of Object.entries(data.agents)) {
      if (typeof up !== "boolean") errors.push(`agents.${name}: expected boolean`);
    }
  }

  if (data.server !== undefined) {
    if (!isRecord(data.server)) {
      errors.push("server: expected object");
    } else {
      if (typeof data.server.uptimeSec !== "number") errors.push("server.uptimeSec: expected number");
      if (typeof data.server.rssMb !== "number") errors.push("server.rssMb: expected number");
    }
  }

  if (!Array.isArray(data.flows)) {
    errors.push("flows: expected array");
  } else {
    for (const [i, flow] of data.flows.entries()) {
      if (!isRecord(flow) || typeof flow.label !== "string") {
        errors.push(`flows[${i}]: expected object with string label`);
      }
    }
  }

  if (data.kalshiAuth !== undefined) {
    if (!isRecord(data.kalshiAuth)) {
      errors.push("kalshiAuth: expected object");
    } else if (!KALSHI_AUTH_STATES.includes(data.kalshiAuth.state as KalshiAuthState)) {
      errors.push(`kalshiAuth.state: expected one of ${KALSHI_AUTH_STATES.join("/")}, got ${JSON.stringify(data.kalshiAuth.state)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
