/**
 * Semantic color roles — venue / status maps validated against the palette.
 *
 * @see ./palette.ts
 */
import { COLORS, type ColorKey } from "./palette.ts";

export const COLOR_ROLES = {
  venue: {
    kalshi: "kalshi",
    polymarket: "polymarket",
    pinnacle: "pinnacle",
    betfair: "betfair",
    unknown: "unknown",
  },
  status: {
    healthy: "tennis",
    warning: "middleware",
    dangerous: "trading",
    discovery: "research",
    config: "env",
    neutral: "misc",
  },
  /** Aligns with `bun update -i` visual indicators */
  semver: {
    major: "semverMajor",
    minor: "semverMinor",
    patch: "semverPatch",
    selected: "selected",
  },
} as const satisfies Record<string, Record<string, ColorKey>>;

export type ColorRoleCategory = keyof typeof COLOR_ROLES;

for (const category of Object.values(COLOR_ROLES)) {
  for (const key of Object.values(category)) {
    if (!(key in COLORS)) {
      throw new Error(`Invalid ColorKey in role: ${key}`);
    }
  }
}

export function roleColor(
  category: ColorRoleCategory,
  role: string,
): ColorKey | undefined {
  const map = COLOR_ROLES[category] as Record<string, ColorKey>;
  return map[role];
}
