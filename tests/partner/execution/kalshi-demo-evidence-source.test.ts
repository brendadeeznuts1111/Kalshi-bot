import { describe, expect, test } from "bun:test";
import { createKalshiDemoEvidenceSource } from "../../../src/partner/execution/kalshi-demo-evidence-source.ts";

describe("Kalshi demo evidence source", () => {
  test("loads cursor-complete positions with the normalized lifecycle and balance", async () => {
    const positionCursors: string[] = [];
    const source = createKalshiDemoEvidenceSource({
      environment: "demo",
      getLifecyclePage: async () => ({ items: [], cursor: "" }),
      getBalance: async () => ({ balanceCents: 1_000 }),
      getPositionsPage: async (cursor = "") => {
        positionCursors.push(cursor);
        return cursor === "" ? {
          items: [{ ticker: "KX-A", position_fp: "2" }], cursor: "next",
        } : {
          items: [{ market_ticker: "KX-B", position: -1 }], cursor: "",
        };
      },
    }, { outId: "out-SPORTS-1", now: () => 1_000 });
    const capture = await source.capture();
    expect(positionCursors).toEqual(["", "next"]);
    expect(capture.positions).toEqual([
      { ticker: "KX-A", position: 2 },
      { ticker: "KX-B", position: -1 },
    ]);
    expect(capture.lifecycle.ordersCursorComplete).toBeTrue();
  });

  test("refuses production clients before provider I/O", async () => {
    let calls = 0;
    const source = createKalshiDemoEvidenceSource({
      environment: "prod",
      getLifecyclePage: async () => { calls++; return { items: [], cursor: "" }; },
      getBalance: async () => { calls++; return { balanceCents: 1 }; },
      getPositionsPage: async () => { calls++; return { items: [], cursor: "" }; },
    }, { outId: "out-SPORTS-1" });
    await expect(source.capture()).rejects.toThrow(/refuses production/);
    expect(calls).toBe(0);
  });
});
