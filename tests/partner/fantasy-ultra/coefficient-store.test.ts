// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { CoefficientStore } from "../../../src/partner/fantasy-ultra/coefficient-store.ts";

describe("CoefficientStore inspect.custom", () => {
  test("compact form shows coverage only", () => {
    const store = new CoefficientStore();
    expect(Bun.inspect(store)).toBe("CoefficientStore(0 events)");
    // ingest a minimal coefficient payload
    store.ingest({
      room: "live.main.U0VWU1NWUkJSMFU9.eventCoefficients.174125551",
      eventId: 174125551,
      envelope: { isDiff: false, payload: null },
      lines: [],
    });
    expect(Bun.inspect(store)).toBe("CoefficientStore(1 event)");
  });
});
