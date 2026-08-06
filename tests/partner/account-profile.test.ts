// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  fantasyDeskEnvPresence,
  fantasyVaultItemTitle,
  loadFantasy402ProfileFromEnv,
  loadFantasy402ProfileFromPrefix,
  profileFromEnvBundle,
  requireFantasy402ProfileFromPrefix,
} from "../../src/partner/account-profile.ts";
import { resolvePartnerEnv } from "../../src/partner/toml-config.ts";

describe("account-profile prefix resolution", () => {
  test("fantasyVaultItemTitle matches Pass item naming", () => {
    expect(fantasyVaultItemTitle("out-SPEN-1")).toBe("Fantasy402 SPEN 1");
    expect(fantasyVaultItemTitle("out-ASH-1")).toBe("Fantasy402 ASH 1");
    expect(fantasyVaultItemTitle("BB55113")).toBe("Fantasy402");
  });

  test("out-level secrets win over book fallback", () => {
    const env = {
      FANTASY402_BEARER_TOKEN: "book-token-xxxxxxxxxxxxxxxxxxxx",
      FANTASY402_CUSTOMER_ID: "BOOK_CUST",
      FANTASY402_AGENT_ID: "BOOK_AGENT",
      FANTASY402_PASSWORD: "book-pass",
      FANTASY402_SPEN_1_BEARER_TOKEN: "out-token-yyyyyyyyyyyyyyyyyyyy",
      FANTASY402_SPEN_1_CUSTOMER_ID: "SPEN_CUST",
      FANTASY402_SPEN_1_AGENT_ID: "SPEN_AGENT",
      FANTASY402_SPEN_1_PASSWORD: "spen-pass",
    };
    const p = loadFantasy402ProfileFromPrefix("FANTASY402_SPEN_1_", {
      envMap: env,
      accountId: "out-SPEN-1",
    });
    expect(p).not.toBeNull();
    expect(p!.id).toBe("out-SPEN-1");
    expect(p!.meta.customerID).toBe("SPEN_CUST");
    expect(p!.meta.token).toBe("out-token-yyyyyyyyyyyyyyyyyyyy");
  });

  test("falls back to book when out keys missing", () => {
    const env = {
      FANTASY402_BEARER_TOKEN: "book-token-xxxxxxxxxxxxxxxxxxxx",
      FANTASY402_CUSTOMER_ID: "BOOK_CUST",
      FANTASY402_AGENT_ID: "BOOK_AGENT",
      FANTASY402_PASSWORD: "book-pass",
    };
    const p = loadFantasy402ProfileFromPrefix("FANTASY402_SPEN_1_", {
      envMap: env,
      accountId: "out-SPEN-1",
    });
    expect(p).not.toBeNull();
    expect(p!.meta.customerID).toBe("BOOK_CUST");
    const presence = fantasyDeskEnvPresence("FANTASY402_SPEN_1_", env);
    expect(presence.ok).toBe(true);
    expect(presence.sources.BEARER_TOKEN).toBe("book_fallback");
  });

  test("presence reports missing without values", () => {
    const presence = fantasyDeskEnvPresence("FANTASY402_ASH_1_", {
      FANTASY402_ASH_1_PASSWORD: "super-secret-value-never-echo",
    });
    expect(presence.ok).toBe(false);
    expect(presence.missing).toContain("BEARER_TOKEN");
    expect(presence.present).toContain("PASSWORD");
    // key names ok; actual secret value must not appear
    expect(JSON.stringify(presence)).not.toContain("super-secret-value-never-echo");
  });

  test("require throws with missing key list", () => {
    expect(() =>
      requireFantasy402ProfileFromPrefix("FANTASY402_ASH_1_", {
        envMap: {},
      }),
    ).toThrow(/missing=\[/);
  });

  test("profileFromEnvBundle + loadFantasy402ProfileFromEnv", () => {
    const env = {
      FANTASY402_BEARER_TOKEN: "Bearer abc.def.ghi_padding_for_len",
      FANTASY402_CUSTOMER_ID: "C1",
      FANTASY402_AGENT_ID: "A1",
      FANTASY402_PASSWORD: "p",
      FANTASY402_ACCOUNT_ID: "out-legacy",
    };
    const p = loadFantasy402ProfileFromEnv(env);
    expect(p?.id).toBe("out-legacy");
    expect(p?.meta.token).toBe("abc.def.ghi_padding_for_len");

    const bundle = resolvePartnerEnv("FANTASY402_", env);
    const fromBundle = profileFromEnvBundle(bundle, { accountId: "x" });
    expect(fromBundle?.meta.customerID).toBe("C1");
  });
});
