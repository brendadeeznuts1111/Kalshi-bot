// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  assertAllowlistedScreenshotUrl,
  DashboardScreenshotUrlError,
  defaultDashboardScreenshotUrl,
} from "../src/agent/dashboard-screenshot-url.ts";
import { captureDashboardScreenshot } from "../src/agent/dashboard-screenshot.ts";
import { createDashboardServer, handleDashboardScreenshotPost } from "../src/agent/dashboard-server.ts";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

describe("dashboard-screenshot-url allowlist", () => {
  test("accepts loopback dashboard home", () => {
    const url = assertAllowlistedScreenshotUrl("http://127.0.0.1:3457/");
    expect(url.pathname).toBe("/");
  });

  test("rejects file:// (local file reader)", () => {
    expect(() => assertAllowlistedScreenshotUrl("file:///etc/passwd")).toThrow(DashboardScreenshotUrlError);
    expect(() => assertAllowlistedScreenshotUrl("file:///etc/passwd")).toThrow(/Blocked screenshot protocol/);
  });

  test("rejects remote http hosts (SSRF)", () => {
    expect(() => assertAllowlistedScreenshotUrl("http://169.254.169.254/")).toThrow(/Blocked screenshot host/);
    expect(() => assertAllowlistedScreenshotUrl("https://127.0.0.1/")).toThrow(/Blocked screenshot protocol/);
  });

  test("rejects non-dashboard paths", () => {
    expect(() => assertAllowlistedScreenshotUrl("http://127.0.0.1:3457/api/status")).toThrow(/Blocked screenshot path/);
  });

  test("defaultDashboardScreenshotUrl is allowlisted", () => {
    expect(() => assertAllowlistedScreenshotUrl(defaultDashboardScreenshotUrl(3457))).not.toThrow();
  });
});

describe("dashboard screenshot HTTP hardening", () => {
  test("POST /api/screenshot rejects client-supplied url", async () => {
    const res = await handleDashboardScreenshotPost(
      new Request("http://127.0.0.1/api/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1/" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("URL parameters are not accepted");
  });

  test("captureDashboardScreenshot blocks non-allowlisted dashboardUrl", async () => {
    await expect(
      captureDashboardScreenshot(
        { dashboardUrl: "file:///tmp/secret.png" },
        { probeAndCapture: async () => TINY_PNG },
      ),
    ).rejects.toThrow(DashboardScreenshotUrlError);
  });

  test("createDashboardServer binds 127.0.0.1 not 0.0.0.0", () => {
    const server = createDashboardServer({ port: 0 });
    try {
      expect(server.hostname).toBe("127.0.0.1");
      expect(server.url.hostname).toBe("127.0.0.1");
    } finally {
      server.stop();
    }
  });
});
