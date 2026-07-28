// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/hashing#bun-hash
/**
 * Factorial engine — multi-factor experiment design, balanced assignment, analysis.
 *
 * Fixes vs the audited revision:
 *  1. Fractional designs use a greedy orthogonal selector + validation instead of
 *     stride sampling (stride aliased whole factors — their effects were unestimable).
 *  2. Interactions are cell-keyed ({factors, levels, effect, n}) and the R² prediction
 *     only adds an interaction to rows matching BOTH levels (was: summed per pair).
 *  3. Variant IDs are reversible: encodeURIComponent(level) joined by "|" with numeric
 *     canonicalization, so 0.10 and "0.10" unify and "_"/space/hyphen levels survive.
 *  4. Every reported effect carries n / se / z / pValue, Benjamini-Hochberg qValue
 *     across mains + interactions together, and a significance flag; result includes
 *     warnings[] for small-n cells, empty cells, and extreme grand means.
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
};

export type FactorialAssignment = {
  variant: Variant;
  variantId: string;
};

export type EffectStats = {
  n: number;
  se: number;
  z: number;
  pValue: number;
  /** Benjamini-Hochberg adjusted p, computed across mains + interactions together. */
  qValue: number;
  significant: boolean;
};

export type MainEffect = {
  factor: string;
  level: string | number;
  /** Cell rate minus grand mean (raw deviation, kept for continuity). */
  effect: number;
} & EffectStats;

export type InteractionEffect = {
  factors: [string, string];
  levels: [string | number, string | number];
  /** Observed cell rate minus the additive-model expectation. */
  effect: number;
} & EffectStats;

export type FactorialResult = {
  experimentId: string;
  totalObservations: number;
  grandMean: number;
  mainEffects: MainEffect[];
  interactions: InteractionEffect[];
  rSquared: number;
  /** Adjusted for parameter count; equals rSquared when n ≤ k+1 (no df left). */
  adjustedRSquared: number;
  warnings: string[];
};

export type DesignValidation = {
  ok: boolean;
  problems: string[];
};

/* ------------------------------------------------------------------ helpers */

/** Canonical level key: numeric-looking levels normalize via String(Number(x)). */
function canonical(level: string | number): string {
  if (typeof level === "number") return String(level);
  const t = level.trim();
  if (t !== "" && !Number.isNaN(Number(t))) return String(Number(t));
  return level;
}

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

/* ------------------------------------------------------------ variant IDs */

/**
 * Reversible variant ID: `key=encodeURIComponent(level)` pairs (sorted keys)
 * joined by "|". encodeURIComponent escapes "|" inside values, so the separator
 * is unambiguous; "_" and "-" pass through harmlessly (we never split on them).
 */
