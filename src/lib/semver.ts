/**
 * semver.ts — the repo's version-handling SSOT (Bun.semver + normalization).
 *
 * Bun.semver has two functions only (satisfies, order — verified on 1.4.0)
 * and both are inconsistent/hazardous on ragged input:
 *   - order("1.4","1.4.0") === 1  (missing components are treated as LARGER)
 *   - order("garbage", ...) THROWS (documented in bun-types, omitted in the
 *     guide — AGENT-PITFALLS §148)
 *   - satisfies("1.4","^1.4.0") === false (ragged versions rejected, even
 *     though partial RANGES like ~1.4 / ^1.4 work)
 * So: normalize to major.minor.patch BEFORE calling Bun.semver. Never
 * hand-roll version loops; Bun.semver owns comparisons (§147-§149).
 */

/** Strip a leading v + pad a ragged version to major.minor.patch.
 *  "1.4" -> "1.4.0", "v2" -> "2.0.0". Null for garbage (non-numeric
 *  segments, prerelease, >3 segments). */
export function normalizeSemver(v: string): string | null {
  const segs = v.trim().replace(/^v/i, "").split(".");
  if (segs.length === 0 || segs.length > 3) return null;
  const parts: number[] = [];
  for (const seg of segs) {
    if (!/^\d+$/.test(seg)) return null;
    parts.push(Number(seg));
  }
  while (parts.length < 3) parts.push(0);
  return parts.join(".");
}

/** Leading numeric core as a triple — for major/minor/patch classification
 *  (deps:outdated). "2.1.0-beta.1" -> [2,1,0]; no leading triple -> null. */
export function semverCore(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** "release version > indexed version" — Bun.semver.order after
 *  normalization (Bun.semver SSOT, same as assertBunAtLeast). */
export function versionGt(a: string, b: string): boolean {
  const na = normalizeSemver(a);
  const nb = normalizeSemver(b);
  if (na === null || nb === null) return false;
  try {
    return Bun.semver.order(na, nb) > 0;
  } catch {
    return false;
  }
}

/**
 * Known Bun 1.4.0 quirk (pinned so an upgrade that fixes it surfaces in
 * tests): satisfies with the "!=" comparator returns TRUE even for a
 * version that equals the range ("1.0.0" != "1.0.0" -> true, "1.2.0"
 * != "1.x" -> true). The negation is effectively ignored. Recorded in
 * AGENT-PITFALLS §149. Avoid "!=" in ranges; express as ">=x <y" or "||".
 */
export const SEMVER_NEQ_QUIRK_1_4 = true;
