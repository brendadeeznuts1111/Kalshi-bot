// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/runtime/environment-variables
// @see https://bun.com/docs/runtime/utils#bun-env
/**
 * Bun environment loading — no dotenv; Bun.env ≡ process.env.
 *
 *   bun test tests/lib/bun-env.test.ts
 */
import { describe, expect, test } from "bun:test";

describe("Bun.env (environment-variables)", () => {
  test("Bun.env is an alias of process.env", () => {
    expect(Bun.env).toBe(process.env);
  });

  test("assignment is visible on both faces", () => {
    const key = "KALSHI_BUN_ENV_SMOKE";
    const prev = Bun.env[key];
    try {
      Bun.env[key] = "hello";
      expect(process.env[key]).toBe("hello");
      process.env[key] = "world";
      expect(Bun.env[key]).toBe("world");
    } finally {
      if (prev === undefined) delete Bun.env[key];
      else Bun.env[key] = prev;
    }
  });

  test("typed Env keys from config.ts are string | undefined at runtime", () => {
    // Interface merge only affects TS; runtime remains optional strings.
    const port: string | undefined = Bun.env.PORT;
    const nodeEnv: string | undefined = Bun.env.NODE_ENV;
    expect(typeof port === "string" || port === undefined).toBe(true);
    expect(typeof nodeEnv === "string" || nodeEnv === undefined).toBe(true);
  });
});
