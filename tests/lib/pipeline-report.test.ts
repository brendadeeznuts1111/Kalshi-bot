// pipeline-report (§107) — pure renderer + data-driven enhancement notes.
import { describe, expect, test } from "bun:test";
import { moduleEnhancementNotes, renderPipelineReport, type PipelineModuleInfo } from "../../src/lib/pipeline-report.ts";

function mod(over: Partial<PipelineModuleInfo>): PipelineModuleInfo {
  return {
    name: "design-system",
    bytes: 6_472,
    budget: 12 * 1024,
    largest: 3_614,
    largestBudget: 4 * 1024,
    deltaPct: 1.2,
    ok: true,
    ...over,
  };
}

describe("moduleEnhancementNotes (§107)", () => {
  test("healthy core module -> expected core weight", () => {
    const notes = moduleEnhancementNotes(mod({}));
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain("expected core weight");
  });

  test("over budget flags first", () => {
    const notes = moduleEnhancementNotes(mod({ ok: false, bytes: 13 * 1024 }));
    expect(notes[0]).toContain("OVER BUDGET");
  });

  test("monolith detection at >= 90% of the bundle", () => {
    const notes = moduleEnhancementNotes(mod({ bytes: 50 * 1024, largest: 48 * 1024 }));
    expect(notes.join(" ")).toContain("monolith");
    expect(notes.join(" ")).toContain("96.0%");
  });

  test("missing metafile -> seed instruction", () => {
    const notes = moduleEnhancementNotes(mod({ bytes: null }));
    expect(notes[0]).toContain("design:build");
  });
});

describe("renderPipelineReport (§107)", () => {
  test("renders summary table, plans, and gate status", () => {
    const md = renderPipelineReport({
      generatedAt: "2026-08-25T00:00:00.000Z",
      bunVersion: "1.4.0",
      modules: [
        mod({ name: "design-system" }),
        mod({ name: "hq-app", bytes: 50 * 1024, largest: 48 * 1024, budget: 64 * 1024 }),
        mod({ name: "over", ok: false, bytes: 13 * 1024 }),
      ],
    });
    expect(md).toContain("# Frontend Build Pipeline Report");
    expect(md).toContain("| design-system | 6.32 KB | 12 KB | 3.53 KB | +1.2% | ok |");
    expect(md).toContain("### hq-app");
    expect(md).toContain("monolith");
    expect(md).toContain("Gate");
    expect(md).toContain("**FAIL (1 module(s) over budget)**");
  });
});
