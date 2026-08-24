// SSR + generated-CSS design surfaces: renderHq() stays under its size
// ceiling and the served /design-system.css (baseCssVars + componentCss) is
// token-compliant by construction. Mirrors the design:check gate.
// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { renderHq } from "../../src/research/hq-view.ts";
import { baseCssVars } from "../../src/institutions/design-tokens.ts";
import { componentCss } from "../../src/institutions/hq-ui.ts";
import { designAgent } from "../../src/agent/design-agent.ts";

const MAX_RENDERHQ_BYTES = 128 * 1024; // same ceiling as tools/design-check.ts

describe("renderHq SSR surface", () => {
  test("output stays under the 128 KB ceiling", () => {
    const html = renderHq();
    expect(html.length).toBeLessThan(MAX_RENDERHQ_BYTES);
  });

  test("links the shared design-system.css instead of inlining tokens", () => {
    const html = renderHq();
    expect(html).toContain('rel="stylesheet" href="/design-system.css"');
    // token CSS must NOT be inlined per page anymore
    expect(html).not.toContain("--bg:");
  });

  test("output is token-compliant", () => {
    const a = designAgent.audit(renderHq());
    expect(a.issues).toEqual([]);
  });
});

describe("design-system.css surface", () => {
  test("generated stylesheet is token-compliant (one vocabulary)", () => {
    const a = designAgent.audit(baseCssVars() + componentCss());
    expect(a.issues).toEqual([]);
  });

  test("stylesheet carries token values and component classes", () => {
    const css = baseCssVars() + componentCss();
    expect(css).toContain("--acc:");
    expect(css).toContain(".badge.ok");
    expect(css).toContain(".card-metrics");
  });
});
