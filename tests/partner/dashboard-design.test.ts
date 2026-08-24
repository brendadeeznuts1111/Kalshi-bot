// Partner desk board is an ENFORCED design surface: the baked HTML must be
// token-compliant (data-driven partner identity hexes allowlisted from
// state.json). Mirrors the design:check gate so regressions fail in tests.
// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { DesignAgent } from "../../src/agent/design-agent.ts";
import { renderPartnerDashboardHtml } from "../../src/partner/dashboard-data.ts";
import { TOKENS } from "../../src/institutions/design-tokens.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

/** Same allowlist derivation as tools/design-check.ts. */
async function partnerLegal(): Promise<string[]> {
  const state = await Bun.file(ROOT + "public/partner-dashboard/state.json").json().catch(() => null);
  if (!state || typeof state !== "object") return [];
  const hexes = new Set<string>();
  for (const p of (state as { partners?: Array<{ hex?: unknown }> }).partners ?? []) {
    if (typeof p?.hex === "string") hexes.add(p.hex);
  }
  for (const o of (state as { outs?: Array<{ hex?: unknown }> }).outs ?? []) {
    if (typeof o?.hex === "string") hexes.add(o.hex);
  }
  return [...hexes];
}

describe("partner dashboard design surface", () => {
  test("committed baked HTML is token-compliant (with state.json allowlist)", async () => {
    const html = await Bun.file(ROOT + "public/partner-dashboard/index.html").text();
    const audit = new DesignAgent().audit(html, { legal: await partnerLegal() });
    expect(audit.issues).toEqual([]);
  });

  test("generator template emits token-compliant markup (chrome only)", async () => {
    const data = {
      generatedAt: new Date().toISOString(),
      ok: false,
      registry: { partners: 3, outs: 3, activeOuts: 3 },
      capacity: [],
      env: { ok: false, missingCount: 0, outs: [] },
      risk: {
        ok: false,
        threshold: "warn",
        errorCount: 1,
        warnCount: 0,
        infoCount: 0,
        findings: [],
        snapshot: {
          generatedAt: new Date().toISOString(),
          ok: false,
          errorCount: 1,
          warnCount: 0,
          infoCount: 0,
          threshold: "warn",
          findings: [],
          outs: [],
        },
      },
      partners: [
        { code: "ASH", hex: "#e64dcc", hsl: "hsl(310, 75%, 60%)", initials: "AS" },
        { code: "BB55113", hex: "#ba4de6", hsl: "hsl(283, 75%, 60%)", initials: "BB" },
        { code: "SPEN", hex: "#cce64d", hsl: "hsl(70, 75%, 60%)", initials: "SP" },
      ],
      outs: [],
      ops: { built: 0, partial: 0, planned: 0 },
      toml: "",
      commands: [],
      ledger: [],
      tickets: undefined,
    } as unknown as Parameters<typeof renderPartnerDashboardHtml>[0];
    const html = renderPartnerDashboardHtml(data);
    // UI chrome must be TOKENS: the :root palette carries token values.
    expect(html).toContain(TOKENS.color.bg);
    expect(html).toContain(TOKENS.color.bad);
    // The only non-token hexes are the data-driven partner identities.
    const audit = new DesignAgent().audit(html, { legal: ["#e64dcc", "#ba4de6", "#cce64d"] });
    expect(audit.issues).toEqual([]);
  });

  test("board uses token ok/bad for status (not hand-picked greens/reds)", async () => {
    const html = await Bun.file(ROOT + "public/partner-dashboard/index.html").text();
    expect(html).toContain(TOKENS.color.bad); // DEGRADED state dot
    expect(html).not.toContain("#22c55e");
    expect(html).not.toContain("#ef4444");
  });
});
