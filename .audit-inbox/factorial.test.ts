// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  analyzeFactorial,
  assignBalanced,
  generateDesign,
  parseVariantId,
  validateDesign,
  variantId,
  type Factor,
  type Variant,
} from "./factorial.ts";

const SCHEMA = `
CREATE TABLE experiment_assignments (
  experiment_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, partner_id)
);
CREATE TABLE experiment_metrics (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  outcome REAL NOT NULL,
  recorded_at TEXT NOT NULL
);`;

function emptyDb(): Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

let metricSeq = 0;
function record(
  db: Database,
  experimentId: string,
  variant: Variant,
  outcomes: number[],
): void {
  const vid = variantId(variant);
  for (const o of outcomes) {
    db.query(
      `INSERT INTO experiment_metrics (id, experiment_id, partner_id, variant_id, outcome, recorded_at)
       VALUES ($id, $e, $p, $v, $o, datetime('now'))`,
    ).run({
      $id: `m${++metricSeq}`,
      $e: experimentId,
      $p: `p${metricSeq}`,
      $v: vid,
      $o: o,
    });
  }
}

/** Deterministic LCG (Numerical Recipes) — never Math.random in tests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
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

describe("generateDesign — full factorial (unchanged)", () => {
  test("full factorial 2×2 = 4 variants", () => {
    const d = generateDesign(TWO_FACTOR);
    expect(d.variants).toHaveLength(4);
    expect(d.fullCount).toBe(4);
    expect(d.fraction).toBe(1);
    for (const v of d.variants) {
      expect(v).toHaveProperty("routing");
      expect(v).toHaveProperty("cut");
    }
  });

  test("full factorial 2×2×2 = 8 variants", () => {
    const d = generateDesign(THREE_FACTOR);
    expect(d.variants).toHaveLength(8);
    expect(d.fullCount).toBe(8);
  });

  test("throws on empty factors / single-level factor", () => {
    expect(() => generateDesign([])).toThrow();
    expect(() => generateDesign([{ name: "x", levels: ["only"] }])).toThrow();
  });
});

describe("generateDesign — orthogonal fractional (Defect 1)", () => {
  test("fraction 2 of 2×2×2: every factor keeps both levels, validation passes", () => {
    const d = generateDesign(THREE_FACTOR, 2);
    expect(d.variants).toHaveLength(4);
    for (const f of THREE_FACTOR) {
      const seen = new Set(d.variants.map((v) => String(v[f.name])));
      expect(seen.size).toBe(2);
    }
    const v = validateDesign(d);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });

  test("2^7 fraction 4: validates — never a silently aliased design", () => {
    const seven: Factor[] = Array.from({ length: 7 }, (_, i) => ({
      name: `f${i}`,
      levels: ["lo", "hi"],
    }));
    const d = generateDesign(seven, 4);
    expect(d.variants).toHaveLength(32);
    expect(validateDesign(d).ok).toBe(true);
  });

  test("validateDesign flags a hand-built aliased design", () => {
    const bad = {
      factors: TWO_FACTOR,
      variants: [
        { routing: "static", cut: 0.1 },
        { routing: "dynamic", cut: 0.1 },
      ],
      fullCount: 4,
      fraction: 2,
    };
    const v = validateDesign(bad);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain('"cut"');
  });
});

describe("variantId round-trip (Defect 3)", () => {
  const hostile: Factor[] = [
    { name: "duration", levels: ["5 min", "10 min"] },
    { name: "mode", levels: ["read-only", "read_write"] },
    { name: "tif", levels: ["good_till_canceled", "day"] },
  ];

  test("hostile levels survive a round-trip", () => {
    const v: Variant = {
      duration: "5 min",
      mode: "read-only",
      tif: "good_till_canceled",
    };
    const id = variantId(v);
    expect(parseVariantId(id, hostile)).toEqual(v);
    expect(parseVariantId(id, ["duration", "mode", "tif"])).toEqual(v);
  });

  test("separator collision: level containing '|' is safe", () => {
    const f: Factor[] = [{ name: "tag", levels: ["a|b", "c"] }];
    const v = { tag: "a|b" };
    expect(parseVariantId(variantId(v), f)).toEqual(v);
  });

  test("numeric normalization: 0.1 and '0.10' unify", () => {
    expect(variantId({ cut: 0.1 })).toBe(variantId({ cut: "0.10" }));
    expect(variantId({ cut: 0.15 })).not.toBe(variantId({ cut: 0.1 }));
  });

  test("parse maps numeric strings back to original number levels", () => {
    const id = variantId({ cut: 0.1, routing: "static" });
    const back = parseVariantId(id, TWO_FACTOR);
    expect(back).toEqual({ cut: 0.1, routing: "static" });
    expect(typeof back!.cut).toBe("number");
  });

  test("deterministic regardless of key order", () => {
    expect(variantId({ b: 2, a: 1 })).toBe(variantId({ a: 1, b: 2 }));
  });
});

describe("assignBalanced (unchanged behavior)", () => {
  test("idempotent per partner", () => {
    const db = emptyDb();
    const a1 = assignBalanced(db, "exp", "partner-1", TWO_FACTOR);
    const a2 = assignBalanced(db, "exp", "partner-1", TWO_FACTOR);
    expect(a2.variantId).toBe(a1.variantId);
  });

  test("even distribution across variants", () => {
    const db = emptyDb();
    const counts = new Map<string, number>();
    for (let i = 0; i < 8; i++) {
      const a = assignBalanced(db, "exp", `partner-${i}`, TWO_FACTOR);
      counts.set(a.variantId, (counts.get(a.variantId) ?? 0) + 1);
    }
    expect(counts.size).toBe(4);
    for (const c of counts.values()) expect(c).toBe(2);
  });
});

describe("analyzeFactorial — mains, inference, warnings (Defect 4)", () => {
  test("throws on empty metrics", () => {
    const db = emptyDb();
    expect(() => analyzeFactorial(db, "exp", TWO_FACTOR)).toThrow();
  });

  test("strong planted effect is detected and significant after BH", () => {
    const db = emptyDb();
    const rng = lcg(42);
    const draw = (p: number, n: number) =>
      Array.from({ length: n }, () => (rng() < p ? 1 : 0));
    record(db, "exp", { routing: "static", cut: 0.1 }, draw(0.8, 100));
    record(db, "exp", { routing: "static", cut: 0.15 }, draw(0.8, 100));
    record(db, "exp", { routing: "dynamic", cut: 0.1 }, draw(0.2, 100));
    record(db, "exp", { routing: "dynamic", cut: 0.15 }, draw(0.2, 100));
    const r = analyzeFactorial(db, "exp", TWO_FACTOR);
    const stat = r.mainEffects.find((m) => m.factor === "routing" && m.level === "static")!;
    expect(stat.effect).toBeGreaterThan(0.2);
    expect(stat.n).toBe(200);
    expect(stat.qValue).toBeLessThan(0.05);
    expect(stat.significant).toBe(true);
    const dyn = r.mainEffects.find((m) => m.factor === "routing" && m.level === "dynamic")!;
    expect(dyn.effect).toBeLessThan(-0.2);
    expect(r.warnings).toEqual([]);
  });

  test("pure-noise seeded data flags nothing after BH", () => {
    const db = emptyDb();
    const rng = lcg(7);
    const d = generateDesign(THREE_FACTOR);
    for (const v of d.variants) {
      record(db, "exp", v, Array.from({ length: 60 }, () => (rng() < 0.5 ? 1 : 0)));
    }
    const r = analyzeFactorial(db, "exp", THREE_FACTOR);
    const all = [...r.mainEffects, ...r.interactions];
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) expect(e.significant).toBe(false);
    for (const e of all) {
      expect(e.qValue).toBeGreaterThanOrEqual(e.pValue - 1e-12);
    }
  });

  test("warns on small-n cells", () => {
    const db = emptyDb();
    record(db, "exp", { routing: "static", cut: 0.1 }, [1, 0, 1, 0, 1]);
    record(db, "exp", { routing: "dynamic", cut: 0.15 }, [0, 1, 0, 1, 0]);
    const r = analyzeFactorial(db, "exp", TWO_FACTOR);
    expect(r.warnings.some((w) => w.includes("n=5 < 30"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("no observations"))).toBe(true);
  });
});

describe("analyzeFactorial — cell-keyed interactions and honest R² (Defect 2)", () => {
  // Hand-computed fixture (2×2, n=2 per cell, N=8):
  //   cells:            (static,0.1):[1,1]  (static,0.15):[1,0]
  //                     (dynamic,0.1):[0,1] (dynamic,0.15):[1,1]
  //   cell rates: 1, 0.5, 0.5, 1  →  grand mean = 6/8 = 0.75
  //   mains: static (1+0.5)/2=0.75→0, dynamic 0.75→0, cut0.1 0.75→0, cut0.15 0.75→0
  //   interactions: (static,0.1): 1-0.75=+0.25; (static,0.15): 0.5-0.75=-0.25;
  //                 (dynamic,0.1): -0.25;      (dynamic,0.15): +0.25
  //   predictions == cell rates → residuals only in the two mixed cells:
  //   ssRes = 4×0.25 = 1;  ssTot = 6×0.0625 + 2×0.5625 = 1.5
  //   R² = 1 − 1/1.5 = 1/3
  test("known interaction fixture: levels stored, effects ±0.25, R² = 1/3", () => {
    const db = emptyDb();
    record(db, "exp", { routing: "static", cut: 0.1 }, [1, 1]);
    record(db, "exp", { routing: "static", cut: 0.15 }, [1, 0]);
    record(db, "exp", { routing: "dynamic", cut: 0.1 }, [0, 1]);
    record(db, "exp", { routing: "dynamic", cut: 0.15 }, [1, 1]);
    const r = analyzeFactorial(db, "exp", TWO_FACTOR);
    expect(r.grandMean).toBeCloseTo(0.75, 12);
    expect(r.interactions).toHaveLength(4);
    const key = (ix: (typeof r.interactions)[number]) =>
      `${String(ix.levels[0])}|${String(ix.levels[1])}`;
    const byCell = new Map(r.interactions.map((ix) => [key(ix), ix]));
    expect(byCell.get("static|0.1")!.effect).toBeCloseTo(0.25, 12);
    expect(byCell.get("static|0.15")!.effect).toBeCloseTo(-0.25, 12);
    expect(byCell.get("dynamic|0.1")!.effect).toBeCloseTo(-0.25, 12);
    expect(byCell.get("dynamic|0.15")!.effect).toBeCloseTo(0.25, 12);
    for (const ix of r.interactions) {
      expect(ix.factors).toEqual(["routing", "cut"]);
      expect(ix.n).toBe(2);
    }
    expect(r.rSquared).toBeCloseTo(1 / 3, 12);
  });

  // Saturated deterministic cells: predictions equal outcomes exactly → R² = 1.
  test("perfectly separable cells give R² = 1", () => {
    const db = emptyDb();
    record(db, "exp", { routing: "static", cut: 0.1 }, [1, 1]);
    record(db, "exp", { routing: "static", cut: 0.15 }, [0, 0]);
    record(db, "exp", { routing: "dynamic", cut: 0.1 }, [0, 0]);
    record(db, "exp", { routing: "dynamic", cut: 0.15 }, [0, 0]);
    const r = analyzeFactorial(db, "exp", TWO_FACTOR);
    expect(r.rSquared).toBeCloseTo(1, 12);
  });

  // Additive-only fixture (2×2, n=2 per cell, N=8):
  //   cell rates 1, 0.5, 0.5, 0 → gm 0.5; mains ±0.25; interactions all 0.
  //   ssRes = 4×0.25 = 1; ssTot = 8×0.25 = 2 → R² = 0.5 (not inflated by
  //   phantom interactions — the Defect-2 engine summed duplicates here).
  test("additive fixture: no phantom interactions, R² = 0.5", () => {
    const db = emptyDb();
    record(db, "exp", { routing: "static", cut: 0.1 }, [1, 1]);
    record(db, "exp", { routing: "static", cut: 0.15 }, [1, 0]);
    record(db, "exp", { routing: "dynamic", cut: 0.1 }, [1, 0]);
    record(db, "exp", { routing: "dynamic", cut: 0.15 }, [0, 0]);
    const r = analyzeFactorial(db, "exp", TWO_FACTOR);
    expect(r.interactions).toHaveLength(0);
    expect(r.rSquared).toBeCloseTo(0.5, 12);
  });
});
