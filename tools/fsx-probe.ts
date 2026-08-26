#!/usr/bin/env bun
/**
 * `bun run fsx:probe` — filesystem-extra cluster (§132 round 2): Glob,
 * which, resolve, fileURLToPath, pathToFileURL, openInEditor. Repo
 * relies on new Bun.Glob(pattern).match/scan and Bun.which. Bun 1.4.0.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1 Glob match + scan (repo: 49 uses of Bun.Glob)
const g = new Bun.Glob("*.ts");
check("P1 Glob.match", g.match("a.ts") === true && g.match("a.js") === false && g.match("sub/a.ts") === false, "");
const g2 = new Bun.Glob("**/*.ts");
check("P1a Glob ** match", g2.match("sub/a.ts") === true, "");
const found: string[] = [];
for await (const f of g.scan({ cwd: "tools" })) { found.push(f as string); if (found.length > 4) break; }
check("P1b Glob.scan cwd", found.length > 0 && found.every((f) => f.endsWith(".ts")), JSON.stringify(found));
const abs: string[] = [];
for await (const f of g.scan({ cwd: "tools", absolute: true })) { abs.push(f as string); if (abs.length > 2) break; }
check("P1c Glob.scan absolute", abs.length > 0 && abs[0]!.startsWith("/"), abs[0]!);

// P2 which (repo: 37 uses — binary lookup)
const w = Bun.which("bun");
check("P2 which found", typeof w === "string" && w.length > 0 && w.includes("bun"), String(w));
check("P2a which missing -> null", Bun.which("definitely-not-a-real-cmd-xyz") === null, String(Bun.which("definitely-not-a-real-cmd-xyz")));
const w2 = Bun.which("node", { PATH: "/usr/bin:/bin" });
check("P2b which custom PATH", w2 === null || typeof w2 === "string", String(w2));

// P3 resolve — 1.4.0 behavior: bare package names -> entry path;
// node: builtins -> specifier passthrough; RELATIVE paths THROW (pinned).
try {
  const r = await Bun.resolve("node:fs", import.meta.path);
  check("P3 resolve builtin passthrough", r === "node:fs", r);
} catch (e) { check("P3 resolve builtin passthrough", false, String((e as Error).message)); }
try {
  const r2 = await Bun.resolve("typescript", import.meta.path);
  check("P3a resolve package entry", typeof r2 === "string" && r2.includes("typescript") && r2.endsWith(".js"), r2);
} catch (e) { check("P3a resolve package entry", false, String((e as Error).message)); }
let relErr = "no-throw";
try { await Bun.resolve("./fsx-probe.ts", import.meta.path); } catch (e) { relErr = "throws"; }
check("P3b resolve relative THROWS (pinned)", relErr === "throws", relErr);

// P4 fileURLToPath / pathToFileURL (repo: file-url conversion)
const p = Bun.fileURLToPath(new URL("file:///tmp/x.txt"));
check("P4 fileURLToPath", p === "/tmp/x.txt", p);
const u = Bun.pathToFileURL("/tmp/x.txt");
check("P4a pathToFileURL", u instanceof URL && u.href === "file:///tmp/x.txt", u.href);

// P5 openInEditor — presence + API shape (not actually opening in CI)
check("P5 openInEditor", typeof Bun.openInEditor === "function", typeof Bun.openInEditor);

const failed = results.filter((r) => !r.pass);
console.log("fsx:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
