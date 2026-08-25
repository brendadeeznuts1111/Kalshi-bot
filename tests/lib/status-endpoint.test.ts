// /status + /healthz liveness/readiness endpoint tests (§75).
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createResearchServer } from "../../src/research/serve.ts";

type StatusBody = {
  ok: boolean;
  status: string;
  bunVersion: string;
  uptimeMs: number;
  signals: number;
  channels: { ok: number; warn: number; bad: number; info: number };
  failing: Array<{ id: string; title: string }>;
};

let server: ReturnType<typeof createResearchServer>;
const PORT = 3611;

beforeAll(() => { server = createResearchServer({ port: PORT }); });
afterAll(() => { server.stop(true); });

describe("/status liveness endpoint (§75)", () => {
  test("returns 200 ok with aggregate health shape", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.bunVersion).toBe(Bun.version);
    expect(typeof body.uptimeMs).toBe("number");
    expect(body.signals).toBeGreaterThan(0);
    expect(body.channels.bad).toBe(0);
    expect(body.failing).toEqual([]);
  });

  test("/healthz aliases /status", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body.ok).toBe(true);
  });
});