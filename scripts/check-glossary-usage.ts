#!/usr/bin/env bun
/**
 * Glossary governance — fail if HQ tip("key") references unknown glossary ids.
 *
 * Usage:
 *   bun run glossary:check
 *   bun run glossary:check -- --verbose
 *
 * Scans hq-app + hq-view + serve for tip("…") and data-glossary="…".
 * Does not free-text scan all UI labels (too noisy).
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { GLOSSARY_ENTRIES, TOOLTIPS, buildGlossaryApiPayload } from "../src/institutions/glossary.ts";

const root = join(import.meta.dir, "..");
const scanRoots = [
  join(root, "src/research/hq-app"),
  join(root, "src/research/hq-view.ts"),
  join(root, "src/research/serve.ts"),
];

const known = new Set(GLOSSARY_ENTRIES.map((e) => e.id));
const tipRe = /\btip\s*\(\s*["']([A-Za-z0-9_]+)["']\s*\)/g;
const dataGlossaryRe = /data-glossary=["']([A-Za-z0-9_]+)["']/g;

function walk(path: string, out: string[]): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (/\.(js|ts|html|css)$/.test(path)) out.push(path);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    walk(join(path, name), out);
  }
}

function main() {
  const verbose = Bun.argv.includes("--verbose");
  const files: string[] = [];
  for (const r of scanRoots) walk(r, files);

  const used = new Set<string>();
  const unknown: Array<{ file: string; key: string }> = [];

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const re of [tipRe, dataGlossaryRe]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const key = m[1]!;
        used.add(key);
        if (!known.has(key)) {
          unknown.push({ file: relative(root, file), key });
        }
      }
    }
  }

  if (unknown.length) {
    console.error("glossary:check FAIL — tip()/data-glossary keys not in GLOSSARY_ENTRIES:");
    for (const u of unknown) console.error(`  ${u.file}: "${u.key}"`);
    process.exit(1);
  }

  const unused = GLOSSARY_ENTRIES.map((e) => e.id).filter((id) => !used.has(id));
  console.log(
    `glossary:check OK — ${known.size} entries · ${used.size} keys referenced · scanned ${files.length} files` +
      (unused.length ? ` · ${unused.length} unused (ok)` : ""),
  );
  if (verbose) {
    console.log("used:", [...used].sort().join(", "));
    if (unused.length) console.log("unused:", unused.join(", "));
  }

  const payload = buildGlossaryApiPayload();
  if (payload.schemaVersion !== 1 || !payload.entries.length || !Object.keys(TOOLTIPS).length) {
    console.error("glossary:check FAIL — payload invalid");
    process.exit(1);
  }
}

main();
