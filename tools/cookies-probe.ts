#!/usr/bin/env bun
/**
 * `bun run cookies:probe` — probe the Bun cookie docs (AGENT-PITFALLS §79)
 * against the installed runtime: Cookie/CookieMap property surface,
 * constructors, statics, isExpired, serialize, server req.cookies.
 *
 * VERIFIED on Bun 1.4.0 (15/15):
 *   - Cookie properties: name/value/domain/path/expires/secure/sameSite/
 *     partitioned/maxAge/httpOnly all readable; defaults path="/",
 *     sameSite="lax".
 *   - constructors: (name,value), (name,value,opts), (cookieString),
 *     (options object); statics Cookie.parse + Cookie.from.
 *   - isExpired: past-expires true, maxAge 3600 false, maxAge 0 true,
 *     session (no expiry) false.
 *   - serialize() == toString(); toJSON() shape; JSON.stringify works.
 *   - CookieMap: get/has/set/delete/size/toJSON/toSetCookieHeaders +
 *     iteration (for...of, entries, keys, values, forEach).
 *   - SERVER: req.cookies IS a CookieMap in routes; get() reads request
 *     cookies; set() AUTO-APPLIES to response Set-Cookie headers.
 *
 * @see docs/AGENT-PITFALLS.md §79
 */
import { Cookie, CookieMap } from "bun";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// C1: full property surface
const c = new Cookie("session", "abc123", { domain: "example.com", path: "/admin", expires: new Date(Date.now() + 86400000), httpOnly: true, secure: true, sameSite: "strict", partitioned: true, maxAge: 3600 });
check("C1 Cookie properties", c.name === "session" && c.value === "abc123" && c.domain === "example.com" && c.path === "/admin" && c.secure && c.sameSite === "strict" && c.partitioned && c.maxAge === 3600 && c.httpOnly && c.expires instanceof Date, "all 10 readable");

// C2: defaults
const d = new Cookie("n", "v");
check("C2 defaults path=/ sameSite=lax", d.path === "/" && d.sameSite === "lax", "path=" + d.path + " ss=" + d.sameSite);

// C3: constructors
const s = new Cookie("name=value; Path=/; HttpOnly");
const o = new Cookie({ name: "theme", value: "dark", maxAge: 3600 });
check("C3 string + object constructors", s.name === "name" && s.httpOnly && o.name === "theme" && o.maxAge === 3600, "ok");

// C4: statics
const p = Cookie.parse("name=value; Path=/; Secure; SameSite=Lax");
const f = Cookie.from("session", "abc123", { httpOnly: true });
check("C4 parse + from", p.secure && p.sameSite === "lax" && f.name === "session" && f.httpOnly, "ok");

// C5: isExpired matrix
const e1 = new Cookie("n", "v", { expires: new Date(Date.now() - 1000) }).isExpired();
const e2 = new Cookie("n", "v", { maxAge: 3600 }).isExpired();
const e3 = new Cookie("n", "v", { maxAge: 0 }).isExpired();
const e4 = new Cookie("n", "v").isExpired();
check("C5 isExpired matrix", e1 && !e2 && e3 && !e4, [e1, e2, e3, e4].join(","));

// C6: serialize/toString/toJSON
const sc = new Cookie("session", "abc123", { domain: "example.com", path: "/admin", secure: true, httpOnly: true, sameSite: "strict" });
check("C6 serialize == toString + attrs", sc.serialize() === sc.toString() && sc.toString().includes("SameSite=Strict") && sc.toString().includes("HttpOnly"), sc.toString());
const j = new Cookie("session", "abc123", { secure: true }).toJSON();
check("C6b toJSON shape", j.name === "session" && j.path === "/" && j.secure === true && j.sameSite === "lax", JSON.stringify(j).slice(0, 60));

// C7: CookieMap surface
const cm = new CookieMap("a=1; b=2");
cm.set("c", "3"); cm.delete("a");
check("C7 CookieMap get/has/set/delete/size", cm.get("c") === "3" && !cm.has("a") && cm.size === 2, "size=" + cm.size);
const jm = cm.toJSON();
check("C7b toJSON", jm.b === "2" && jm.c === "3", JSON.stringify(jm));
const sh = new CookieMap("x=1").toSetCookieHeaders();
check("C7c toSetCookieHeaders", Array.isArray(sh), "len=" + sh.length);

// C8: iteration
const cm2 = new CookieMap({ session: "abc123", theme: "dark" });
const iter: string[] = []; for (const [k, v] of cm2) iter.push(k + "=" + v);
check("C8 iteration", iter.length === 2 && [...cm2.keys()].sort().join(",") === "session,theme", iter.join(" "));

// C9: server req.cookies
const srv = Bun.serve({ port: 3622, routes: { "/": (req: any) => { const cookies = req.cookies; const session = cookies.get("session"); cookies.set("visited", "true"); return new Response("ok " + (cookies instanceof CookieMap) + " " + session); } } });
const res = await fetch("http://127.0.0.1:3622/", { headers: { cookie: "session=abc123" } });
const body = await res.text();
const setC = (res.headers as any).getSetCookie?.() ?? [];
srv.stop(true);
check("C9 req.cookies is CookieMap + auto-applies set()", body.includes("true") && body.includes("abc123") && setC.some((h: string) => h.startsWith("visited=true")), body + " | " + setC.join(" / "));

// C10: http-cookies doc (§80) — delete() emits empty value + past Expires
const srv2 = Bun.serve({ port: 3632, routes: { "/logout": (req: any) => { req.cookies.delete("user_id", { path: "/" }); return new Response("out"); } } });
const res2 = await fetch("http://127.0.0.1:3632/logout");
const setD = (res2.headers as any).getSetCookie?.() ?? [];
srv2.stop(true);
const del = setD[0] ?? "";
check("C10 delete() -> empty value + past Expires", del.startsWith("user_id=;") && del.includes("Expires=") && del.includes("1970"), del);

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("cookies:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
process.exit(fails.length ? 1 : 0);