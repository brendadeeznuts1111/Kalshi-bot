/**
 * showcase.ts — the driven showcase builder.
 *
 * One builder powers THREE surfaces (CLI `bun run showcase`, GET /showcase
 * HTML, GET /api/showcase JSON) from one declarative manifest
 * (config/odds-showcase.json5). Everything is derived from live repo state:
 *
 *   - stats are RESOLVED from sources (registry books, venue store, baked
 *     logos, module line counts, test counts, route-manifest entries) —
 *     no hand-typed numbers anywhere;
 *   - prose sections are Markdown files rendered through Bun.markdown.html
 *     (docs preset: tagFilter + autolinks + heading ids) — copy lives in
 *     docs/showcase/*.md, not in code;
 *   - the module table, TOC, meta tags, and links are generated from the
 *     same data (route-manifest + filesystem);
 *   - the mermaid diagram is a source file (docs/showcase/pipeline.mmd).
 *
 * Edit the manifest or the .md files; never the generated HTML.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { docsLinkRewriter, markdownToStyledHtml } from "./markdown.ts";
import { ROUTE_MANIFEST } from "../research/route-manifest.ts";
import { TOKENS } from "../institutions/design-tokens.ts";

// ── colors: palette SSOT + env overrides — no hex literals in this file ──

export type ShowcaseColors = {
  bg: string;
  panel: string;
  line: string;
  fg: string;
  dim: string;
  accent: string;
  warn: string;
};

/**
 * Resolve showcase colors: design-token defaults, overridable per key via
 * SHOWCASE_* env vars (documented in env.template). Values always come from
 * the palette SSOT or the operator — never a literal in this file.
 */
export function showcaseColors(env: Record<string, string | undefined> = Bun.env): ShowcaseColors {
  const c = TOKENS.color;
  const pick = (envKey: string, token: string): string => {
    const v = env[envKey];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : token;
  };
  return {
    bg: pick("SHOWCASE_BG", c.bg),
    panel: pick("SHOWCASE_PANEL", c.panel),
    line: pick("SHOWCASE_LINE", c.line),
    fg: pick("SHOWCASE_FG", c.fg),
    dim: pick("SHOWCASE_DIM", c.dim),
    accent: pick("SHOWCASE_ACCENT", c.acc),
    warn: pick("SHOWCASE_WARN", c.warn),
  };
}

export type ShowcaseStats = { label: string; value: number | string; source: string };

export type ShowcaseSection = {
  id: string;
  heading: string;
  kind: "markdown" | "mermaid" | "modules";
  html: string;
};

export type ShowcaseData = {
  schema: string;
  title: string;
  description: string;
  generatedAt: string;
  bunVersion: string;
  stats: ShowcaseStats[];
  sections: ShowcaseSection[];
  links: string[];
  mermaid: string;
};

// ── live-mapped stats ────────────────────────────────────────────────────

type ShowcaseModule = { file: string; primitive: string; note: string };

const MODULES: ShowcaseModule[] = [
  { file: "xml-feed.ts", primitive: "Bun.XML.parse", note: "odds-heat clusters → OddsEvent (match ids, venue coords, book keys)" },
  { file: "data-source.ts", primitive: "fetch + ladder", note: "live books → reference feed → declarations_only" },
  { file: "feed-client.ts", primitive: "fetch + <meta>", note: "per-book feeds, per-book failure isolation" },
  { file: "bookmakers.ts", primitive: "profile store", note: "name/feed/region/url/logo; registered:false fallback" },
  { file: "venue-store.ts", primitive: "store", note: "venueKey (4dp) · name/city/tz · aliases · collisions" },
  { file: "consensus-history.ts", primitive: "Bun.file persistence", note: "per (event, side) snapshots → classifyConvergence" },
  { file: "weather.ts", primitive: "fetch + AbortSignal.timeout", note: "(coords, commence) → EventWeather (Open-Meteo, no key)" },
  { file: "report.ts", primitive: "Bun.markdown", note: "escape-at-source → Markdown → strict HTML preset" },
  { file: "chips.ts", primitive: "Bun.color + paint()", note: "ANSI chips: provenance, gradient, collision, movement" },
  { file: "book-logos.ts", primitive: "Bun.WebView", note: "38 branded logo PNGs, rasterized + idempotent" },
  { file: "value-patterns.ts", primitive: "pure math", note: "consensus vs venue value detector + convergence" },
  { file: "display.ts", primitive: "Bun.WebView", note: "status card SVG/PNG (Bun.Image cannot decode SVG — probed)" },
];

const modulePath = (file: string) => "src/institutions/odds-registry/" + file;

function moduleLines(file: string): number {
  const p = join(ROOT_DEFAULT, "src/institutions/odds-registry", file);
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").length : 0;
}

let ROOT_DEFAULT = process.cwd();
export function setRoot(root: string): void {
  ROOT_DEFAULT = root;
}

