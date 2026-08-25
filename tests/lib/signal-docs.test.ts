// signal-pipeline docs-channel integration tests (§67/§97) — the docs
// gates' state files (incl. licenses:gate) surface as docs-channel signals.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { collectDocs } from "../../src/institutions/signal-pipeline.ts";

const ROOT = join(import.meta.dir, "../..");
type SignalLike = { id: string; channel: string; severity: string; title: string; detail: string };

describe("collectDocs full-surface (§67)", () => {
  test("emits render + api + integrity + output + licenses signals", async () => {
    const signals: SignalLike[] = [];
    await collectDocs(ROOT, signals as never);
    const docs = signals.filter((s) => s.channel === "docs");
    const ids = docs.map((s) => s.id);
    expect(ids).toContain("docs-health");
    expect(ids).toContain("docs-api");
    expect(ids).toContain("docs-integrity");
    expect(ids).toContain("docs-output");
    expect(ids).toContain("licenses-health");
  });

  test("all five surface ok when the gates are green", async () => {
    const signals: SignalLike[] = [];
    await collectDocs(ROOT, signals as never);
    const docs = signals.filter((s) => s.channel === "docs" && !s.id.endsWith("-stale"));
    for (const s of docs) expect(s.severity).toBe("ok");
  });

  test("gate detail names the surface (render/api/integrity/output/licenses)", async () => {
    const signals: SignalLike[] = [];
    await collectDocs(ROOT, signals as never);
    const docs = signals.filter((s) => s.channel === "docs");
    expect(docs.find((s) => s.id === "docs-health")!.title).toMatch(/render/);
    expect(docs.find((s) => s.id === "docs-api")!.title).toMatch(/tokens/);
    expect(docs.find((s) => s.id === "docs-integrity")!.title).toMatch(/links/);
    expect(docs.find((s) => s.id === "docs-output")!.title).toMatch(/assertions/);
    expect(docs.find((s) => s.id === "licenses-health")!.title).toMatch(/packages/);
  });
});