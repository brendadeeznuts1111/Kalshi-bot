// @see https://bun.com/docs/test/index#run-tests
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createResearchServer } from "../src/research/serve.ts";
import { CSRF_SESSION_COOKIE, issueCsrfSession } from "../src/research/csrf.ts";
import { renderOps } from "../src/research/views.ts";

describe("ops actions panel", () => {
  const html = renderOps({
    generatedAt: new Date().toISOString(),
    agents: { orchestrator: true },
    ticks: [],
    lineMoves: [],
    canary: null,
    store: null,
    flows: [],
    runs: [],
  });

  test("renders both forms with confirm-gated disabled submits", () => {
    expect(html).toContain("<h2>Actions</h2>");
    // dispatch form
    expect(html).toContain('id="ops-dispatch-form"');
    expect(html).toContain('id="ops-dispatch-type"');
    expect(html).toContain("COMPLIANCE_CHECK");
    expect(html).toContain("LINE_MOVE_EVAL");
    expect(html).toContain('id="ops-dispatch-confirm"');
    expect(html).toContain('id="ops-dispatch-submit" disabled');
    expect(html).toContain('id="ops-dispatch-result" hidden');
    // compliance bet form
    expect(html).toContain('id="ops-bet-form"');
    expect(html).toContain('id="ops-bet-state"');
    expect(html).toContain('id="ops-bet-confirm"');
    expect(html).toContain('id="ops-bet-submit" disabled');
    expect(html).toContain('id="ops-bet-result" hidden');
    // labeling + persistence hint
    expect(html).toContain("NOT a live Kalshi order");
    expect(html).toContain("Form values persist across auto-refresh");
    expect(html).toContain("confirmation resets deliberately");
  });

  test("posts to existing endpoints only (no new routes)", () => {
    expect(html).toContain('url: "/agent/dispatch"');
    expect(html).toContain('url: "/place-bet"');
    expect(html).toContain('"x-state-code"');
  });
});

describe("ops actions endpoints", () => {
  let server: ReturnType<typeof createResearchServer>;
  const session = issueCsrfSession();

  beforeAll(() => {
    server = createResearchServer({ port: 0 });
  });

  afterAll(() => {
    server.stop();
  });

  test("POST /agent/dispatch with a valid type returns agent result", async () => {
    const res = await fetch(`${server.url}agent/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": session.token, "cookie": CSRF_SESSION_COOKIE + "=" + session.sessionId },
      body: JSON.stringify({ task: { type: "SPIKE_DETECT", payload: {} } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("ops");
    expect(body.ok).toBe(true);
    expect(body.data.triggered).toBe(false);
    expect(typeof body.latencyMs).toBe("number");
  });

  test("POST /place-bet with x-state-code MA returns synthetic playId", async () => {
    const res = await fetch(`${server.url}place-bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-state-code": "MA", "x-csrf-token": session.token, "cookie": CSRF_SESSION_COOKIE + "=" + session.sessionId },
      body: JSON.stringify({ wagerAmount: 10, userId: "ops-test" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.playId).toBeDefined();
  });

  test("POST /place-bet with unsupported state is blocked with 400", async () => {
    const res = await fetch(`${server.url}place-bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-state-code": "XX", "x-csrf-token": session.token, "cookie": CSRF_SESSION_COOKIE + "=" + session.sessionId },
      body: JSON.stringify({ wagerAmount: 10, userId: "ops-test" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("XX");
    expect(body.allowedStates).toEqual(["MA", "NJ"]);
  });
});
