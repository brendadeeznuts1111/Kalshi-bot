// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/hashing#bun-hash
/**
 * Factorial engine — multi-factor experiment design, balanced assignment, analysis.
 *
 * Variant IDs are reversible `factor=level&…` strings (sorted keys), not positional `_` splits.
 */
import type { Database } from "bun:sqlite";

export type Factor = {
  name: string;
  levels: (string | number)[];
};

/** One design cell — one level per factor. */
export type Variant = Record<string, string | number>;

export type FactorialDesign = {
  factors: Factor[];
  variants: Variant[];
  fullCount: number;
  fraction: number;
  /** How variants were chosen when fraction > 1. */
  method?: "full" | "resolution-half" | "naive-subsample";
};

export type FactorialAssignment = {
  variant: Variant;
  variantId: string;
};

export type MainEffect = {
  factor: string;
  level: string | number;
  effect: number;
  n: number;
};

export type InteractionEffect = {
  factors: [string, string];
  levels: [string | number, string | number];
  effect: number;
};

export type FactorialResult = {
  experimentId: string;
  totalObservations: number;
  grandMean: number;
  mainEffects: MainEffect[];
  interactions: InteractionEffect[];
  rSquared: number;
};

function cartesianProduct(factors: Factor[]): Variant[] {
  if (factors.length === 0) return [{}];
  const [first, ...rest] = factors;
  const sub = cartesianProduct(rest);
  const out: Variant[] = [];
  for (const level of first!.levels) {
    for (const s of sub) {
      out.push({ ...s, [first!.name]: level });
    }
  }
  return out;
}

/** All factors exactly two levels (binary DOE). */
export function isAllBinaryTwoLevel(factors: Factor[]): boolean {
  return factors.length >= 2 && factors.every((f) => f.levels.length === 2);
}

function levelSign(level: string | number, levels: (string | number)[]): -1 | 1 {
  const idx = levels.findIndex((l) => String(l) === String(level));
  return idx <= 0 ? -1 : 1;
}

function signToLevel(sign: -1 | 1, levels: (string | number)[]): string | number {
  return sign === -1 ? levels[0]! : levels[1]!;
}

/**
 * 2^(k−1) half-replicate for k binary factors.
 * Generator: last factor = product of all others (Resolution IV when k ≥ 4).
 */
export function generateHalfFraction2k(factors: Factor[]): Variant[] {
  if (!isAllBinaryTwoLevel(factors)) {
    throw new Error("half fraction requires ≥2 binary (2-level) factors");
  }
  const base = factors.slice(0, -1);
  const generated = factors[factors.length - 1]!;
  const partials = cartesianProduct(base);

  return partials.map((partial) => {
    let productSign: -1 | 1 = 1;
    for (const f of base) {
      productSign = (productSign * levelSign(partial[f.name]!, f.levels)) as -1 | 1;
    }
    return {
      ...partial,
      [generated.name]: signToLevel(productSign, generated.levels),
    };
  });
}

/** Defining relation check: generated factor sign = product of base factor signs. */
export function satisfiesHalfFractionRelation(
  variant: Variant,
  factors: Factor[],
): boolean {
  if (factors.length < 2) return true;
  const base = factors.slice(0, -1);
  const generated = factors[factors.length - 1]!;
  let productSign: -1 | 1 = 1;
  for (const f of base) {
    productSign = (productSign * levelSign(variant[f.name]!, f.levels)) as -1 | 1;
  }
  const genSign = levelSign(variant[generated.name]!, generated.levels);
  return productSign === genSign;
}

