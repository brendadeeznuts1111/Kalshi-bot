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

  test("Bun.cron is 5-field only — seconds unsupported (§126)", () => {
    expect(() => Bun.cron("* * * * * *", () => {})).toThrow(/too many fields/);
    expect(() => Bun.cron.parse("* * * * * *", Date.now())).toThrow(/too many fields/);
    expect(Bun.cron.parse("*/5 * * * *", Date.now())).toBeInstanceOf(Date);
  });

  test("createSingleFlight counts coalesced ticks (§128 catch-up visibility)", async () => {
    const { createSingleFlight } = await import("../../scripts/cron-main.ts");
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const flight = createSingleFlight(async () => { runs++; await gate; return true; });
    const first = flight.run();
    const second = flight.run();
    const third = flight.run();
    expect(flight.droppedTicks()).toBe(2);
    release();
    await Promise.all([first, second, third]);
    expect(runs).toBe(1);
    expect(flight.droppedTicks()).toBe(2);
  });
});
