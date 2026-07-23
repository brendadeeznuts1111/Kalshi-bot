// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  resolveShadowPartnerId,
} from "../src/operations/experiment-shadow-bridge.ts";
import type { ShadowPredictionLine } from "../src/institutions/shadow-line.ts";

function line(partial: Partial<ShadowPredictionLine>): ShadowPredictionLine {
  return {
    prevHash: "",
    ts: Date.now(),
    program: "tennis-game-model",
    ticker: "T1",
    eventId: "evt-1",
    pModel: 0.5,
    components: {},
    book: { ts: Date.now(), bids: [], asks: [], seq: 0, crossed: false },
    decision: { action: "trade", contracts: 1, reason: "test fixture" },
    rawEdgeCents: 1,
    feePerContractCents: 0,
    vwapFillCents: 50,
    filledContracts: 1,
    midAtFillCents: 50,
    toxicity: { dueTs: 0, markedTs: null, midCents: null, movedAgainst: null },
    lineHash: "hash1",
    ...partial,
  };
}

describe("experiment-shadow-bridge", () => {
  test("resolveShadowPartnerId from eventId ticker program", () => {
    const l = line({});
    expect(resolveShadowPartnerId(l, "eventId", "tennis-game-model")).toBe("evt-1");
    expect(resolveShadowPartnerId(l, "ticker", "tennis-game-model")).toBe("T1");
    expect(resolveShadowPartnerId(l, "program", "tennis-game-model")).toBe("tennis-game-model");
  });
});
