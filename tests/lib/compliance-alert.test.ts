// compliance-alert (§106) — pure message builder + dedupe paths (no network).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildComplianceAlertMessage, complianceAlertFingerprint, maybeSendComplianceAlert } from "../../src/lib/compliance-alert.ts";

const ROOT = join(import.meta.dir, "../..");

function cleanFacts() {
  return { found: 0, reportOk: true, expiringSoon: 0, generatedAt: "2026-08-25T00:00:00.000Z" };
}

describe("buildComplianceAlertMessage (§106)", () => {
  test("returns null when everything is clean", () => {
    expect(buildComplianceAlertMessage(cleanFacts())).toBeNull();
  });

  test("mentions new advisories when found > 0", () => {
    const msg = buildComplianceAlertMessage({ ...cleanFacts(), found: 2 });
    expect(msg).toContain("New advisories: 2");
  });

  test("flags a failing gate", () => {
    const msg = buildComplianceAlertMessage({ ...cleanFacts(), reportOk: false });
    expect(msg).toContain("Gate FAIL");
  });

  test("flags expiring exemptions", () => {
    const msg = buildComplianceAlertMessage({ ...cleanFacts(), expiringSoon: 1 });
    expect(msg).toContain("1 exemption(s) inside the expiry warning window");
  });
});

describe("complianceAlertFingerprint (§106)", () => {
  test("stable for identical facts, changes on any fact", () => {
    const a = complianceAlertFingerprint(cleanFacts());
    expect(complianceAlertFingerprint(cleanFacts())).toBe(a);
    expect(complianceAlertFingerprint({ ...cleanFacts(), found: 1 })).not.toBe(a);
    expect(complianceAlertFingerprint({ ...cleanFacts(), reportOk: false })).not.toBe(a);
  });
});

describe("maybeSendComplianceAlert (§106)", () => {
  const STATE = join(ROOT, ".data", "compliance-alert-test-state.json");

  test("disabled -> not-enabled (no side effects)", async () => {
    const r = await maybeSendComplianceAlert({ ...cleanFacts(), found: 1 }, { enabled: false, statePath: STATE });
    expect(r).toBe("not-enabled");
  });

  test("clean facts -> nothing-to-report", async () => {
    const r = await maybeSendComplianceAlert(cleanFacts(), { enabled: true, statePath: STATE });
    expect(r).toBe("nothing-to-report");
  });

  test("unchanged fingerprint is deduped (skipped before any send)", async () => {
    const facts = { ...cleanFacts(), found: 1 };
    await Bun.write(STATE, JSON.stringify({ fingerprint: complianceAlertFingerprint(facts), lastSent: "2026-08-20T00:00:00.000Z" }, null, 2) + "\n");
    try {
      const r = await maybeSendComplianceAlert(facts, { enabled: true, statePath: STATE });
      expect(r).toBe("skipped");
    } finally {
      await Bun.file(STATE).delete();
    }
  });
});
