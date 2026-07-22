// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  constants as cryptoConstants,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  kalshiAccessHeaders,
  kalshiWsAccessHeaders,
  KALSHI_WS_PATH,
  signKalshiPss,
  type KalshiCredentials,
} from "../../src/bot/kalshi-auth.ts";

function verifyPss(publicKey: KeyObject, message: string, sigB64: string): boolean {
  return verify(
    "sha256",
    Buffer.from(message, "utf8"),
    {
      key: publicKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
    },
    Buffer.from(sigB64, "base64"),
  );
}

describe("kalshi-auth", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const creds: KalshiCredentials = { keyId: "test-key-id", privateKey };

  test("signKalshiPss returns verifiable base64 (PSS salt is random)", () => {
    const msg = "1700000000000GET/trade-api/ws/v2";
    const sig = signKalshiPss(privateKey, msg);
    expect(sig.length).toBeGreaterThan(80);
    expect(verifyPss(publicKey, msg, sig)).toBe(true);
    // Two signatures of the same message must both verify but need not match.
    const sig2 = signKalshiPss(privateKey, msg);
    expect(verifyPss(publicKey, msg, sig2)).toBe(true);
  });

  test("ws headers sign GET + /trade-api/ws/v2", () => {
    const now = 1_700_000_000_000;
    const headers = kalshiWsAccessHeaders(creds, now);
    expect(headers["KALSHI-ACCESS-KEY"]).toBe("test-key-id");
    expect(headers["KALSHI-ACCESS-TIMESTAMP"]).toBe(String(now));
    expect(verifyPss(publicKey, `${now}GET${KALSHI_WS_PATH}`, headers["KALSHI-ACCESS-SIGNATURE"])).toBe(true);
  });

  test("path query is stripped before signing", () => {
    const now = 1_700_000_000_001;
    const a = kalshiAccessHeaders(creds, "GET", "/trade-api/v2/markets?status=open", now);
    expect(verifyPss(publicKey, `${now}GET/trade-api/v2/markets`, a["KALSHI-ACCESS-SIGNATURE"])).toBe(true);
  });
});
