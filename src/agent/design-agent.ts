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
   * Flag hardcoded hex colors / px radii in HTML that are NOT token values.
   * Inline styles in generated markup are the usual offenders.
   */
  audit(html: string): DesignAudit {
    const legal = new Set(tokenValues().map((v) => v.toLowerCase()));
    const issues: DesignAuditIssue[] = [];

    for (const m of html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0].toLowerCase();
      if (!legal.has(hex)) {
        issues.push({
          kind: "hardcoded-color",
          value: m[0],
          detail: "color not in TOKENS — add a token or use a CSS var",
        });
      }
    }
    for (const m of html.matchAll(/border-radius:\s*([0-9]+px)/g)) {
      if (!legal.has(m[1].toLowerCase())) {
        issues.push({
          kind: "hardcoded-radius",
          value: m[1],
          detail: "radius not in TOKENS.radius — use a token value",
        });
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
