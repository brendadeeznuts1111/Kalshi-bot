// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  isKalshiWsUserError,
  KALSHI_WS_ERROR_LABELS,
  parseKalshiWsErrorWire,
  shouldReconnectKalshiWsError,
} from "../../src/bot/kalshi-ws-errors.ts";

describe("kalshi-ws-errors", () => {
  test("parseKalshiWsErrorWire maps known codes with message fallback", () => {
    expect(parseKalshiWsErrorWire({ type: "error", msg: { code: 2, msg: "Params required" } })).toEqual({
      code: 2,
      message: "Params required",
      userError: true,
    });
    expect(parseKalshiWsErrorWire({ type: "error", msg: { code: 9 } })).toEqual({
      code: 9,
      message: KALSHI_WS_ERROR_LABELS[9],
      userError: true,
    });
    expect(parseKalshiWsErrorWire({ type: "error", msg: { code: 10, msg: "channel blew up" } })).toEqual({
      code: 10,
      message: "channel blew up",
      userError: false,
    });
    expect(parseKalshiWsErrorWire({ type: "error", msg: { code: 25, msg: "overflow" } })?.code).toBe(25);
  });

  test("parseKalshiWsErrorWire rejects non-error and unknown codes", () => {
    expect(parseKalshiWsErrorWire({ type: "orderbook_delta", seq: 1 })).toBeNull();
    expect(parseKalshiWsErrorWire({ type: "error", msg: { code: 99, msg: "nope" } })).toBeNull();
    expect(parseKalshiWsErrorWire({ type: "error" })).toBeNull();
  });

  test("isKalshiWsUserError marks server-side codes 10, 17, 18", () => {
    expect(isKalshiWsUserError(2)).toBe(true);
    expect(isKalshiWsUserError(10)).toBe(false);
    expect(isKalshiWsUserError(17)).toBe(false);
    expect(isKalshiWsUserError(18)).toBe(false);
  });

  test("shouldReconnectKalshiWsError for auth, internal, buffer overflow", () => {
    expect(shouldReconnectKalshiWsError(9)).toBe(true);
    expect(shouldReconnectKalshiWsError(17)).toBe(true);
    expect(shouldReconnectKalshiWsError(25)).toBe(true);
    expect(shouldReconnectKalshiWsError(2)).toBe(false);
  });
});
