// API defaults cross-reference tests (§81) — probe-locked defaults across
// the Bun surfaces the repo touches.
import { describe, expect, test } from "bun:test";

describe("Bun.serve defaults (§81)", () => {
  test("default hostname is localhost, NOT 0.0.0.0 (doc correction)", () => {
    const s = Bun.serve({ port: 0, fetch: () => new Response("x") });
    expect(s.hostname).toBe("localhost");
    s.stop(true);
  });

  test("explicit hostnames honored (0.0.0.0 / 127.0.0.1)", () => {
    const a = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response("x") });
    expect(a.hostname).toBe("0.0.0.0");
    a.stop(true);
    const b = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("x") });
    expect(b.hostname).toBe("127.0.0.1");
    b.stop(true);
  });
});

describe("cookie/CSRF defaults (§81 cross-ref)", () => {
  test("cookie defaults: path=/ sameSite=lax httpOnly=false secure=false", () => {
    const c = new Bun.Cookie("n", "v");
    expect(c.path).toBe("/");
    expect(c.sameSite).toBe("lax");
    expect(c.httpOnly).toBe(false);
    expect(c.secure).toBe(false);
  });

  test("CSRF generate works without expiresIn (no required default)", () => {
    const t = (Bun as any).CSRF.generate("sec", { sessionId: "x" });
    expect(typeof t).toBe("string");
  });
});

describe("req.cookies routes-only (§81 cross-doc gotcha)", () => {
  test("cookies exists in routes handlers, NOT in fetch handlers", async () => {
    const sF = Bun.serve({ port: 3661, fetch: (req: any) => new Response("cookies=" + (typeof req.cookies !== "undefined")) });
    const rF = await fetch("http://127.0.0.1:3661/");
    const fBody = await rF.text();
    sF.stop(true);
    const sR = Bun.serve({ port: 3662, routes: { "/": (req: any) => new Response("cookies=" + (req.cookies instanceof Bun.CookieMap)) } });
    const rR = await fetch("http://127.0.0.1:3662/");
    const rBody = await rR.text();
    sR.stop(true);
    expect(fBody).toBe("cookies=false");
    expect(rBody).toBe("cookies=true");
  });
});