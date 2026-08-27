#!/usr/bin/env bun
/**
 * `bun run showcase [--out=FILE] [--json] [--sections=a,b] [--no-mermaid] [--stdout]`
 *
 * Driven showcase CLI — same builder as GET /showcase + /api/showcase,
 * backed by config/odds-showcase.json5 (stats resolved from live repo
 * state, prose rendered from docs/showcase/*.md via Bun.markdown.html).
 *
 *   bun run showcase                     # regenerate docs/odds-heat-showcase.html
 *   bun run showcase --json              # print the mapped data (no HTML)
 *   bun run showcase --stdout            # print HTML instead of writing
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { buildShowcaseData, renderShowcaseHtml } from "../src/lib/showcase.ts";

const { values: v } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: "string", default: "docs/odds-heat-showcase.html" },
    json: { type: "boolean", default: false },
    stdout: { type: "boolean", default: false },
    sections: { type: "string" },
    "no-mermaid": { type: "boolean", default: false },
  },
});

const sections = v.sections ? v.sections.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const data = await buildShowcaseData({ ...(sections ? { sections } : {}) });

if (v.json) {
  console.log(JSON.stringify(data, null, 2));
} else {
  const html = renderShowcaseHtml(data);
  if (v.stdout) {
    console.log(html);
  } else {
    await Bun.write(join(process.cwd(), v.out!), html);
    console.log(`showcase — wrote ${v.out} (${(await Bun.file(v.out!).size)} bytes)`);
  }
}
