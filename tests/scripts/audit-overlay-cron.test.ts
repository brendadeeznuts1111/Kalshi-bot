// audit-overlay weekly cron (§99) — schedule shape + importable module.
import { describe, expect, test } from "bun:test";
import { INTERVAL_AUDIT_OVERLAY } from "../../scripts/cron-main.ts";
import { refreshAuditOverlay } from "../../tools/audit-overlay-update.ts";

describe("audit-overlay cron (§99)", () => {
  test("weekly schedule parses and next fire is a Sunday (UTC)", () => {
    const next = Bun.cron.parse(INTERVAL_AUDIT_OVERLAY, Date.now());
    expect(next).toBeInstanceOf(Date);
    expect(next!.getUTCDay()).toBe(0); // 0 = Sunday
  });

  test("refreshAuditOverlay is exported without executing (import.meta.main guard)", () => {
    expect(typeof refreshAuditOverlay).toBe("function");
  });
});
