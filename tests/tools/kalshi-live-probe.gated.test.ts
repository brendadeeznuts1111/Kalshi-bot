// @see https://bun.com/docs/test/index#run-tests
//
// Gated live probe: runs ONLY when KALSHI_TEST_KEYCHAIN_SERVICE is set (a
// keychain service holding a Kalshi test key). Skipped by default so the
// suite never touches the network or a real keychain service without an
// explicit opt-in. The keychain must be populated out-of-band:
//   bun run kalshi:secrets store --service "$KALSHI_TEST_KEYCHAIN_SERVICE" --force --key-file <pem> --key-id <id>
import { describe, expect, test } from "bun:test";
import { loadKalshiCredentials, probeKalshiAuth } from "../../src/bot/kalshi-auth.ts";
import { OFFICIAL_URLS } from "../../src/institutions/official-urls.ts";

const service = Bun.env.KALSHI_TEST_KEYCHAIN_SERVICE?.trim();

describe("live Kalshi probe (keychain-sourced)", () => {
  test.skipIf(!service)(
    "loads creds from the test keychain service and reaches the Kalshi API",
    async () => {
      const creds = await loadKalshiCredentials({}, { service: service! });
      const probe = await probeKalshiAuth(creds, {
        base: OFFICIAL_URLS.kalshi.tradeApiV2BaseDemo,
        timeoutMs: 10_000,
      });
      // A VALID test key → 200. An invalid key → 401. Either way the chain
      // (keychain → load → sign → HTTP) executed without env/file creds.
      expect(probe.status).toBeGreaterThan(0);
    },
  );
});
