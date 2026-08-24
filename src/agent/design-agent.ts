/**
 * design-agent.ts — Design team agent: owns branding, design tokens, and the
 * versioned HQ component library.
 *
 * Capabilities:
 *   - manifest(): machine-readable design-system manifest (served at /api/design)
 *   - audit(html): token-compliance audit of rendered HTML — flags hardcoded
 *     hex colors / radii that bypass TOKENS (the "one vocabulary" rule)
 */

import {
  BRAND,
  DESIGN_SYSTEM_VERSION,
  TOKENS,
  baseCssVars,
  tokenPaths,
  tokenValues,
} from "../institutions/design-tokens.ts";
import { HQ_COMPONENTS, componentCss } from "../institutions/hq-ui.ts";

export type DesignAuditIssue = {
  kind: "hardcoded-color" | "hardcoded-radius" | "unknown-component";
  value: string;
  detail: string;
};

export type DesignAudit = {
  ok: boolean;
  version: string;
  issues: DesignAuditIssue[];
};

export type DesignManifest = {
  version: string;
  brand: typeof BRAND;
  tokens: typeof TOKENS;
  components: Record<string, string>;
  cssVars: string;
  componentCss: string;
};

export class DesignAgent {
  readonly role = "design";

  manifest(): DesignManifest {
    return {
      version: DESIGN_SYSTEM_VERSION,
      brand: BRAND,
      tokens: TOKENS,
      components: { ...HQ_COMPONENTS },
      cssVars: baseCssVars(),
      componentCss: componentCss(),
    };
  }

  /**
   * Flag hardcoded hex colors / rgba() literals / px radii that are NOT
   * token values. Accepts any number of surfaces (HTML, CSS, JS) so the
   * LIVE hq-app files are audited alongside generated templates.
   * 8-digit hex (#rrggbbaa) is normalized to its 6-digit base for legality;
   * rgba() literals are compared against token rgba values (tints, scrims).
   *
   * A trailing `{ legal: string[] }` options object adds extra
   * legal hex values — for DATA-DRIVEN colors (e.g. per-partner identity
   * hexes from the partner registry) that are not global design tokens.
   * UI chrome must still come from TOKENS; the allowlist is for values that
   * are by definition not part of the one vocabulary.
   */
  audit(...surfacesAndOpts: Array<string | { legal?: string[] }>): DesignAudit {
    const opts =
      surfacesAndOpts.find((s): s is { legal?: string[] } => typeof s !== "string") ?? {};
    const surfaces = surfacesAndOpts.filter((s): s is string => typeof s === "string");
    const legal = new Set([
      ...tokenValues().map((v) => v.toLowerCase()),
      ...(opts.legal ?? []).map((v) => v.toLowerCase()),
    ]);
    const issues: DesignAuditIssue[] = [];

    const add = (kind: DesignAuditIssue["kind"], value: string, detail: string) =>
      issues.push({ kind, value, detail });

    for (const html of surfaces) {
      for (const m of html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const raw = m[0].toLowerCase();
        let base = raw;
        if (raw.length === 9) {
          base = raw.slice(0, 7); // #rrggbbaa -> #rrggbb
        } else if (raw.length === 4) {
          // #rgb -> #rrggbb
          base = raw[0] + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3];
        }
        if (!legal.has(raw) && !legal.has(base)) {
          add("hardcoded-color", m[0], "color not in TOKENS — add a token or use a CSS var");
        }
      }
      for (const m of html.matchAll(/rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([.0-9]+)\s*\)/g)) {
        const rgba = `rgba(${m[1]},${m[2]},${m[3]},${m[4]})`;
        if (!legal.has(rgba)) {
          add("hardcoded-color", rgba, "rgba() not in TOKENS (tint/scrim) — add a token");
        }
      }
      for (const m of html.matchAll(/border-radius:\s*([0-9]+px)/g)) {
        if (!legal.has(m[1]!.toLowerCase())) {
          add("hardcoded-radius", m[1]!, "radius not in TOKENS.radius — use a token value");
        }
      }
    }

    // De-dupe repeated offenders
    const seen = new Set<string>();
    const unique = issues.filter((i) => {
      const k = `${i.kind}:${i.value}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return { ok: unique.length === 0, version: DESIGN_SYSTEM_VERSION, issues: unique };
  }
}

export const designAgent = new DesignAgent();