export function resolveStat(source: string): number | string {
  const [kind, sub] = source.split(":");
  switch (kind) {
    case "registry":
      if (sub === "books") {
        const cfg = readFileSync(join(ROOT_DEFAULT, "config/odds-registry.xml"), "utf8");
        return (cfg.match(/<bookmaker /g) ?? []).length;
      }
      return 0;
    case "venues": {
      const p = join(ROOT_DEFAULT, "config/odds-venues.json");
      if (!existsSync(p)) return 0;
      return (JSON.parse(readFileSync(p, "utf8")) as { venues: unknown[] }).venues.length;
    }
    case "logos": {
      const dir = join(ROOT_DEFAULT, "public/assets/books");
      return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).length : 0;
    }
    case "modules":
      return sub === "count" ? MODULES.length : MODULES.reduce((a, m) => a + moduleLines(m.file), 0);
    case "tests": {
      const dir = join(ROOT_DEFAULT, "tests/institutions/odds-registry");
      let count = 0;
      if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
          if (!f.endsWith(".test.ts")) continue;
          count += (readFileSync(join(dir, f), "utf8").match(/\btest\(/g) ?? []).length;
        }
      }
      return count;
    }
    case "routes":
      return ROUTE_MANIFEST.length;
    default:
      return 0;
  }
}

// ── sections ─────────────────────────────────────────────────────────────

type ManifestSection = { id: string; heading: string; kind: "markdown" | "mermaid" | "modules"; source?: string };

function readRoot(rel: string): string {
  return readFileSync(join(ROOT_DEFAULT, rel), "utf8");
}

