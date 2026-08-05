/**
 * One-shot extractor: splits the legacy template-string HQ page
 * (src/research/hq-view.ts) into Bun fullstack static assets under
 * src/research/hq-app/ so /hq can be served via an HTML import with
 * development { hmr, console } — HMR on frontend edits, browser logs in
 * terminal, sourcemaps in devtools.
 *
 * Re-runnable: bun tools/hq-extract.ts
 */
import { renderHq } from "../src/research/hq-view.ts";
import { joinPath } from "../src/research/paths.ts";

const html = renderHq();

const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!styleMatch || !scriptMatch) throw new Error("could not locate style/script blocks");

// Fix the legacy malformed button.cancel rule (unclosed block) during extraction
const css = styleMatch[1]!
  .replace(
    /button\.cancel \{ background: transparent; border: 1px solid var\(--bad\); color: var\(--bad\);\s*\n/,
    "button.cancel { background: transparent; border: 1px solid var(--bad); color: var(--bad);",
  );

// Tooltips move to a runtime fetch (/api/glossary) so glossary edits don't
// require regenerating the bundle.
const js = scriptMatch[1]!.replace(
  /const TOOLTIPS = .*?;\n/,
  "let TOOLTIPS = {};\nfetch('/api/glossary').then((r) => r.json()).then((t) => { TOOLTIPS = t; }).catch(() => {});\n",
);

const outHtml = html
  .replace(styleMatch[0], '<link rel="stylesheet" href="./styles.css" />')
  .replace(scriptMatch[0], '<script type="module" src="./app.js"></script>');

const dir = joinPath(import.meta.dir, "../src/research/hq-app");
await Bun.write(joinPath(dir, "index.html"), outHtml);
await Bun.write(joinPath(dir, "styles.css"), css);
await Bun.write(joinPath(dir, "app.js"), js);
console.log("extracted →", dir);
