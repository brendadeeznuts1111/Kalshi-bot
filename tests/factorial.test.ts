// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  analyzeFactorial,
  assignBalanced,
  generateDesign,
  parseVariantId,
  variantId,
  type Factor,
  type Variant,
} from "../src/operations/factorial.ts";
import { ensureExperimentsSchema } from "../src/operations/experiment-schema.ts";

function emptyDb(): Database {
  const db = new Database(":memory:");
  ensureExperimentsSchema(db);
  return db;
}

const TWO_FACTOR: Factor[] = [
  { name: "routing", levels: ["static", "dynamic"] },
  { name: "cut", levels: [0.1, 0.15] },
];

const THREE_FACTOR: Factor[] = [
  { name: "routing", levels: ["static", "dynamic"] },
  { name: "cut", levels: [0.1, 0.15] },
  { name: "timing", levels: ["immediate", "batched"] },
];

const FIVE_LEVEL: Factor[] = [
  { name: "color", levels: ["red", "blue", "green", "yellow", "purple"] },
];

describe("generateDesign", () => {
  test("full factorial 2×2 = 4 variants", () => {
    const d = generateDesign(TWO_FACTOR);
    expect(d.variants).toHaveLength(4);
    expect(d.fullCount).toBe(4);
    expect(d.fraction).toBe(1);
    for (const v of d.variants) {
      expect(v).toHaveProperty("routing");
      expect(v).toHaveProperty("cut");
    }
    const ids = d.variants.map((v) => variantId(v)).sort();
    expect(ids).toEqual([
      "cut=0.1&routing=dynamic",
      "cut=0.1&routing=static",
      "cut=0.15&routing=dynamic",
      "cut=0.15&routing=static",
    ]);
  });

  test("full factorial 2×2×2 = 8 variants", () => {
    const d = generateDesign(THREE_FACTOR);
    expect(d.variants).toHaveLength(8);
    expect(d.fullCount).toBe(8);
  });

  test("single factor 5 levels", () => {
    const d = generateDesign(FIVE_LEVEL);
    expect(d.variants).toHaveLength(5);
    const ids = d.variants.map((v) => variantId(v)).sort();
    expect(ids).toEqual(["color=blue", "color=green", "color=purple", "color=red", "color=yellow"]);
  });

  test("1/2 fraction of 2×2×2 = 4 variants", () => {
    const d = generateDesign(THREE_FACTOR, 2);
    expect(d.variants.length).toBeLessThan(8);
    expect(d.variants.length).toBeGreaterThanOrEqual(2);
    expect(d.fraction).toBe(2);
    expect(d.fullCount).toBe(8);
  });

  test("1/3 fraction of 3×3 = 3 variants", () => {
    const factors: Factor[] = [
      { name: "a", levels: ["a1", "a2", "a3"] },
      { name: "b", levels: ["b1", "b2", "b3"] },
    ];
    const d = generateDesign(factors, 3);
    expect(d.variants.length).toBe(3);
  });

  test("throws on <2 levels", () => {
    expect(() => generateDesign([{ name: "bad", levels: ["only"] }])).toThrow("≥2 levels");
  });

  test("throws on fraction > full", () => {
    expect(() => generateDesign(TWO_FACTOR, 10)).toThrow("exceeds full design");
  });
});

describe("variantId", () => {
  test("produces stable reversible ids", () => {
    const a = variantId({ routing: "dynamic", cut: 0.1 });
    const b = variantId({ cut: 0.1, routing: "dynamic" });
    expect(a).toBe(b);
    expect(parseVariantId(a, TWO_FACTOR)).toEqual({ cut: 0.1, routing: "dynamic" });
  });
});

describe("assignBalanced", () => {
  test("first partner gets a variant", () => {
    const db = emptyDb();
    const a = assignBalanced(db, "exp-1", "p1", TWO_FACTOR);
    expect(a.variant).toBeDefined();
    expect(a.variantId).toBeTruthy();
    expect(typeof a.variant.routing).toBe("string");
    expect(typeof a.variant.cut).toBe("number");
  });

  test("assignment is idempotent", () => {
    const db = emptyDb();
    const a1 = assignBalanced(db, "exp-1", "p1", TWO_FACTOR);
    const a2 = assignBalanced(db, "exp-1", "p1", TWO_FACTOR);
    expect(a2.variantId).toBe(a1.variantId);
  });

  test("distributes partners evenly across variants", () => {
    const db = emptyDb();
    const d = generateDesign(TWO_FACTOR);
    const assignments = new Map<string, number>();
    for (let i = 0; i < 40; i++) {
      const a = assignBalanced(db, "exp-bal", `p${i}`, TWO_FACTOR, d);
      assignments.set(a.variantId, (assignments.get(a.variantId) ?? 0) + 1);
    }
    expect(assignments.size).toBe(4);
    for (const count of assignments.values()) {
      expect(count).toBe(10);
    }
  });
});

