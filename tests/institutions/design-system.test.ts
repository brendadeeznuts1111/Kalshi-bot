import { describe, expect, test } from "bun:test";
import {
  BRAND,
  DESIGN_SYSTEM_VERSION,
  TOKENS,
  baseCssVars,
  tokenPaths,
  tokenValues,
} from "../../src/institutions/design-tokens.ts";
import { HQ_COMPONENTS, badge, dataTable, statCard } from "../../src/institutions/hq-ui.ts";
import { DesignAgent } from "../../src/agent/design-agent.ts";

describe("design tokens", () => {
  test("version is semver", () => {
    expect(DESIGN_SYSTEM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  test("colors are valid hex/rgba (nested groups included)", () => {
    const walk = (obj: Record<string, unknown>) => {
      for (const v of Object.values(obj)) {
        if (typeof v === "string") {
          expect(v).toMatch(/^(#[0-9a-f]{6}|rgba\()/i);
        } else {
          walk(v as Record<string, unknown>);
        }
      }
    };
    walk(TOKENS.color as Record<string, unknown>);
  });
  test("tokenPaths/tokenValues cover the tree", () => {
    expect(tokenPaths()).toContain("color.bg");
    expect(tokenValues()).toContain(TOKENS.color.acc);
  });
  test("baseCssVars emits token values", () => {
    const css = baseCssVars();
    expect(css).toContain(`--acc: ${TOKENS.color.acc}`);
    expect(css).toContain(`--bg: ${TOKENS.color.bg}`);
  });
});

describe("hq-ui components", () => {
  test("registry entries are semver", () => {
    for (const v of Object.values(HQ_COMPONENTS)) {
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
  test("badge escapes text and sets tone", () => {
    const html = badge("warn", "<b>stale</b>");
    expect(html).toContain('class="badge warn"');
    expect(html).not.toContain("<b>");
  });
  test("statCard renders value/unit/metrics", () => {
    const html = statCard({
      title: "Balance",
      value: "$12.34",
      unit: "usd",
      metrics: [{ label: "status", value: "ok" }],
    });
    expect(html).toContain("$12.34");
    expect(html).toContain("Balance");
    expect(html).toContain("card-metric-label");
  });
  test("dataTable renders empty state and numeric columns", () => {
    expect(dataTable([{ label: "A" }], [], "nothing")).toContain("nothing");
    const html = dataTable([{ label: "N", num: true }], [[5]]);
    expect(html).toContain('<td class="num">5</td>');
  });
});

describe("design agent", () => {
  const agent = new DesignAgent();
  test("manifest carries version, brand, components", () => {
    const m = agent.manifest();
    expect(m.version).toBe(DESIGN_SYSTEM_VERSION);
    expect(m.brand).toBe(BRAND);
    expect(m.components.badge).toBe("1.0.0");
  });
  test("audit passes token-compliant HTML", () => {
    const ok = agent.audit(`<div style="color:${TOKENS.color.acc}">x</div>`);
    expect(ok.ok).toBe(true);
  });
  test("audit flags hardcoded colors", () => {
    const bad = agent.audit('<div style="color:#ff00ff">x</div>');
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]!.kind).toBe("hardcoded-color");
    expect(bad.issues[0]!.value).toBe("#ff00ff");
  });
});
