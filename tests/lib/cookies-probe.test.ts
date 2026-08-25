// Cookie API surface tests (§79) — the property surface the docs claim,
// verified against the runtime: Cookie + CookieMap + server req.cookies.
import { describe, expect, test } from "bun:test";
import { Cookie, CookieMap } from "bun";

describe("Bun.Cookie properties (§79)", () => {
  test("all 10 documented properties readable; defaults path=/ sameSite=lax", () => {
    const c = new Cookie("session", "abc123", { domain: "example.com", path: "/admin", expires: new Date(Date.now() + 86400000), httpOnly: true, secure: true, sameSite: "strict", partitioned: true, maxAge: 3600 });
    expect(c.name).toBe("session");
    expect(c.value).toBe("abc123");
    expect(c.domain).toBe("example.com");
    expect(c.path).toBe("/admin");
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe("strict");
    expect(c.partitioned).toBe(true);
    expect(c.maxAge).toBe(3600);
    expect(c.httpOnly).toBe(true);
    expect(c.expires).toBeInstanceOf(Date);
    const d = new Cookie("n", "v");
    expect(d.path).toBe("/");
    expect(d.sameSite).toBe("lax");
  });

  test("string + options-object constructors; parse + from statics", () => {
    const s = new Cookie("name=value; Path=/; HttpOnly");
    expect(s.name).toBe("name");
    expect(s.httpOnly).toBe(true);
    const o = new Cookie({ name: "theme", value: "dark", maxAge: 3600 });
    expect(o.maxAge).toBe(3600);
    const p = Cookie.parse("name=value; Path=/; Secure; SameSite=Lax");
    expect(p.secure).toBe(true);
    expect(p.sameSite).toBe("lax");
    const f = Cookie.from("session", "abc123", { httpOnly: true });
    expect(f.httpOnly).toBe(true);
  });

  test("isExpired matrix: past expires, maxAge 0 true; valid maxAge + session false", () => {
    expect(new Cookie("n", "v", { expires: new Date(Date.now() - 1000) }).isExpired()).toBe(true);
    expect(new Cookie("n", "v", { maxAge: 3600 }).isExpired()).toBe(false);
    expect(new Cookie("n", "v", { maxAge: 0 }).isExpired()).toBe(true);
    expect(new Cookie("n", "v").isExpired()).toBe(false);
  });

  test("serialize() == toString(); toJSON() shape", () => {
    const c = new Cookie("session", "abc123", { secure: true, httpOnly: true, sameSite: "strict" });
    expect(c.serialize()).toBe(c.toString());
    expect(c.toString()).toContain("SameSite=Strict");
    expect(c.toString()).toContain("HttpOnly");
    const j = c.toJSON();
    expect(j.name).toBe("session");
    expect(j.path).toBe("/");
    expect(j.secure).toBe(true);
  });
});

describe("Bun.CookieMap (§79)", () => {
  test("get/has/set/delete/size/toJSON", () => {
    const cm = new CookieMap("a=1; b=2");
    expect(cm.get("a")).toBe("1");
    expect(cm.has("b")).toBe(true);
    expect(cm.size).toBe(2);
    cm.set("c", "3");
    cm.delete("a");
    expect(cm.size).toBe(2);
    expect(cm.toJSON()).toEqual({ b: "2", c: "3" });
  });

  test("iteration: for...of, keys, values, forEach", () => {
    const cm = new CookieMap({ session: "abc123", theme: "dark" });
    const iter: string[] = [];
    for (const [k, v] of cm) iter.push(k);
    expect(iter.sort()).toEqual(["session", "theme"]);
    expect([...cm.keys()].sort()).toEqual(["session", "theme"]);
    expect([...cm.values()].sort()).toEqual(["abc123", "dark"]);
    const fe: string[] = [];
    cm.forEach((_v, k) => fe.push(k));
    expect(fe.length).toBe(2);
  });
});

describe("server req.cookies (§79)", () => {
  test("req.cookies is a CookieMap; set() auto-applies to response", async () => {
    const srv = Bun.serve({
      port: 3623,
      routes: {
        "/": (req: any) => {
          const cookies = req.cookies;
          const session = cookies.get("session");
          cookies.set("visited", "true");
          return new Response("ok " + (cookies instanceof CookieMap) + " " + session);
        },
      },
    });
    try {
      const res = await fetch("http://127.0.0.1:3623/", { headers: { cookie: "session=abc123" } });
      const body = await res.text();
      expect(body).toContain("true");
      expect(body).toContain("abc123");
      const setC = (res.headers as any).getSetCookie?.() ?? [];
      expect(setC.some((h: string) => h.startsWith("visited=true"))).toBe(true);
    } finally {
      srv.stop(true);
    }
  });
});