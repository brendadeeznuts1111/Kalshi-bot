// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { CookieJar } from "../../../src/partner/fantasy-ultra/cookie-jar.ts";

describe("CookieJar inspect.custom", () => {
  test("Bun.inspect renders the compact form", () => {
    const jar = new CookieJar();
    jar.absorb(["session=SECRET_TOKEN; Path=/", "csrf=abc"]);
    expect(Bun.inspect(jar)).toBe("CookieJar(2 cookies)");
  });

  test("cookie values never leak into inspect output", () => {
    const jar = new CookieJar();
    jar.absorb("session=SECRET_TOKEN_VALUE; Path=/");
    const out = Bun.inspect(jar);
    expect(out).not.toContain("SECRET_TOKEN_VALUE");
    expect(out).not.toContain("session");
  });

  test("singular label for one cookie", () => {
    const jar = new CookieJar();
    jar.absorb("sid=1");
    expect(Bun.inspect(jar)).toBe("CookieJar(1 cookie)");
  });
});
