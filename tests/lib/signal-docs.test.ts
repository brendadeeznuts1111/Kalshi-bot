// signal-pipeline channel integration tests (§67/§97/§104) — the docs
// gates' state files surface on the docs channel; licenses:gate on its
// OWN compliance channel.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { collectCompliance, collectDocs } from "../../src/institutions/signal-pipeline.ts";

const ROOT = join(import.meta.dir, "../..");
type SignalLike = { id: string; channel: string; severity: string; title: string; detail: string };

describe("collectDocs full-surface (§67)", () => {
  test("emits render + api + integrity + output signals", async () => {
    const signals: SignalLike[] = [];
    await collectDocs(ROOT, signals as never);
    const docs = signals.filter((s) => s.channel === "docs");
    const ids = docs.map((s) => s.id);
    expect(ids).toContain("docs-health");
    expect(ids).toContain("docs-api");
    expect(ids).toContain("docs-integrity");
    expect(ids).toContain("docs-output");
    expect(ids).not.toContain("licenses-health"); // moved to compliance channel (§104)
  });

  test("all four surface ok when the gates are green", async () => {
    const signals: SignalLike[] = [];
    await collectDocs(ROOT, signals as never);
    const docs = signals.filter((s) => s.channel === "docs" && !s.id.endsWith("-stale"));
    for (const s of docs) expect(s.severity).toBe("ok");
  });

  test("gate detail names the surface (render/api/integrity/output)", async () => {
    const signals: SignalLike[] = [];
    await collectDocs(ROOT, signals as never);
    const docs = signals.filter((s) => s.channel === "docs");
    expect(docs.find((s) => s.id === "docs-health")!.title).toMatch(/render/);
    expect(docs.find((s) => s.id === "docs-api")!.title).toMatch(/tokens/);
    expect(docs.find((s) => s.id === "docs-integrity")!.title).toMatch(/links/);
    expect(docs.find((s) => s.id === "docs-output")!.title).toMatch(/assertions/);
  });
});

describe("collectCompliance (§104)", () => {
  test("licenses-health surfaces on the compliance channel", async () => {
    const signals: SignalLike[] = [];
    await collectCompliance(ROOT, signals as never);
    const comp = signals.filter((s) => s.channel === "compliance");
    expect(comp.map((s) => s.id)).toContain("licenses-health");
    expect(comp.find((s) => s.id === "licenses-health")!.title).toMatch(/packages/);
  });

  test("compliance channel is ok when the gate is green", async () => {
    const signals: SignalLike[] = [];
    await collectCompliance(ROOT, signals as never);
    const comp = signals.filter((s) => s.channel === "compliance" && !s.id.endsWith("-stale"));
    for (const s of comp) expect(s.severity).toBe("ok");
  });
});