export function variantId(v: Variant): string {
  return Object.entries(v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(canonical(val))}`)
    .join("|");
}

/**
 * Decode an ID produced by {@link variantId}. Accepts Factor[] (maps back to the
 * factor's original level values, preserving number vs string) or plain names.
 * Returns null when any factor is missing from the ID.
 */
export function parseVariantId(
  id: string,
  factors: Factor[] | string[],
): Variant | null {
  const parts = new Map<string, string>();
  for (const piece of id.split("|")) {
    const eq = piece.indexOf("=");
    if (eq < 0) return null;
    parts.set(
      decodeURIComponent(piece.slice(0, eq)),
      decodeURIComponent(piece.slice(eq + 1)),
    );
  }
  const out: Variant = {};
  for (const f of factors) {
    const name = typeof f === "string" ? f : f.name;
    const raw = parts.get(name);
    if (raw == null) return null;
    if (typeof f !== "string") {
      const original = f.levels.find((l) => canonical(l) === raw);
      out[name] = original !== undefined ? original : raw;
    } else {
      out[name] = raw;
    }
  }
  return out;
}

/* ------------------------------------------------------- design generation */

/** Pairwise coverage key for one (factor, level) pair-combination. */
function pairKey(fa: string, la: string | number, fb: string, lb: string | number): string {
  return `${fa}${canonical(la)}${fb}${canonical(lb)}`;
}

function pairKeysOf(v: Variant, factorNames: string[]): string[] {
  const keys: string[] = [];
  for (let i = 0; i < factorNames.length; i++) {
    for (let j = i + 1; j < factorNames.length; j++) {
      keys.push(pairKey(factorNames[i]!, v[factorNames[i]!]!, factorNames[j]!, v[factorNames[j]!]!));
    }
  }
  return keys;
}

/**
 * Validate a design for estimability. Every factor must show ≥2 distinct levels;
 * fractional designs must also show ≥3 distinct level-combinations for every
 * factor pair (or all combinations when fewer than 3 are possible).
 */
export function validateDesign(design: FactorialDesign): DesignValidation {
  const problems: string[] = [];
  const { factors, variants, fraction } = design;
  if (variants.length === 0) {
    return { ok: false, problems: ["design has no variants"] };
  }
  for (const f of factors) {
    const seen = new Set(variants.map((v) => canonical(v[f.name]!)));
    if (seen.size < 2) {
      problems.push(
        `factor "${f.name}" has only ${seen.size} distinct level(s) — main effect unestimable`,
      );
    }
  }
  if (fraction > 1) {
    for (let i = 0; i < factors.length; i++) {
      for (let j = i + 1; j < factors.length; j++) {
        const fa = factors[i]!;
        const fb = factors[j]!;
        const possible = fa.levels.length * fb.levels.length;
        const required = Math.min(3, possible);
        const seen = new Set(
          variants.map((v) => pairKey(fa.name, v[fa.name]!, fb.name, v[fb.name]!)),
        );
        if (seen.size < required) {
          problems.push(
            `factor pair "${fa.name}"×"${fb.name}" shows ${seen.size}/${possible} ` +
              `level-combinations (< ${required}) — interaction aliased`,
          );
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Full or fractional factorial design.
 * fraction=1 → full cartesian product (unchanged behavior).
 * fraction=f → greedy orthogonal selection of ceil(fullCount/f) variants that
 * maximizes pairwise level-combination coverage, followed by a swap-repair pass
 * and hard validation. Throws naming the unestimable factors rather than ever
 * returning a silently aliased design.
 */
export function generateDesign(factors: Factor[], fraction = 1): FactorialDesign {
  if (factors.length === 0) throw new Error("at least one factor required");
  for (const f of factors) {
    if (f.levels.length < 2) throw new Error(`factor "${f.name}" must have ≥2 levels`);
  }
  if (fraction < 1) throw new Error("fraction must be ≥1");

  const full = cartesianProduct(factors);
  const fullCount = full.length;
  if (fraction > fullCount) {
    throw new Error(`fraction ${fraction} exceeds full design count ${fullCount}`);
  }
  if (fraction === 1) return { factors, variants: full, fullCount, fraction };

  const target = Math.max(2, Math.ceil(fullCount / fraction));
  const names = factors.map((f) => f.name);
  const coveredPairs = new Set<string>();
  const coveredLevels = new Set<string>();
  const chosenIdx: number[] = [];
  const used = new Array<boolean>(fullCount).fill(false);

  // Greedy: repeatedly add the candidate covering the most new pair-combos
  // (tie-broken by new levels, then cartesian order — fully deterministic).
  for (let pick = 0; pick < target; pick++) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < fullCount; i++) {
      if (used[i]) continue;
      const v = full[i]!;
      let newPairs = 0;
      for (const k of pairKeysOf(v, names)) if (!coveredPairs.has(k)) newPairs++;
      let newLevels = 0;
      for (const f of factors) {
        if (!coveredLevels.has(`${f.name}${canonical(v[f.name]!)}`)) newLevels++;
      }
      const score = newPairs * 10 + newLevels;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    used[best] = true;
    chosenIdx.push(best);
    const v = full[best]!;
    for (const k of pairKeysOf(v, names)) coveredPairs.add(k);
    for (const f of factors) coveredLevels.add(`${f.name}${canonical(v[f.name]!)}`);
  }

  // Swap-repair: trade selected variants for unselected ones while total
  // pair-coverage (then level coverage) improves. Bounded and deterministic.
  const coverageOf = (idxs: number[]): number => {
    const s = new Set<string>();
    for (const i of idxs) for (const k of pairKeysOf(full[i]!, names)) s.add(k);
    return s.size;
  };
  let current = coverageOf(chosenIdx);
  for (let iter = 0; iter < 200; iter++) {
    let improved = false;
    for (let s = 0; s < chosenIdx.length && !improved; s++) {
      for (let c = 0; c < fullCount && !improved; c++) {
        if (used[c]) continue;
        const trial = chosenIdx.slice();
        trial[s] = c;
        const score = coverageOf(trial);
        if (score > current) {
          used[chosenIdx[s]!] = false;
          used[c] = true;
          chosenIdx[s] = c;
          current = score;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const variants = chosenIdx.map((i) => full[i]!);
  const design: FactorialDesign = { factors, variants, fullCount, fraction };
  const validation = validateDesign(design);
  if (!validation.ok) {
    throw new Error(
      `fractional design (1/${fraction} of ${fullCount}) is aliased; ` +
        `reduce fraction or levels: ${validation.problems.join("; ")}`,
    );
  }
  return design;
}

/* ------------------------------------------------------------- assignment */

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
    const v =
      parseVariantId(existing.variant_id, d.factors) ??
      d.variants.find((vv) => variantId(vv) === existing.variant_id);
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

/* --------------------------------------------------------------- statistics */

/** Abramowitz–Stegun 7.1.26 erf approximation (|ε| ≤ 1.5e-7). */
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function twoSidedP(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

const P_EPS = 1e-9;

/** Binomial two-sample SE for a cell rate vs the rest of the sample. */
function twoSampleSE(pCell: number, nCell: number, pRest: number, nRest: number): number {
  const pc = Math.min(1 - P_EPS, Math.max(P_EPS, pCell));
  const pr = Math.min(1 - P_EPS, Math.max(P_EPS, pRest));
  const v = (pc * (1 - pc)) / Math.max(1, nCell) + (pr * (1 - pr)) / Math.max(1, nRest);
  return Math.sqrt(v);
}

function makeStats(effect: number, n: number, se: number): EffectStats {
  const z = se > 0 ? effect / se : 0;
  return { n, se, z, pValue: twoSidedP(z), qValue: 1, significant: false };
}

/** Benjamini-Hochberg across all supplied effects, in place. */
function applyBenjaminiHochberg(effects: EffectStats[]): void {
  const m = effects.length;
  if (m === 0) return;
  const order = effects
    .map((_, i) => i)
    .sort((a, b) => effects[a]!.pValue - effects[b]!.pValue);
  let prev = 1;
  for (let rank = m; rank >= 1; rank--) {
    const idx = order[rank - 1]!;
    const q = Math.min(prev, (effects[idx]!.pValue * m) / rank, 1);
    effects[idx]!.qValue = q;
    prev = q;
  }
  for (const e of effects) e.significant = e.qValue < 0.05;
}

/* ---------------------------------------------------------------- analysis */

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

  const warnings: string[] = [];
  const totalN = parsed.length;
  const grandMean = parsed.reduce((s, p) => s + p.outcome, 0) / totalN;
  if (grandMean < 0.05 || grandMean > 0.95) {
    warnings.push(
      `grand mean ${grandMean.toFixed(4)} near ${grandMean < 0.5 ? 0 : 1} — binomial SEs unreliable`,
    );
  }

  const rateOf = (rows: { outcome: number }[]): number =>
    rows.reduce((s, p) => s + p.outcome, 0) / rows.length;

  // Main effects: raw deviation from grand mean (continuity), two-sample SE
  // of cell-vs-rest for inference.
  const mainEffects: MainEffect[] = [];
  for (const f of factors) {
    for (const level of f.levels) {
      const inCell = parsed.filter((p) => canonical(p.levels[f.name]!) === canonical(level));
      if (inCell.length === 0) continue;
      const outCell = parsed.filter((p) => canonical(p.levels[f.name]!) !== canonical(level));
      const rate = rateOf(inCell);
      const restRate = outCell.length > 0 ? rateOf(outCell) : grandMean;
      const effect = rate - grandMean;
      const se = twoSampleSE(rate, inCell.length, restRate, outCell.length);
      mainEffects.push({ factor: f.name, level, effect, ...makeStats(effect, inCell.length, se) });
      if (inCell.length < 30) {
        warnings.push(`cell "${f.name}"=${String(level)} has n=${inCell.length} < 30`);
      }
    }
  }

  // Cell-keyed interactions: one record per (levelA, levelB) cell, so the R²
  // prediction can match rows on BOTH levels instead of summing per pair.
  const interactions: InteractionEffect[] = [];
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const fa = factors[i]!;
      const fb = factors[j]!;
      for (const aLevel of fa.levels) {
        for (const bLevel of fb.levels) {
          const inCell = parsed.filter(
            (p) =>
              canonical(p.levels[fa.name]!) === canonical(aLevel) &&
              canonical(p.levels[fb.name]!) === canonical(bLevel),
          );
          if (inCell.length === 0) continue;
          const observedRate = rateOf(inCell);
          const aEff =
            mainEffects.find(
              (m) => m.factor === fa.name && canonical(m.level) === canonical(aLevel),
            )?.effect ?? 0;
          const bEff =
            mainEffects.find(
              (m) => m.factor === fb.name && canonical(m.level) === canonical(bLevel),
            )?.effect ?? 0;
          const expected = grandMean + aEff + bEff;
          const effect = observedRate - expected;
          if (Math.abs(effect) <= 1e-9) continue;
          const outCell = parsed.filter(
            (p) =>
              !(
                canonical(p.levels[fa.name]!) === canonical(aLevel) &&
                canonical(p.levels[fb.name]!) === canonical(bLevel)
              ),
          );
          const restRate = outCell.length > 0 ? rateOf(outCell) : grandMean;
          const se = twoSampleSE(observedRate, inCell.length, restRate, outCell.length);
          interactions.push({
            factors: [fa.name, fb.name],
            levels: [aLevel, bLevel],
            effect,
            ...makeStats(effect, inCell.length, se),
          });
          if (inCell.length < 30) {
            warnings.push(
              `cell "${fa.name}"=${String(aLevel)} × "${fb.name}"=${String(bLevel)} has n=${inCell.length} < 30`,
            );
          }
        }
      }
    }
  }

  // Empty cells across the full factor cross (capped so huge crosses stay cheap).
  const fullCross = cartesianProduct(factors);
  if (fullCross.length <= 256) {
    const observed = new Set(parsed.map((p) => variantId(p.levels)));
    const empty = fullCross.filter((v) => !observed.has(variantId(v)));
    if (empty.length > 0) {
      warnings.push(`${empty.length} design cell(s) have no observations (e.g. ${variantId(empty[0]!)})`);
    }
  }

  applyBenjaminiHochberg([...mainEffects, ...interactions]);

  // R²: predict each row as grandMean + matching mains + matching cell
  // interactions ONLY (a pair's effect never leaks into non-matching rows).
  const predicted = parsed.map((p) => {
    let pred = grandMean;
    for (const me of mainEffects) {
      if (canonical(p.levels[me.factor]!) === canonical(me.level)) pred += me.effect;
    }
    for (const ix of interactions) {
      const [fa, fb] = ix.factors;
      if (
        canonical(p.levels[fa]!) === canonical(ix.levels[0]) &&
        canonical(p.levels[fb]!) === canonical(ix.levels[1])
      ) {
        pred += ix.effect;
      }
    }
    return pred;
  });

  const ssTotal = parsed.reduce((s, p) => s + (p.outcome - grandMean) ** 2, 0);
  const ssResidual = parsed.reduce((s, p, i) => s + (p.outcome - predicted[i]!) ** 2, 0);
  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
  const k = mainEffects.length + interactions.length;
  const denom = totalN - k - 1;
  const adjustedRSquared =
    denom > 0 ? 1 - ((1 - rSquared) * (totalN - 1)) / denom : rSquared;

  return {
    experimentId,
    totalObservations: totalN,
    grandMean,
    mainEffects,
    interactions,
    rSquared,
    adjustedRSquared,
    warnings,
  };
}
