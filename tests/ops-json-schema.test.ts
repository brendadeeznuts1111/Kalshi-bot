// @see https://bun.com/docs/test/index#run-tests
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createResearchServer } from "../src/research/serve.ts";
import {
  OPS_JSON_KIND,
  OPS_JSON_SCHEMA_VERSION,
  validateOpsDashboardJson,
} from "../src/research/ops-json.ts";

describe("validateOpsDashboardJson", () => {
  const valid = {
    kind: OPS_JSON_KIND,
    schemaVersion: OPS_JSON_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    agents: { orchestrator: true },
    ticks: [],
    lineMoves: [],
    canary: null,
    store: null,
    kalshiAuth: { state: "valid", status: 200, checkedAt: new Date().toISOString(), cacheTtlSec: 300 },
    server: { bootAt: "x", uptimeSec: 1, bunVersion: "1.4.0", rssMb: 1, heapUsedMb: 1, tickCount: 0, lineMoveCount: 0 },
    flows: [{ label: "f1" }],
    runs: [],
  };

  test("accepts a well-formed payload", () => {
    expect(validateOpsDashboardJson(valid)).toEqual({ ok: true, errors: [] });
  });

  test("rejects missing kind", () => {
    const { kind: _kind, ...rest } = valid;
    const r = validateOpsDashboardJson(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("kind:"))).toBe(true);
  });

  test("rejects bad kalshiAuth.state", () => {
    const r = validateOpsDashboardJson({ ...valid, kalshiAuth: { state: "bogus" } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("kalshiAuth.state:"))).toBe(true);
  });

  test("rejects wrong types (agents, server, flows, generatedAt)", () => {
    const r = validateOpsDashboardJson({
      ...valid,
      generatedAt: "not-a-date",
      agents: { orchestrator: "yes" },
      server: { uptimeSec: "1", rssMb: 1 },
      flows: [{ noLabel: true }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("generatedAt:"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("agents.orchestrator:"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("server.uptimeSec:"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("flows[0]:"))).toBe(true);
  });

  test("rejects non-object payloads", () => {
    expect(validateOpsDashboardJson(null).ok).toBe(false);
    expect(validateOpsDashboardJson("[]").ok).toBe(false);
    expect(validateOpsDashboardJson([]).ok).toBe(false);
  });
});

describe("/ops.json live payload", () => {
  let server: ReturnType<typeof createResearchServer>;

  beforeAll(() => {
    server = createResearchServer({ port: 0 });
  });

  afterAll(() => {
    server.stop(true);
  });

  test("real handler output passes the validator and carries schema fields", async () => {
    const res = await fetch(`${server.url}ops.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe(OPS_JSON_KIND);
    expect(body.schemaVersion).toBe(OPS_JSON_SCHEMA_VERSION);
    const validation = validateOpsDashboardJson(body);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });
});