describe("analyzeFactorial", () => {
  function seedMetrics(
    db: Database,
    expId: string,
    variants: { variant: Variant; n: number; wins: number }[],
  ) {
    for (const { variant: v, n, wins } of variants) {
      const vid = variantId(v);
      for (let i = 0; i < n; i++) {
        const outcome = i < wins ? 1 : 0;
        db.query(
          `INSERT INTO experiment_metrics (id, experiment_id, partner_id, variant_id, outcome, recorded_at)
           VALUES ($id, $e, $p, $v, $o, datetime('now'))`,
        ).run({
          $id: `m-${vid}-${i}`,
          $e: expId,
          $p: `p-${vid}-${i}`,
          $v: vid,
          $o: outcome,
        });
      }
    }
  }

  test("detects main effects from controlled data", () => {
    const db = emptyDb();
    const expId = "main-eff-test";
    seedMetrics(db, expId, [
      { variant: { routing: "static", cut: 0.1 }, n: 100, wins: 30 },
      { variant: { routing: "static", cut: 0.15 }, n: 100, wins: 50 },
      { variant: { routing: "dynamic", cut: 0.1 }, n: 100, wins: 60 },
      { variant: { routing: "dynamic", cut: 0.15 }, n: 100, wins: 70 },
    ]);

    const result = analyzeFactorial(db, expId, TWO_FACTOR);
    expect(result.totalObservations).toBe(400);
    expect(result.grandMean).toBeCloseTo(0.525, 1);
    expect(result.mainEffects.length).toBe(4);

    const dyn = result.mainEffects.find((m) => m.factor === "routing" && m.level === "dynamic");
    expect(dyn).toBeDefined();
    expect(dyn!.effect).toBeGreaterThan(0);

    const stat = result.mainEffects.find((m) => m.factor === "routing" && m.level === "static");
    expect(stat).toBeDefined();
    expect(stat!.effect).toBeLessThan(0);
    expect(result.rSquared).toBeGreaterThan(0);
  });

  test("detects interaction effect", () => {
    const db = emptyDb();
    const expId = "interact-test";
    seedMetrics(db, expId, [
      { variant: { routing: "static", cut: 0.1 }, n: 100, wins: 50 },
      { variant: { routing: "static", cut: 0.15 }, n: 100, wins: 50 },
      { variant: { routing: "dynamic", cut: 0.1 }, n: 100, wins: 50 },
      { variant: { routing: "dynamic", cut: 0.15 }, n: 100, wins: 80 },
    ]);

    const result = analyzeFactorial(db, expId, TWO_FACTOR);
    const ix = result.interactions.find(
      (i) => i.factors.includes("routing") && i.factors.includes("cut"),
    );
    expect(ix).toBeDefined();
    expect(ix!.effect).toBeGreaterThan(0.05);
  });

  test("no interaction when effects are additive", () => {
    const db = emptyDb();
    const expId = "additive-test";
    seedMetrics(db, expId, [
      { variant: { routing: "static", cut: 0.1 }, n: 200, wins: 40 },
      { variant: { routing: "static", cut: 0.15 }, n: 200, wins: 60 },
      { variant: { routing: "dynamic", cut: 0.1 }, n: 200, wins: 80 },
      { variant: { routing: "dynamic", cut: 0.15 }, n: 200, wins: 100 },
    ]);

    const result = analyzeFactorial(db, expId, TWO_FACTOR);
    const maxIx = result.interactions.reduce(
      (m, i) => Math.max(m, Math.abs(i.effect)),
      0,
    );
    expect(maxIx).toBeLessThan(0.05);
  });

  test("throws on no metrics", () => {
    const db = emptyDb();
    expect(() => analyzeFactorial(db, "empty", TWO_FACTOR)).toThrow("no metrics");
  });
});
