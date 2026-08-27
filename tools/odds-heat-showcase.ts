#!/usr/bin/env bun
/**
 * `bun run showcase` — generate docs/odds-heat-showcase.html
 *
 * A self-contained, Bun-generated HTML artifact that documents how the Odds
 * Heat pipeline unifies on the Bun runtime: Blob-native XML parsing, the
 * color kernel + Bun.color, Bun.Image logos, metadata/integrity (ETag,
 * maps-lock triple lock), Bun.secrets (OS keychain) + pass:// vault routing,
 * and the isolated linker + global store. Numbers (books, venues, modules,
 * tests) are read from the repo at generation time — the artifact is a bake.
 *
 * Mermaid is loaded from CDN when viewed online; the page degrades to a
 * readable flow list offline.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "docs", "odds-heat-showcase.html");

// ── live inventory (generation-time facts, not marketing) ────────────────

function countLines(p: string): number {
  try {
    return readFileSync(join(ROOT, p), "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

const MODULES: Array<[string, string, string]> = [
  ["odds-registry/xml-feed.ts", "Bun.XML.parse", "odds-heat clusters → OddsEvent (match ids, venue coords, book keys)"],
  ["odds-registry/data-source.ts", "fetch + ladder", "live books → reference feed → declarations_only"],
  ["odds-registry/feed-client.ts", "fetch + <meta>", "per-book feeds, per-book failure isolation"],
  ["odds-registry/bookmakers.ts", "profile store", "name/feed/region/url/logo; registered:false fallback"],
  ["odds-registry/venue-store.ts", "Bun.color-free lookup", "venueKey (4dp) · name/city/tz · aliases · collisions"],
  ["odds-registry/consensus-history.ts", "bun:file persistence", "per (event, side) snapshots → classifyConvergence"],
  ["odds-registry/weather.ts", "fetch + AbortSignal.timeout", "(coords, commence) → EventWeather (Open-Meteo, no key)"],
  ["odds-registry/report.ts", "Bun.markdown", "escape-at-source → Markdown → strict HTML preset"],
  ["odds-registry/chips.ts", "Bun.color + paint()", "ANSI chips: provenance, gradient, collision, movement"],
  ["odds-registry/book-logos.ts", "Bun.WebView + Bun.Image", "38 branded logo PNGs, rasterized + idempotent"],
  ["odds-registry/value-patterns.ts", "pure math", "consensus vs venue value detector + convergence"],
  ["odds-registry/display.ts", "Bun.WebView", "status card SVG/PNG (Bun.Image cannot decode SVG — probed)"],
];

const bunAPIs: Array<[string, string, string]> = [
  ["Bun.XML.parse", "Blob-native SIMD XML — accepts string/Blob/Buffer/Uint8Array. Compact shape: attributes as @keys, singleton collapse. Powers the whole odds-heat wire.",
    "Probed: bare BunFile rejected; wrap bytes in Blob. Attributes @venue/@book/@commence."],
  ["Bun.XML.parse (config)", "The 38-book registry config is ALSO Bun.XML — one parser for wire + config, zero hand-rolled XML.",
    "load.ts normalizes the singleton-collapse trap: repeated child with ONE occurrence becomes an object."],
  ["Blob unification", "Every ingest path funnels to bytes/blob before parse: fetch bodies, Bun.file().text(), feed-client responses — the parser contract never changes per source.",
    "xml-feed.test: Blob input parses identically to string."],
  ["Bun.Image", "Book logos + brand swatches + tile re-encode. Probed 1.4.0 limits: no SVG decode (WebView rasterizes instead), no raw-pixel constructor (rgbaPng hand-encodes), ICC/Display-P3 survives transcode.",
    "img.width is -1 until an awaited terminal; read ground truth via await img.metadata()."],
  ["Metadata & integrity", "Content-addressed ETags (sha-256 → 304/412), maps.toml triple-lock (Bun.hash hex across runtime + bun-types + docs ref), --metafile-md bundle budgets (contributor caps).",
    "/api/odds-report + /docs serve If-None-Match → 304."],
  ["Bun.secrets", "OS keychain credential store (src/lib/secrets.ts) — Kalshi API keys live in the keychain, never in .env; tests cover get/set/delete + NO_COLOR-safe fallbacks.",
    "Vault routing: env.template documents pass:// Proton Pass injection per out; feed adapters read api-key-ref env indirection instead of raw keys."],
  ["Bun linker (isolated)", "Machine bunfig: linker=isolated + globalStore=true → node_modules/.bun store + cache/links/<pkg>@<ver>-<entry_hash> mounts (16-hex closure hash).",
    "Grounding probes read bun-types docs through the store — then were made portable (stable node_modules/bun-types path) after worktree/CI ENOENTs."],
  ["Bun.color + kernel", "cssColor/ansiColor/tint + parseExtendedColor (lab/lch/oklab/oklch/hsv) — the kernel exceeds Bun.color's surface. Chips use RGB tuples via Bun.color(rgb,'ansi') with the probed env-depth contract.",
    "Probed: FORCE_COLOR overrides NO_COLOR and caps depth; TERM=dumb → ''; no TTY detection on 'ansi'."],
  ["Bun.markdown", "Report + docs rendering via presets (gfm/docs/dashboard/strict). Probed: not sanitized → tagFilter + escape-at-source for wire input; heading ids for TOC.",
    "ODDS_REGISTRY + 67 docs render through the same pipeline (docs:check)."],
  ["Bun.WebView", "SVG rasterization (status card, 38 book logos) — Bun.Image cannot decode SVG on 1.4.0 (probed). Retry pattern survives WebKit contention.",
    "data: URL HTML → screenshot buffer → Uint8Array → Bun.write."],
  ["Bun.serve", "Route table + fetch fallback; dir routes (sendfile, Range/206, ETag/304/412, openat2 O_RESOLVE_BENEATH) for /registry/* and /assets/books/*.",
    "Probed: HTML route sourcemaps off in production; bun:sqlite for caches."],
  ["Bun.env (bootstrap)", "NO_COLOR / FORCE_COLOR / TERM read at bootstrap for color depth; ODDS_LIVE_FEED + api-key-ref at runtime via Bun.env/process.env. Runtime mutation has no effect on color — probed.",
    "check.yml pins NO_COLOR=1; FORCE_COLOR=1 downgrades to 16-color (gradient caveat)."],
];

// ── counts ───────────────────────────────────────────────────────────────

const cfgXml = readFileSync(join(ROOT, "config/odds-registry.xml"), "utf8");
const bookCount = (cfgXml.match(/<bookmaker /g) ?? []).length;

const venueStore = JSON.parse(readFileSync(join(ROOT, "config/odds-venues.json"), "utf8")) as { venues: unknown[] };
const venueCount = venueStore.venues.length;

const logoDir = join(ROOT, "public/assets/books");
const logoCount = existsSync(logoDir) ? readdirSync(logoDir).filter((f) => f.endsWith(".png")).length : 0;

const moduleStats = MODULES.map(([p, api, note]) => ({ p, api, note, lines: countLines("src/institutions/" + p) }));
const totalLines = moduleStats.reduce((a, m) => a + m.lines, 0);

const testFiles = ["xml-feed", "data-source", "consensus-history", "bookmakers", "venue-store", "weather", "report", "chips", "pipeline", "bookmakers"];
let testCount = 0;
const testDir = join(ROOT, "tests/institutions/odds-registry");
for (const f of readdirSync(testDir)) {
  if (!f.endsWith(".test.ts")) continue;
  testCount += (readFileSync(join(testDir, f), "utf8").match(/\btest\(/g) ?? []).length;
}

// ── html helpers ─────────────────────────────────────────────────────────

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const flow = `
flowchart LR
  subgraph ING["Ingestion — per-book feeds"]
    A["odds-heat XML<br/>v3 JSON · ws"] -->|"bytes / Blob"| C["Bun.XML.parse<br/>SIMD · no deps"]
    B["config/odds-registry.xml<br/>38 books"] --> C2["Bun.XML.parse<br/>(same parser)"]
  end
  C --> D["data-source ladder<br/>live → reference → declarations_only"]
  D --> E["OddsEvent[]<br/>id · venue lat,long · book · source"]
  E --> F["bookmakers.ts<br/>profiles: url/logo"]
  E --> G["venue-store.ts<br/>venueKey · tz · aliases"]
  E --> H["consensus-history.ts<br/>prior snapshot"]
  E --> I["weather.ts<br/>(coords, commence)"]
  F --> J["report.ts<br/>escape-at-source"]
  G --> J
  H --> J
  I --> J
  J --> K["Bun.markdown<br/>strict preset"] --> L["/api/odds-report<br/>ETag/304"]
  J --> M["chips.ts<br/>Bun.color gradient"]
  C2 -.->|"capacity floor ≥34"| D
`;

const mermaid = flow.trim().replace(/\n/g, "\n  ");

const card = (title: string, body: string, note: string) =>
  `<div class="card"><h3>${esc(title)}</h3><p>${body}</p>${note ? `<p class="note">${esc(note)}</p>` : ""}</div>`;

const moduleRows = moduleStats
  .map((m) => `<tr><td><code>${esc(m.p)}</code></td><td>${esc(m.api)}</td><td>${esc(m.note)}</td><td class="num">${m.lines}</td></tr>`)
  .join("\n");

const apiCards = bunAPIs.map(([t, b, n]) => card(t, esc(b), n)).join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Odds Heat — unified on Bun</title>
<style>
  :root { --bg:#0b0e14; --panel:#131826; --fg:#d7dee9; --dim:#8b95a7; --acc:#4da3ff; --ok:#3fb27f; --line:#232b3a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:0.95rem/1.55 -apple-system,"Segoe UI",sans-serif; padding:2rem clamp(1rem,4vw,3rem) 4rem; max-width:1200px; margin-inline:auto; }
  a { color:var(--acc); }
  a:focus-visible { outline:2px solid var(--acc); outline-offset:2px; }
  h1 { font-size:1.5rem; letter-spacing:0.02em; }
  h1 span { color:var(--acc); }
  h2 { font-size:1.15rem; margin:2.5rem 0 1rem; border-bottom:1px solid var(--line); padding-bottom:0.5rem; }
  h3 { margin:0 0 0.4rem; font-size:0.95rem; color:var(--acc); }
  .sub { color:var(--dim); margin:0.2rem 0 0; }
  .statbar { display:flex; flex-wrap:wrap; gap:0.75rem; margin:1.25rem 0; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:0.7rem 1.1rem; }
  .stat b { font-size:1.3rem; color:var(--acc); display:block; }
  .stat span { color:var(--dim); font-size:0.8rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:1rem; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:1rem 1.2rem; }
  .card p { margin:0.35rem 0; font-size:0.88rem; }
  .card .note { color:var(--dim); font-size:0.78rem; border-left:2px solid var(--acc); padding-left:0.6rem; }
  code { font-family:ui-monospace,Menlo,monospace; font-size:0.82rem; color:var(--acc); background:#0d1220; padding:0.1rem 0.35rem; border-radius:5px; }
  .mermaid { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:1rem; }
  table { width:100%; border-collapse:collapse; font-size:0.85rem; }
  th,td { text-align:left; padding:0.45rem 0.6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:600; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; }
  td.num { text-align:right; color:var(--acc); font-family:ui-monospace,monospace; }
  .mermaid-error { color:#e67e22; font-size:0.85rem; }
  footer { margin-top:3rem; color:var(--dim); font-size:0.78rem; border-top:1px solid var(--line); padding-top:0.8rem; }
</style>
</head>
<body>
<h1>Odds Heat <span>· unified on Bun 1.4</span></h1>
<p class="sub">One blob pipeline: Bun.XML → domain stores → consensus → markdown/ANSI — with Bun.Image logos, keychain secrets, content-addressed metadata, and the isolated linker. Generated by <code>tools/odds-heat-showcase.ts</code> from live repo state.</p>

<div class="statbar">
  <div class="stat"><b>${bookCount}</b><span>books in registry</span></div>
  <div class="stat"><b>${venueCount}</b><span>venues in store</span></div>
  <div class="stat"><b>${logoCount}</b><span>logo PNGs baked</span></div>
  <div class="stat"><b>${moduleStats.length}</b><span>pipeline modules</span></div>
  <div class="stat"><b>${totalLines}</b><span>pipeline lines</span></div>
  <div class="stat"><b>${testCount}</b><span>focused tests</span></div>
</div>

<h2>Pipeline</h2>
<div class="mermaid">
<pre class="mermaid-error" hidden>mermaid unavailable offline — flow: odds-heat XML → Bun.XML.parse → data-source ladder → OddsEvent[] → stores (books/venues/history/weather) → report.ts → Bun.markdown → /api/odds-report · chips</pre>
<div class="mermaid mermaid-src" hidden>
${mermaid}
</div>
</div>

<h2>Unified on Blob — Bun.XML</h2>
<div class="grid">
${card("One parser, every source", "Wire feeds, registry config, and reference fixtures all parse through <code>Bun.XML.parse</code> — string, Blob, Buffer, or Uint8Array. SIMD-backed, zero hand-rolled XML in the repo.", "Probed: bare BunFile rejected — ingest wraps bytes in Blob first.")}
${card("Compact shape → domain split", "Attributes as <code>@keys</code>, repeated children as arrays, singleton collapse guarded by <code>asArray</code>. The wire split: <code>venue=\"lat,long\"</code> → event location; <code>book=\"key\"</code> → bookmaker; teams + commence → match-derived event id.", "Probed: repeated child with ONE occurrence collapses to an object — normalize with asArray.")}
${card("Failure surface", "Unparseable prints drop; malformed/out-of-range coords attach no location; identity-less clusters stay standalone \"event\" placeholders. The report degrades per row — never a 500.", "escapeMarkdownCell + strict preset keep wire input inert in HTML.")}
</div>

<h2>Stores &amp; state — metadata, secrets, linker</h2>
<div class="grid">
${card("Metadata & integrity", "Content-addressed ETags: sha-256 of the report/docs body → If-None-Match 304. maps.toml triple-lock: Bun.hash across runtime version + bun-types + docs ref, self-healed by <code>docs:refresh</code>. Bundle budgets from --metafile-md (contributor caps).", "routes:check keeps the manifest honest: every served pathname must be declared (caught /api/odds-report).")}
${card("Bun.secrets — keychain, not .env", "Kalshi API credentials live in the OS keychain via <code>Bun.secrets</code> (src/lib/secrets.ts): get/set/delete + no-echo fallbacks, tested. Proton Pass vault routes injection (<code>pass://…</code> in env.template); feed adapters only ever read <code>api-key-ref</code> indirection — raw keys never enter prompts, shell history, or the repo.", "Keychain-locked test env degrades to no-creds (fail-closed).")}
${card("Bun linker — isolated + global store", "Machine bunfig: <code>linker=isolated</code> + <code>globalStore=true</code> → <code>node_modules/.bun</code> store + <code>cache/links/&lt;pkg&gt;@&lt;ver&gt;-&lt;entry_hash&gt;</code> (16-hex dependency-closure hash). Grounding probes read bun-types docs through the store; after worktree/CI ENOENTs they resolve through the stable <code>node_modules/bun-types</code> path with a version guard.", "7× warm CI on lockfile + cache with wiped node_modules — documented in the parent monorepo.")}
${card("Runtime env — bootstrap-read", "<code>NO_COLOR</code>/<code>FORCE_COLOR</code>/<code>TERM</code> set color depth at bootstrap; runtime mutation is invisible. Probed matrix: FORCE_COLOR overrides NO_COLOR and caps depth (=1 downgrades the chip gradient to 16-color; COLORTERM does not rescue). check.yml pins NO_COLOR=1 for determinism.", "ODDS_LIVE_FEED=1 opens the live ladder; everything else stays simulated by default.")}
</div>

<h2>Module inventory</h2>
<table>
<thead><tr><th scope="col">Module</th><th scope="col">Bun primitive</th><th scope="col">Responsibility</th><th scope="col">Lines</th></tr></thead>
<tbody>
${moduleRows}
</tbody>
</table>

<h2>Bun API cards</h2>
<div class="grid">
${apiCards}
</div>

<footer>Generated ${new Date().toISOString()} · Bun ${Bun.version} · ${testCount} focused tests across ${MODULES.length} modules · <a href="/api/odds-report">/api/odds-report</a> · <code>bun run odds:report</code> · <code>bun run book:logos</code></footer>

<script type="module">
  // Mermaid renders online; offline the page falls back to the readable
  // flow description (hidden pre block above).
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mod.default.initialize({ startOnLoad: false, theme: "dark" });
    const src = document.querySelector(".mermaid-src");
    if (src) {
      const el = document.createElement("div");
      el.className = "mermaid";
      el.textContent = src.textContent.trim();
      src.replaceWith(el);
      await mod.default.run({ nodes: [el] });
    }
  } catch (e) {
    document.querySelector(".mermaid-error")?.removeAttribute("hidden");
  }
</script>
</body>
</html>
`;

await Bun.write(OUT, html);
console.log(`showcase — wrote ${OUT.replace(ROOT + "/", "")} (${(Bun.file(OUT).size ? statSync(OUT).size : 0)} bytes)`);
