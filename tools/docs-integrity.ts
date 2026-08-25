#!/usr/bin/env bun
/**
 * `bun run docs:integrity` — internal-link resolver + import resolver for
 * the repo docs (AGENT-PITFALLS §63).
 *
 * LINKS (GATE — objective): every markdown link is resolved against the
 * filesystem and heading slugs:
 *   [text](#anchor)         same-file anchor -> must exist in own headings
 *   [text](path.md)         cross-file      -> target file must exist
 *   [text](path.md#anchor)  cross-file+anchor -> target + slug must exist
 * Headings come from src/lib/markdown-headings.ts (Bun.markdown render
 * callbacks, native ids) — the SAME machinery docs:check uses. Exit 1 on
 * any broken link (readers hit 404s).
 *
 * IMPORTS (REPORTED — illustrative-prone): `from "spec"` strings in code
 * blocks are resolved via Bun.resolve against the repo root. Relative
 * imports to real src/ files resolve; bare bun/bun:* builtins resolve;
 * metasyntactic placeholders (x, m, ./x.md, file:./dep) and illustrative
 * imports (./validate.ts pattern, ./app.html HTML-import note) are
 * EXPECTED and reported, never failed — same class as the §59 pseudo-code
 * blocks. Genuine typos (existing path misnamed) are flagged for review.
 *
 * @see docs/AGENT-PITFALLS.md §63
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = join(import.meta.dir, "..");
import { markdownHeadings } from "../src/lib/markdown-headings.ts";

/** Docs that legitimately link outside docs/ (AGENTS.md, src READMEs). */
const EXTERNAL_MD_DIRS = new Set(["AGENTS.md", "README.md", "UNIFIED.md"]);

/** Import specifiers that are metasyntactic / illustrative (probe §63). */
const ILLUSTRATIVE_IMPORTS = new Set([
  "x", // metasyntactic placeholder
  "m", // metasyntactic placeholder
  "./x.md", // example file
  "./x.conf", // example config
  "file:./dep", // §61 file: namespace example (intentionally unresolvable)
  "./validate.ts", // AUDIT_ADAPTER: generic wire-validator pattern
  "./app.html", // AGENT-PITFALLS HTML-import note (bundling semantics)
  "./glossary.ts", // SEMANTIC_LAYER: illustrative example
]);

type LinkProblem = { file: string; line: number; kind: string; href: string; detail: string };
type ImportProblem = { file: string; line: number; spec: string; detail: string };

async function collectHeadings(file: string): Promise<Set<string> | null> {
  if (!existsSync(file)) return null;
  if (!file.endsWith(".md")) return new Set();
  const nodes = markdownHeadings(readFileSync(file, "utf8"));
  return new Set(nodes.map((n) => n.slug));
}

