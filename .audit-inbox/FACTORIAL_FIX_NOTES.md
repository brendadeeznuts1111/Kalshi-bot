# Factorial Engine Fix Notes

**Scope:** `.audit-inbox/factorial.ts` (fixed copy) + `.audit-inbox/factorial.test.ts` (new suite)
**Patch:** `.audit-inbox/factorial-fix.patch` — unified diff, apply with `git apply` or `patch -p1`.

> **Baseline note:** the path given in the audit (`/Users/nolarose/Projects/lib/operations/factorial.ts`,
> 302 LOC) does not exist on disk or in that repo's git history. The API-identical engine
> (`generateDesign` / `variantId` / `assignBalanced` / `analyzeFactorial`, same types) lives at
> `Kalshi-bot/src/operations/factorial.ts` (287 LOC), which was used as the read-only diff
> baseline. That revision already contained partial repairs for Defects 2–3 (levels stored on
> interactions; `k=v&…` IDs); the fixes below keep the repair intent, move to the spec'd
> `|`-joined encoding, and fix Defects 1 and 4 outright.

## Defect 1 — fractional design aliases factors (P0) → FIXED

- **Before:** stride sampling over the lexicographic cartesian product
  (`step = floor(fullCount / ceil(fullCount / fraction))`). 2×2 @ fraction 2 →
  `[A1B1, A2B1]` — factor B pinned constant, main effect unestimable, silently.
- **After:** greedy orthogonal selector — repeatedly adds the candidate covering the most
  new pairwise level-combinations (10× weight) then new levels, deterministic tie-break by
  cartesian order; then a bounded swap-repair pass (≤200 iterations) while total pair
  coverage improves. New exported `validateDesign(design) → {ok, problems[]}` checks every
  factor has ≥2 distinct levels and (fraction>1) every factor pair has ≥3 distinct
  level-combinations (or all combos when <3 possible). `generateDesign` runs validation and
  **throws naming the unestimable factors/pairs** rather than returning an aliased design.
- **Evidence:** 2×2×2 @ fraction 2 yields 4 runs with both levels of every factor present
  (validation ok); 2^7 @ fraction 4 yields 32 runs, validation ok; a hand-built aliased
  design is flagged with the offending factor named.

## Defect 2 — interaction analysis corrupts R² (P0) → FIXED (hardened)

- **Before (audited revision):** one record per factor *pair*, levels discarded; the R² loop
  added the pair effect to every row whose levels were "defined", summing duplicates into
  every prediction.
- **After:** interactions are cell-keyed — `{factors:[A,B], levels:[a,b], effect, n, …}` —
  and the R² prediction adds an interaction **only** to rows matching both levels.
  `adjustedRSquared` added (falls back to `rSquared` when n ≤ k+1).
- **Evidence:** hand-computed 2×2 fixture (cell rates 1, 0.5, 0.5, 1; pure interaction,
  all mains 0) → 4 interactions of exactly ±0.25 and **R² = 1/3** as computed by hand;
  additive fixture (rates 1, 0.5, 0.5, 0) → zero phantom interactions and **R² = 0.5**;
  separable cells → R² = 1.

## Defect 3 — variantId round-trip breaks (P1) → FIXED

- **Before (audited revision):** levels sanitized to `[a-zA-Z0-9.]` joined by `_`, parsed by
  positional split — `_`/space/hyphen levels corrupted silently; `0.10` vs `"0.10"` diverged.
- **After:** `key=encodeURIComponent(canonical(level))` pairs, sorted keys, joined by `|`
  (`encodeURIComponent` escapes `|` inside values, so the separator is unambiguous).
  Numeric canonicalization `String(Number(x))` at ID-build *and* analysis-compare time, so
  `0.1` and `"0.10"` unify. Exported `parseVariantId(id, factors | factorNames)` maps back to
  the factor's original level values (numbers stay numbers). Deterministic (key-sorted).
- **Evidence:** round-trips for `"5 min"`, `"read-only"`, `"good_till_canceled"`, and a level
  containing a literal `|`; `variantId({cut:0.1}) === variantId({cut:"0.10"})`.
- **Breaking note:** ID *format* changed (`&` → `|` separator, numeric normalization), so IDs
  written by the old engine won't parse — `assignBalanced` falls back to re-assignment for
  unparseable legacy rows (`INSERT OR IGNORE` keeps the old row intact).

## Defect 4 — no inferential statistics (P1) → FIXED

- **Before:** raw deviations only; noise reported as effects/interactions.
- **After:** every main effect and interaction carries `n`, `se` (binomial two-sample
  cell-vs-rest), `z`, `pValue` (two-sided normal, A&S erf approx), plus
  Benjamini-Hochberg `qValue` computed across mains + interactions **together** and
  `significant: qValue < 0.05`. Raw `effect` fields kept for continuity. New
  `warnings: string[]` on `FactorialResult`: cells with n < 30, empty design cells,
  grand mean within 0.05 of 0/1.
- **Evidence:** planted 0.8-vs-0.2 routing effect (n=200/level, LCG seed 42) → effect > 0.2,
  `significant: true`; pure-noise 2×2×2 (LCG seed 7, p=0.5, n=60/cell) → **zero** effects
  significant after BH; small-n fixture (n=5) emits both small-n and empty-cell warnings.

## Verification

- `bun test ./.audit-inbox/factorial.test.ts` → **20 pass / 0 fail** (103 expect calls),
  97.6% line coverage of the engine.
- `.audit-inbox/` added to `.gitignore` (confirmed via `git check-ignore`); nothing committed.

## API changes vs baseline

- **Added:** `validateDesign`, `EffectStats` type, `adjustedRSquared`, `warnings`,
  `n/se/z/pValue/qValue/significant` on effects, `levels` + `n` on `InteractionEffect`.
- **Changed:** `variantId` output format (`|`-joined, numerically canonical);
  `parseVariantId` now accepts `Factor[] | string[]`; `generateDesign(factors, fraction>1)`
  may now throw on infeasible fractions (by design, loudly).
- **Unchanged:** `Factor`, `Variant`, `FactorialDesign`, `FactorialAssignment`,
  `FactorialResult` (extended only), `generateDesign` full-factorial path, `assignBalanced`
  signature and balancing/idempotency semantics, `analyzeFactorial` signature.
