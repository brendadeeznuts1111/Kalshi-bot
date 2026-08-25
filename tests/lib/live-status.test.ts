// Live-channel status broadcast tests (§75 deep) — StatusPayload shape,
// the status topic subscription, and consistency with /status.
import { describe, expect, test } from "bun:test";
import { createLiveChannel, type StatusPayload } from "../../src/institutions/live-channel.ts";

describe("live channel status broadcast (§75)", () => {
  test("broadcastStatus publishes a status-update payload with the type discriminator", () => {
    const published: Array<{ topic: string; msg: string }> = [];
    const channel = createLiveChannel();
    channel.attachServer({
      publish: (topic, msg) => { published.push({ topic, msg }); return 1; },
    });
    const payload: StatusPayload = {
      type: "status-update",
      ok: true,
      status: "ok",
      signals: 3,
      channels: { ok: 2, warn: 1, bad: 0, info: 0 },
      failing: [],
    };
    channel.broadcastStatus(payload);
    expect(published).toHaveLength(1);
    expect(published[0]!.topic).toBe("status");
    const parsed = JSON.parse(published[0]!.msg) as StatusPayload;
    expect(parsed.type).toBe("status-update");
    expect(parsed.ok).toBe(true);
    expect(parsed.channels.bad).toBe(0);
  });

  test("failing signals are listed when degraded", () => {
    const published: string[] = [];
    const channel = createLiveChannel();
    channel.attachServer({ publish: (_t, m) => { published.push(m); return 1; } });
    channel.broadcastStatus({
      type: "status-update",
      ok: false,
      status: "degraded",
      signals: 4,
      channels: { ok: 1, warn: 1, bad: 2, info: 0 },
      failing: [{ id: "docs-api", title: "docs:api" }, { id: "deps-audit", title: "bun audit" }],
    });
    const parsed = JSON.parse(published[0]!) as StatusPayload;
    expect(parsed.ok).toBe(false);
    expect(parsed.failing).toHaveLength(2);
    expect(parsed.failing[0]!.id).toBe("docs-api");
  });
});