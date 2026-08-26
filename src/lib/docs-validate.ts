/**
 * docs-validate.ts — validate fenced code blocks in markdown docs via
 * Bun.Transpiler (probe-corrected rationale, AGENT-PITFALLS §59).
 *
 * Per block, with the language-tagged loader:
 *   - parse: transformSync(code, loader) throws on invalid syntax
 *   - target:"bun" (NOT node/browser) — emits the CJS-interop preamble,
 *     catching Bun-vs-Node import/require differences (probe: only "bun"
 *     changes output)
 *   - define: replaces process.env.* with a sentinel so env-dependent
 *     examples still parse (does NOT catch typos — probe: a typo'd key is
 *     silently left as-is)
 *   - trimUnusedImports as a STALE-IMPORT DETECTOR: compare import sets
 *     before/after trim — imports removed by trim were unused (stale code).
 */
import type { DocAudit } from "./docs-audit.ts";

export type CodeBlock = {
  file: string;
  language: string;
  code: string;
  line: number;
};

export type BlockValidation = {
  file: string;
  line: number;
  language: string;
  ok: boolean;
  error?: string;
  unusedImports?: string[];
};

/** Extract fenced code blocks (```lang … ```) with their line numbers. */
export function extractCodeBlocks(markdown: string, file: string): CodeBlock[] {
  const out: CodeBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(lines[i]!);
    if (m) {
      const lang = m[2] || ""; // untagged = not code (diagrams/pseudo)
      const start = i + 1;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*(```|~~~)\s*$/.test(lines[i]!)) { buf.push(lines[i]!); i++; }
      out.push({ file, language: lang, code: buf.join("\n"), line: start });
    }
    i++;
  }
  return out;
}

/** Map a code-block language tag to a Bun loader (default tsx). */
function loaderFor(lang: string): string {
  const l = lang.toLowerCase();
  if (l === "js" || l === "javascript") return "js";
  if (l === "jsx") return "jsx";
  if (l === "ts") return "ts";
  if (l === "tsx" || l === "typescript") return "tsx";
  return ""; // not a JS-family language — skip validation
}

/**
 * Validate one code block. Returns ok + any unused-import findings.
 * Env refs are defined with a sentinel so they parse; a typo'd env key is
 * NOT caught (define is exact-match only — probe §59).
 */
export function validateBlock(block: CodeBlock): BlockValidation {
  const loader = loaderFor(block.language);
  if (!loader) return { file: block.file, line: block.line, language: block.language, ok: true }; // non-JS block
  const t = new Bun.Transpiler({
    loader: loader as "js" | "jsx" | "ts" | "tsx",
    target: "bun",
    define: { "process.env.NODE_ENV": "\"test\"" },
  });
  const v: BlockValidation = { file: block.file, line: block.line, language: block.language, ok: true };
  try {
    // 1) parse + emit (target bun)
    const out = t.transformSync(block.code);
    // 2) stale-import detector: what did trimUnusedImports remove?
    const trim = new Bun.Transpiler({ loader: loader as "js" | "jsx" | "ts" | "tsx", trimUnusedImports: true });
    const trimmed = trim.transformSync(block.code);
    if (out !== trimmed) {
      const scan = new Bun.Transpiler({ loader: loader as "js" | "jsx" | "ts" | "tsx" }).scan(block.code);
      const unused = scan.imports.map((i) => i.path).filter((p) => !trimmed.includes(p));
      if (unused.length) v.unusedImports = unused;
    }
  } catch (e) {
    v.ok = false;
    v.error = String(e).split("\n")[0]!.slice(0, 100);
  }
  return v;
}

/** Validate all code blocks across the audited docs. */
export async function validateDocsCode(docs: DocAudit[]): Promise<BlockValidation[]> {
  const out: BlockValidation[] = [];
  for (const d of docs) {
    const md = await Bun.file(d.path).text();
    for (const block of extractCodeBlocks(md, d.path)) {
      out.push(validateBlock(block));
    }
  }
  return out;
}
/**
 * Language-specific validation dispatch. JS-family goes through
 * Bun.Transpiler; json/json5/toml/yaml/xml use Bun's native parsers
 * (probe-verified: good parses, bad throws); bash/sh use `bash -n -c`
 * (exit 0 good / 2 bad, probe §60).
 */
export type ValidatorResult = {
  ok: boolean;
  error?: string;
  unusedImports?: string[];
};

const JS_FAMILY = new Set(["js", "jsx", "ts", "tsx", "typescript"]);
const NATIVE = {
  json: (s: string) => JSON.parse(s),
  json5: (s: string) => Bun.JSON5.parse(s),
  jsonc: (s: string) => Bun.JSONC.parse(s), // Bun-native loader (probe §133: comments+trailing ok, quoted keys required)
  toml: (s: string) => Bun.TOML.parse(s),
  yaml: (s: string) => Bun.YAML.parse(s),
  xml: (s: string) => Bun.XML.parse(s),
  env: (s: string) => { for (const l of s.split('\n')) { const t = l.trim(); if (t && !t.startsWith('#') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) throw new Error('bad .env line: ' + l); } }, // Bun's .env loader shape
} as const;

async function validateNative(lang: string, code: string): Promise<ValidatorResult> {
  const fn = NATIVE[lang as keyof typeof NATIVE];
  if (!fn) return { ok: true }; // no validator for this language
  try { fn(code); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e).split("\n")[0]!.slice(0, 100) }; }
}

async function validateBash(code: string): Promise<ValidatorResult> {
  const { $ } = await import("bun");
  // Doc bash blocks are command EXAMPLES. Reassemble logical lines:
  //   1. `\` continuations (join, drop the backslash)
  //   2. multi-line quoted strings (join while quote depth is open)
  // then syntax-check each logical line. Placeholder notation <id> /
  // <run-id> / <sport_key> is NOT valid shell (bash reads < as
  // redirection) and is skipped.
  const raw = code.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const logical: string[] = [];
  let buf = '';
  let depth = 0; // 0 balanced, 1 in-single-quote, 2 in-double-quote
  const push = () => { if (buf) { logical.push(buf); buf = ''; } };
  for (const line of raw) {
    let i = 0;
    while (i < line.length) {
      const ch = line[i]!;
      if (ch === '\\' && depth) { i += 2; continue; } // escaped inside quotes
      if (ch === "'" && depth !== 2) depth = depth === 1 ? 0 : 1;
      else if (ch === '"' && depth !== 1) depth = depth === 2 ? 0 : 2;
      i++;
    }
    const cont = line.endsWith('\\') && !depth; // line continuation outside quotes
    buf += cont ? line.slice(0, -1) : line;
    if (!cont && !depth) push();
  }
  push();
  for (const cmd of logical) {
    if (/<[^\s>]+>/.test(cmd)) continue; // placeholder notation, not shell
    const r = await $`bash -n -c ${cmd}`.nothrow().quiet();
    if (r.exitCode !== 0) return { ok: false, error: 'bash syntax error: ' + cmd.slice(0, 60) };
  }
  return { ok: true };
}

/** Validate a block by its language tag. */
export async function validateBlockByLanguage(block: CodeBlock): Promise<ValidatorResult> {
  const lang = block.language.toLowerCase();
  if (JS_FAMILY.has(lang)) {
    const v = validateBlock(block);
    return { ok: v.ok, ...(v.error ? { error: v.error } : {}), ...(v.unusedImports ? { unusedImports: v.unusedImports } : {}) };
  }
  if (lang === "bash" || lang === "sh") return validateBash(block.code);
  if (lang in NATIVE) return validateNative(lang, block.code);
  return { ok: true }; // unknown language — no validator
}

/** Validate all blocks (language-aware). */
export async function validateDocsCodeLanguage(docs: DocAudit[]): Promise<Array<BlockValidation & ValidatorResult>> {
  const out: Array<BlockValidation & ValidatorResult> = [];
  for (const d of docs) {
    const md = await Bun.file(d.path).text();
    for (const block of extractCodeBlocks(md, d.path)) {
      const r = await validateBlockByLanguage(block);
      out.push({ file: block.file, line: block.line, language: block.language, ...r });
    }
  }
  return out;
}