async function main() {
  console.log("docs:integrity — bun " + Bun.version);
  const docs = [...new Bun.Glob("*.md").scanSync({ cwd: join(ROOT, "docs"), onlyFiles: true })].sort();
  const headingCache = new Map<string, Set<string> | null>();
  const getHeadings = async (p: string) => {
    if (!headingCache.has(p)) headingCache.set(p, await collectHeadings(p));
    return headingCache.get(p)!;
  };

  // ─── LINKS (gate) ────────────────────────────────────────────────
  const linkRe = /\[([^\]]+)\]\(([^\)]+)\)/g;
  const linkProblems: LinkProblem[] = [];
  let crossChecked = 0, sameChecked = 0;
  for (const f of docs) {
    const abs = resolve(join(ROOT, "docs", f));
    const lines = readFileSync(abs, "utf8").split("\n");
    const own = (await getHeadings(abs))!;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const m of line.matchAll(linkRe)) {
        const href = m[2]!.trim();
        if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.includes("://")) continue;
        if (href.startsWith("#")) {
          sameChecked++;
          const anchor = href.slice(1);
          if (anchor && !own.has(anchor)) linkProblems.push({ file: f, line: i + 1, kind: "same-anchor", href, detail: "no heading with slug #" + anchor });
          continue;
        }
        const [pathPart, anchor2] = href.split("#");
        if (!pathPart) continue;
        // skip non-md targets (code refs, assets) — prose artifacts like
        // colorMap[..](raw) are NOT links but match the regex; filter:
        const target = resolve(dirname(abs), pathPart);
        if (!pathPart.endsWith(".md") && !pathPart.endsWith("/")) continue; // asset/code ref
        const exists = existsSync(target);
        if (!exists && pathPart.endsWith(".md")) {
          linkProblems.push({ file: f, line: i + 1, kind: "file", href, detail: "target does not exist: " + pathPart });
          continue;
        }
        if (!pathPart.endsWith(".md")) continue;
        crossChecked++;
        if (anchor2) {
          const hs = await getHeadings(target);
          if (hs && !hs.has(anchor2)) linkProblems.push({ file: f, line: i + 1, kind: "anchor", href, detail: "no heading with slug #" + anchor2 + " in " + pathPart });
        }
      }
    }
  }

  // ─── IMPORTS (report) ────────────────────────────────────────────
  const exports = new Map<string, boolean>();
  const impRe = /from [\"']([^\"']+)[\"']/g;
  const importProblems: ImportProblem[] = [];
  for (const f of docs) {
    const abs = resolve(join(ROOT, "docs", f));
    const lines = readFileSync(abs, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!/\b(import|export)\b/.test(line)) continue;
      for (const m of line.matchAll(impRe)) {
        const spec = m[1]!;
        if (spec.includes(" ") || spec.includes("\n")) continue;
        if (ILLUSTRATIVE_IMPORTS.has(spec)) continue;
        // Docs write relative imports against the REPO ROOT (probe §63):
        // ./src/... and ../src/... both mean <root>/src/.... Try the doc dir
        // first (true relative), then ROOT (repo-root-relative convention),
        // then a literal root join (strips ./ and ../ prefixes).
        let resolved = "";
        const bases = [abs, join(ROOT, "index.ts"), join(ROOT, "docs", "index.ts")];
        for (const base of bases) {
          try { resolved = await (Bun as any).resolve(spec, base); break; }
          catch { /* try next base */ }
        }
        if (!resolved) {
          const literal = join(ROOT, spec.replace(/^\.\.\//g, "").replace(/^\.\//g, ""));
          if (existsSync(literal)) resolved = literal;
        }
        if (!resolved) {
          importProblems.push({ file: f, line: i + 1, spec, detail: "cannot resolve from doc dir or repo root" });
        } else if (resolved === "bun") {
          // bun builtin: exports are Bun.* runtime properties (randomUUIDv7,
          // peek, $ etc.) — not a source file to scan. Verified by docs:api.
        } else {
          // ── exported-symbol alignment (§66): named imports must exist in
          // the resolved module's exports. Barrel re-exports followed.
          // REPORTED (not gate): 61 named imports / 36 resolvable / 0
          // mismatches on 1.4.0 — clean today, catches future rename drift.
          const nm = /^\s*import\s+\{([^}]+)\}\s+from\s+["\u0027]/.exec(line);
          if (nm) {
            const names = nm[1]!.split(",").map((x) => x.trim().split(/\s+as\s+/)[0]!.replace(/^type\s+/, "")).filter(Boolean);
            if (names.length) {
              const seen = new Set<string>();
              const queue = [resolved];
              while (queue.length) {
                const cur = queue.pop()!;
                if (seen.has(cur)) continue;
                seen.add(cur);
                let src = "";
                try { src = readFileSync(cur, "utf8"); } catch { continue; }
                const exportRe = /export\s+(?:const|function|class|let|var|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)|export\s+\{([^}]+)\}|export\s+\*\s+from\s+["\u0027]([^"\u0027]+)["\u0027]|export\s+\*\s+as\s+[^\s]+\s+from\s+["\u0027]([^"\u0027]+)["\u0027]/g;
                for (const em of src.matchAll(exportRe)) {
                  if (em[2]) for (const n of em[2].split(",")) { const t = n.trim().split(/\s+as\s+/)[0]!.replace(/^type\s+/, "").trim(); if (t) exports.set(t, true); }
                  if (em[3] || em[4]) { const p = join(dirname(cur), em[3] || em[4]!); try { if (existsSync(p + ".ts")) queue.push(p + ".ts"); else if (existsSync(p + ".tsx")) queue.push(p + ".tsx"); else if (existsSync(p + "/index.ts")) queue.push(p + "/index.ts"); else if (existsSync(p)) queue.push(p); } catch {} }
                }
                const directExports = src.match(/export\s+(?:const|function|class|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g) || [];
                for (const d of directExports) {
                  const n = /\s([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(d);
                  if (n) exports.set(n[1]!, true);
                }
              }
              for (const n of names) {
                if (!exports.has(n) && n !== "type" && n !== "default") {
                  importProblems.push({ file: f, line: i + 1, spec, detail: "import { " + n + " } — not found in exports of " + resolved.replace(ROOT + "/", "") });
                }
              }
            }
          }
        }
      }
    }
  }

  // ─── SRC-REFS (gate — docs vs source alignment, §65) ─────────────
  // Every src/-rooted path reference (prose, tables, code) must resolve
  // against the source tree. Prose artifacts and cd-pkg-relative refs
  // are classified, not failed.
  const srcRe = /(?:\b|[\`"\/\(])(?:(\.\.?)\/)?(src\/[A-Za-z0-9_\-./]+\.(?:ts|tsx|js|jsx))/g;
  // Historical narrative / alpha-relative refs (§65): domain.ts moved to
  // execution/domain.ts (89ef6a7); meta-audit.ts is player-profile-meta.ts;
  // run-watch/backtest resolve inside alpha/tennis-game-model after cd.
  const PROSE_SRC_ARTIFACTS = new Set(["src/tools", "src/...", "src/title", "src/index.ts", "src/runtime/api/", "src/tools/scripts/tests", "src/institutions/event-store/match-liquidity", "src/lib/ansi-width.ts", "src/partner/domain.ts", "src/research/meta-audit.ts", "src/run-watch.ts", "src/backtest.ts"]);
  const srcProblems: LinkProblem[] = [];
  let srcChecked = 0;
  for (const f of docs) {
    const abs = resolve(join(ROOT, "docs", f));
    const lines = readFileSync(abs, "utf8").split("\n");
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
      for (const m of line.matchAll(srcRe)) {
        const p = m[2]!;
        srcChecked++;
        if (PROSE_SRC_ARTIFACTS.has(p)) continue;
        if (/cd\s+[A-Za-z0-9_\-./]+\s*&&/.test(line)) continue; // package-relative
        const target = join(ROOT, p);
        if (!existsSync(target)) {
          srcProblems.push({ file: f, line: i + 1, kind: "src-ref", href: m[0]!, detail: "no such source file: " + p });
        }
      }
    }
  }
  // ─── report ──────────────────────────────────────────────────────
  let fails = 0;
  for (const p of srcProblems) {
    console.log("FAIL " + p.file + ":" + p.line + " [src-ref] " + p.href + " — " + p.detail);
    fails++;
  }
  console.log("--- LINKS: " + crossChecked + " cross-file + " + sameChecked + " same-anchor checked");
  for (const p of linkProblems) {
    console.log("FAIL " + p.file + ":" + p.line + " [" + p.kind + "] " + p.href + " — " + p.detail);
    fails++;
  }
  console.log("--- IMPORTS (report only — illustrative expected): " + importProblems.length);
  for (const p of importProblems) {
    console.log("report " + p.file + ":" + p.line + " " + p.spec + " — " + p.detail);
  }
  console.log("---");
  console.log("docs:integrity — " + (linkProblems.length ? String(linkProblems.length) + " broken links " : "all links ok ") + "· " + importProblems.length + " unresolved imports (reported) · " + srcProblems.length + " stale src refs (gate)");
  process.exit(fails === 0 ? 0 : 1);
}

await main();