function buildSections(manifest: { sections: ManifestSection[]; options?: { mermaid?: boolean } }, filter?: string[]): ShowcaseSection[] {
  const out: ShowcaseSection[] = [];
  for (const s of manifest.sections) {
    if (filter && !filter.includes(s.id)) continue;
    if (s.kind === "mermaid") {
      if (manifest.options?.mermaid === false) continue;
      out.push({ id: s.id, heading: s.heading, kind: "mermaid", html: existsSync(join(ROOT_DEFAULT, s.source!)) ? readRoot(s.source!).trim() : "" });
      continue;
    }
    if (s.kind === "modules") {
      const rows = MODULES.map((m) =>
        `<tr><td><code>${esc(m.file)}</code></td><td>${esc(m.primitive)}</td><td>${esc(m.note)}</td><td class="num">${moduleLines(m.file)}</td></tr>`,
      ).join("");
      out.push({
        id: s.id,
        heading: s.heading,
        kind: "modules",
        html: `<div class="tablewrap"><table><thead><tr><th scope="col">Module</th><th scope="col">Bun primitive</th><th scope="col">Responsibility</th><th scope="col">Lines</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      });
      continue;
    }
    // markdown: styled renderer (Bun.markdown.render callbacks — heading
    // ids, language-tagged codeblocks, tablewrap, external-link attrs) +
    // docs-link rewriting; prose class applies the shared typography layer.
    const md = readRoot(s.source!);
    out.push({ id: s.id, heading: s.heading, kind: "markdown", html: `<div class="prose md">${markdownToStyledHtml(md, { rewriteHref: docsLinkRewriter() })}</div>` });
  }
  return out;
}

// ── data + render ────────────────────────────────────────────────────────

const MANIFEST_PATH = "config/odds-showcase.json5";

export async function buildShowcaseData(options: { sections?: string[] } = {}): Promise<ShowcaseData> {
  const manifest = Bun.JSON5.parse(readFileSync(join(ROOT_DEFAULT, MANIFEST_PATH), "utf8")) as {
    schema: string;
    title: string;
    description: string;
    options?: { mermaid?: boolean };
    stats: Array<{ label: string; source: string }>;
    sections: ManifestSection[];
    links: string[];
  };
  const stats = manifest.stats.map((s) => ({ label: s.label, source: s.source, value: resolveStat(s.source) }));
  return {
    schema: manifest.schema,
    title: manifest.title,
    description: manifest.description,
    generatedAt: new Date().toISOString(),
    bunVersion: Bun.version,
    stats,
    sections: buildSections(manifest, options.sections),
    links: manifest.links,
    mermaid: "",
  };
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

export function renderShowcaseHtml(data: ShowcaseData, colors: ShowcaseColors = showcaseColors()): string {
  const cssVars =
    `--bg:${colors.bg}; --panel:${colors.panel}; --line:${colors.line}; --fg:${colors.fg};` +
    ` --dim:${colors.dim}; --acc:${colors.accent}; --warn:${colors.warn};`;
  const toc = data.sections
    .map((s, i) => `<a href="#${esc(s.id)}">${i + 1} · ${esc(s.heading)}</a>`)
    .join(" · ");
  const statbar = data.stats
    .map((s) => `<div class="stat"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`)
    .join("");
  const sections = data.sections
    .map(
      (s) =>
        `<section id="${esc(s.id)}"><h2>${s.kind === "modules" ? esc(s.heading) : esc(s.heading)}</h2>${
          s.kind === "mermaid"
            ? `<div class="mermaid"><pre class="mermaid">${esc(s.html)}</pre><noscript><pre>${esc(s.html)}</pre></noscript></div>`
            : s.html
        }</section>`,
    )
    .join("\n");
  const links = data.links.map((l) => `<a href="${esc(l)}">${esc(l)}</a>`).join(" · ");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${esc(data.description)}" />
<meta property="og:title" content="${esc(data.title)}" />
<meta property="og:description" content="${esc(data.description)}" />
<meta name="generator" content="Bun ${esc(data.bunVersion)}" />
<title>${esc(data.title)}</title>
<style>
  :root { ${cssVars} }
  * { box-sizing:border-box; }
  body { margin:0 auto; max-width:1200px; background:var(--bg); color:var(--fg); font:0.95rem/1.55 -apple-system,"Segoe UI",sans-serif; padding:2rem clamp(1rem,4vw,3rem) 4rem; }
  a { color:var(--acc); }
  a:focus-visible { outline:2px solid var(--acc); outline-offset:2px; }
  h1 { font-size:1.5rem; } h1 span { color:var(--acc); }
  h2 { font-size:1.15rem; margin:2.5rem 0 1rem; border-bottom:1px solid var(--line); padding-bottom:0.5rem; }
  h3 { color:var(--acc); }
  .sub { color:var(--dim); }
  .statbar { display:flex; flex-wrap:wrap; gap:0.75rem; margin:1.25rem 0; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:0.7rem 1.1rem; }
  .stat b { display:block; color:var(--acc); font-size:1.3rem; }
  .stat span { color:var(--dim); font-size:0.8rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:1rem; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:1rem 1.2rem; }
  .card p { font-size:0.88rem; margin:0.35rem 0; }
  .card .note { color:var(--dim); font-size:0.78rem; border-left:2px solid var(--acc); padding-left:0.6rem; }
  code { font-family:ui-monospace,Menlo,monospace; font-size:0.82rem; color:var(--acc); background:var(--panel); padding:0.1rem 0.35rem; border-radius:5px; }
  .mermaid { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:1rem; overflow-x:auto; }
  .md h2 { font-size:1.05rem; margin:1.6em 0 0.6em; }
  .md h3 { font-size:0.95rem; margin:1.4em 0 0.5em; }
  .md p { font-size:0.88rem; margin:0.6em 0; }
  .md ul, .md ol { margin:0.5em 0; padding-left:1.4em; font-size:0.88rem; }
  .md li { margin:0.3em 0; }
  .md code { font-size:0.82em; }
  .md .codeblock { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:0.8rem 1rem; overflow-x:auto; max-width:100%; }
  .md .codeblock code { background:transparent; padding:0; color:var(--fg); }
  .md .tablewrap { overflow-x:auto; max-width:100%; }
  .tablewrap { overflow-x:auto; }
  pre { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:0.8rem 1rem; overflow-x:auto; max-width:100%; font-family:ui-monospace,Menlo,monospace; font-size:0.8rem; }
  pre code { background:transparent; padding:0; color:var(--fg); }
  ol { margin:0.4rem 0; padding-left:1.4rem; }
  ol li { margin:0.25rem 0; }
  table { width:100%; border-collapse:collapse; font-size:0.85rem; }
  th,td { text-align:left; padding:0.45rem 0.6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:600; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; }
  td.num { text-align:right; color:var(--acc); font-family:ui-monospace,monospace; }
  .toc { color:var(--dim); font-size:0.85rem; }
  @media (max-width: 480px) { body { padding:1rem; } }
  @media print { body { background:var(--panel); color:var(--fg); } a { color:var(--fg); } .skip, .statbar { display:none; } }
  footer { margin-top:3rem; color:var(--dim); font-size:0.78rem; border-top:1px solid var(--line); padding-top:0.8rem; }
</style></head><body>
<h1>${esc(data.title.split("—")[0]!.trim())} <span>· ${esc(data.title.split("—")[1]?.trim() ?? "Bun")}</span></h1>
<p class="sub">${esc(data.description)}</p>
<div class="statbar">${statbar}</div>
<p class="toc">Contents: ${toc}</p>
<main id="main">
${sections}
</main>
<footer>Generated ${esc(data.generatedAt)} · Bun ${esc(data.bunVersion)} · manifest: <a href="/api/showcase">config/odds-showcase.json5</a> · Links: ${links}</footer>
<script type="module">
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mod.default.initialize({ startOnLoad: false, theme: "dark" });
    document.querySelectorAll("pre.mermaid").forEach((el) => {
      const node = document.createElement("div");
      node.className = "mermaid";
      node.textContent = el.textContent.trim();
      el.replaceWith(node);
    });
    await mod.default.run({ nodes: [...document.querySelectorAll(".mermaid")] });
  } catch {
    // offline: the escaped diagram source stays visible as text
  }
</script>
</body></html>`;
}
