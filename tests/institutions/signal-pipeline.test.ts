// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  collectSignals,
  renderDashboard,
  type BrandMetricsSnapshot,
} from "../../src/institutions/signal-pipeline.ts";
import { designAgent } from "../../src/agent/design-agent.ts";

const BRAND: BrandMetricsSnapshot = {
  card: { hits: 4, misses: 2, errors: 0, totalMs: 900 },
  swatch: { served: 5 },
  svg: { served: 6 },
  badge: { served: 1 },
  quote: { served: 2 },
  chart: { served: 3 },
  purges: 1,
};

describe("signal pipeline (multi-source dashboard)", () => {
  test("collectSignals covers every channel with a severity", async () => {
    const signals = await collectSignals(process.cwd(), BRAND);
    const channels = new Set(signals.map((s) => s.channel));
    for (const ch of ["design", "deps", "brand", "releases", "ops", "inventory", "cron", "prune", "mapping", "docs"] as const) {
      expect(channels.has(ch), ch).toBe(true);
    }
    for (const s of signals) {
      expect(["ok", "warn", "bad", "info"], s.id).toContain(s.severity);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.source.length).toBeGreaterThan(0);
    }
  });

  test("design channel reports bundle health from metafiles", async () => {
    const signals = await collectSignals(process.cwd(), BRAND);
    const design = signals.filter((s) => s.channel === "design");
    expect(design.length).toBeGreaterThanOrEqual(2); // design-system + hq-app
    for (const s of design) {
      expect(s.title).toContain("KB");
    }
  });

  test("inventory channel reports real data-asset coverage", async () => {
    const signals = await collectSignals(process.cwd(), BRAND);
    const inv = signals.filter((s) => s.channel === "inventory");
    expect(inv.length).toBeGreaterThanOrEqual(5);
    const titles = inv.map((s) => s.title).join(" ");
    expect(titles).toContain("massey");
    expect(titles).toContain("event store");
    expect(titles).toContain("patterns");
    expect(titles).toContain("signals across");
    const massey = inv.find((s) => s.id === "inv-massey");
    expect(massey!.detail).toContain("NBA");
  });

  test("releases channel cross-checks RSS and GitHub atom", async () => {
    const signals = await collectSignals(process.cwd(), BRAND);
    const releases = signals.filter((s) => s.channel === "releases");
    expect(releases.length).toBeGreaterThanOrEqual(1);
    // Either the feeds matched (ok) or they were unavailable (warn) — never bad.
    expect(["ok", "warn"]).toContain(releases[0]!.severity);
  });

  test("cron channel reports the Bun.cron refresh job", async () => {
    const signals = await collectSignals(process.cwd(), BRAND);
    const cron = signals.filter((s) => s.channel === "cron");
    expect(cron.length).toBe(1);
    expect(cron[0]!.title).toContain("Bun.cron");
    expect(cron[0]!.title).toContain("*/5 * * * *");
  });

  test("renderDashboard is token-compliant, has channel sections + dynamic poll", () => {
    const signals = [
      { id: "a", channel: "design" as const, severity: "ok" as const, title: "t", detail: "d", source: "s" },
      { id: "c", channel: "cron" as const, severity: "ok" as const, title: "cron", detail: "d", source: "Bun.cron" },
    ];
    const html = renderDashboard(signals, "tok123");
    const audit = designAgent.audit(html);
    expect(audit.issues).toEqual([]);
    expect(html).toContain('data-channel="design"');
    expect(html).toContain('data-channel="cron"');
    expect(html).toContain("setInterval(refresh, 15000)"); // dynamic update
  });

  test("renderDashboard is token-compliant and carries action buttons", () => {
    const signals = [
      { id: "a", channel: "design" as const, severity: "ok" as const, title: "t", detail: "d", source: "s" },
      { id: "b", channel: "brand" as const, severity: "bad" as const, title: "t2", detail: "d2", source: "s2", action: "brand-card" },
    ];
    const html = renderDashboard(signals, "tok123");
    const audit = designAgent.audit(html);
    expect(audit.issues).toEqual([]);
    expect(html).toContain("signal pipeline");
    expect(html).toContain('data-action="brand-card"');
    expect(html).toContain("tok123"); // CSRF token inlined for the buttons
    expect(html).toContain("bad"); // severity badge rendered
  });
});
