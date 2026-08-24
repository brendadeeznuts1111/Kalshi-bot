// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { renderNetworkingPage } from "../../src/research/networking-page.ts";
import { designAgent } from "../../src/agent/design-agent.ts";
import { BRAND } from "../../src/institutions/design-tokens.ts";

describe("Bun.Networking deep-dive page", () => {
  test("is token-compliant (audited surface)", () => {
    const a = designAgent.audit(renderNetworkingPage());
    expect(a.issues).toEqual([]);
  });

  test("carries the verified primitives and the corrections", () => {
    const html = renderNetworkingPage();
    expect(html).toContain(BRAND.name);
    expect(html).toContain("dependency math");
    expect(html).toContain("Bun.listen()");
    expect(html).toContain("Bun.udpSocket()");
    expect(html).toContain("http3");
    expect(html).toContain("req.file()"); // corrected claim
    expect(html).toContain("HTML imports"); // bundling correction
    expect(html).toContain("verified"); // probe badges
    expect(html).toContain("corrected");
  });

  test("does not claim unverified benchmarks as fact", () => {
    const html = renderNetworkingPage();
    expect(html).toContain("not independently verified");
  });
});
