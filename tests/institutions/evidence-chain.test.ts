// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { hashPredictionPayload, sha3Hex } from "../../src/institutions/evidence-chain.ts";

describe("evidence-chain", () => {
  test("hashPredictionPayload is stable sha3-256", () => {
    const a = hashPredictionPayload({ p: 0.55, ticker: "KXTEST" });
    const b = hashPredictionPayload({ p: 0.55, ticker: "KXTEST" });
    expect(a).toBe(b);
    expect(a).toBe(sha3Hex(JSON.stringify({ p: 0.55, ticker: "KXTEST" })));
  });
});
