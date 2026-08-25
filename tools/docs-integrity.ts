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
        }
      }
    }
  }

  // ─── report ──────────────────────────────────────────────────────
  let fails = 0;
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
  console.log("docs:integrity — " + (linkProblems.length ? String(linkProblems.length) + " broken links (gate) " : "all links ok ") + "· " + importProblems.length + " unresolved imports (reported)");
  process.exit(fails === 0 ? 0 : 1);
}

await main();