/** Reversible variant key — sorted factor names, URL-encoded levels. */
export function variantId(v: Variant): string {
  return Object.entries(v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`)
    .join("&");
}

/** Decode a variant id produced by {@link variantId}. */
export function parseVariantId(id: string, factors: Factor[]): Variant | null {
  const params = new URLSearchParams(id);
  const out: Variant = {};
  for (const f of factors) {
    const raw = params.get(f.name);
    if (raw == null) return null;
    const level = f.levels.find((l) => String(l) === raw);
    if (level === undefined) {
      const asNum = Number(raw);
      if (f.levels.some((l) => l === asNum)) {
        out[f.name] = asNum;
        continue;
      }
      out[f.name] = raw;
    } else {
      out[f.name] = level;
    }
  }
  return out;
}

/**
 * Full (or fractional) factorial design.
 * When fraction=2 and all factors are binary 2-level, uses a Resolution-IV half-replicate
 * (generator: last factor = product of others). Otherwise falls back to naive subsample.
 */
export function generateDesign(factors: Factor[], fraction = 1): FactorialDesign {
  if (factors.length === 0) throw new Error("at least one factor required");
  for (const f of factors) {
    if (f.levels.length < 2) throw new Error(`factor "${f.name}" must have ≥2 levels`);
  }

  const full = cartesianProduct(factors);
  const fullCount = full.length;

  if (fraction < 1) throw new Error("fraction must be ≥1");
  if (fraction > fullCount) {
    throw new Error(`fraction ${fraction} exceeds full design count ${fullCount}`);
  }

  if (fraction === 1) {
    return { factors, variants: full, fullCount, fraction: 1, method: "full" };
  }

  if (fraction === 2 && isAllBinaryTwoLevel(factors)) {
    const variants = generateHalfFraction2k(factors);
    return { factors, variants, fullCount, fraction: 2, method: "resolution-half" };
  }

  const step = Math.max(1, Math.floor(fullCount / Math.ceil(fullCount / fraction)));
  const variants: Variant[] = [];
  for (let i = 0; i < fullCount; i += step) {
    variants.push(full[i]!);
  }

  return { factors, variants, fullCount, fraction, method: "naive-subsample" };
}

/** Assign partner to least-used variant; idempotent per (experiment, partner). */
export function assignBalanced(
  db: Database,
  experimentId: string,
  partnerId: string,
  factors: Factor[],
  design?: FactorialDesign,
): FactorialAssignment {
  const d = design ?? generateDesign(factors);

  const existing = db
    .query(
      "SELECT variant_id FROM experiment_assignments WHERE experiment_id=$e AND partner_id=$p",
    )
    .get({ $e: experimentId, $p: partnerId }) as { variant_id: string } | null;
  if (existing) {
    const v = parseVariantId(existing.variant_id, d.factors) ?? d.variants.find(
      (vv) => variantId(vv) === existing.variant_id,
    );
    if (v) return { variant: v, variantId: existing.variant_id };
  }

  const counts = new Map<string, number>();
  for (const v of d.variants) {
    const vid = variantId(v);
    const row = db
      .query(
        `SELECT COUNT(*) AS c FROM experiment_assignments
         WHERE experiment_id = $e AND variant_id = $v`,
      )
      .get({ $e: experimentId, $v: vid }) as { c: number };
    counts.set(vid, row.c);
  }

  const minCount = Math.min(...counts.values());
  const tied = d.variants.filter((v) => counts.get(variantId(v)) === minCount);
  const chosen =
    tied.length === 1
      ? tied[0]!
      : tied.sort(
          (a, b) =>
            Bun.hash.crc32(`${experimentId}:${partnerId}:${variantId(a)}`) -
            Bun.hash.crc32(`${experimentId}:${partnerId}:${variantId(b)}`),
        )[0]!;

  const vid = variantId(chosen);

  db.query(
    `INSERT OR IGNORE INTO experiment_assignments (experiment_id, partner_id, variant_id, assigned_at)
     VALUES ($e, $p, $v, datetime('now'))`,
  ).run({ $e: experimentId, $p: partnerId, $v: vid });

  return { variant: chosen, variantId: vid };
}

/** Binary outcome metrics in `experiment_metrics` (1 win / 0 loss). */
export function analyzeFactorial(
  db: Database,
  experimentId: string,
  factors: Factor[],
): FactorialResult {
  const metrics = db
    .query(
      `SELECT m.variant_id, m.outcome
       FROM experiment_metrics m
       WHERE m.experiment_id = $e`,
    )
    .all({ $e: experimentId }) as { variant_id: string; outcome: number }[];

  if (metrics.length === 0) {
    throw new Error("no metrics recorded for this experiment");
  }

  const parsed = metrics.map((m) => {
    const levels = parseVariantId(m.variant_id, factors);
    if (!levels) throw new Error(`invalid variant_id: ${m.variant_id}`);
    return { outcome: m.outcome, levels };
  });

  const totalN = parsed.length;
  const grandMean = parsed.reduce((s, p) => s + p.outcome, 0) / totalN;

  const mainEffects: MainEffect[] = [];
  for (const f of factors) {
    for (const level of f.levels) {
      const subset = parsed.filter((p) => String(p.levels[f.name]) === String(level));
      if (subset.length === 0) continue;
      const rate = subset.reduce((s, p) => s + p.outcome, 0) / subset.length;
      mainEffects.push({
        factor: f.name,
        level,
        effect: rate - grandMean,
        n: subset.length,
      });
    }
  }

  const interactions: InteractionEffect[] = [];
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const fa = factors[i]!;
      const fb = factors[j]!;
      const aMain = mainEffects.filter((m) => m.factor === fa.name);
      const bMain = mainEffects.filter((m) => m.factor === fb.name);

      for (const aLevel of fa.levels) {
        for (const bLevel of fb.levels) {
          const subset = parsed.filter(
            (p) =>
              String(p.levels[fa.name]) === String(aLevel) &&
              String(p.levels[fb.name]) === String(bLevel),
          );
          if (subset.length === 0) continue;
          const observedRate = subset.reduce((s, p) => s + p.outcome, 0) / subset.length;
          const aEff = aMain.find((m) => String(m.level) === String(aLevel))?.effect ?? 0;
          const bEff = bMain.find((m) => String(m.level) === String(bLevel))?.effect ?? 0;
          const expected = grandMean + aEff + bEff;
          const interaction = observedRate - expected;
          if (Math.abs(interaction) > 1e-6) {
            interactions.push({
              factors: [fa.name, fb.name],
              levels: [aLevel, bLevel],
              effect: interaction,
            });
          }
        }
      }
    }
  }

  const interactionForCell = (levels: Record<string, string | number>): number => {
    let sum = 0;
    for (const ix of interactions) {
      const [fa, fb] = ix.factors;
      if (
        String(levels[fa]) === String(ix.levels[0]) &&
        String(levels[fb]) === String(ix.levels[1])
      ) {
        sum += ix.effect;
      }
    }
    return sum;
  };

  const predicted = parsed.map((p) => {
    let pred = grandMean;
    for (const me of mainEffects) {
      if (String(p.levels[me.factor]) === String(me.level)) pred += me.effect;
    }
    pred += interactionForCell(p.levels);
    return pred;
  });

  const ssTotal = parsed.reduce((s, p) => s + (p.outcome - grandMean) ** 2, 0);
  const ssResidual = parsed.reduce((s, p, i) => s + (p.outcome - predicted[i]!) ** 2, 0);
  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  return {
    experimentId,
    totalObservations: totalN,
    grandMean,
    mainEffects,
    interactions,
    rSquared,
  };
}
