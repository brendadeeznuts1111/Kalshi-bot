# Design Pipeline — review & frontend-module enhancement plan

> Status: reviewed + deepened 2026-08-23. The build pipeline covers every
> frontend module with per-module metafiles + budgets; the token audit
> enforces ALL shipped surfaces (the only reported surfaces left are the
> dev-sandbox playground pages). This file is the operating card for the
> "metafile pipeline".

## 1. What the pipeline does

The metafile pipeline turns the design SSOT into shippable artifacts and
gates them. The metafile report (`dist/*.meta.md`, the LLM-friendly
`--metafile-md` output) is the analysis surface — bundle size, largest
modules, dependency chains — and `dist/*.meta.json` carries the byte-exact
per-entry sizes the budget gate reads.

```text
SSOT                                        Build                         Gates
────────                                    ─────                         ─────
src/institutions/design-tokens.ts  ─┐  design:build (scripts/        design:check
src/lib/color/*                     │  build-design-system.ts)        · token audit of every
src/institutions/hq-ui.ts           │  → dist/design-system.js           shipped surface
src/research/hq-app/app.js ─────────┤  → dist/hq-app.js                 (enforced; playground
src/research/hq-app/hash-routes.ts  │  → dist/<module>.meta.json         reported only)
src/research/hq-app/surface-edge.ts ┘  → dist/<module>.meta.md        · per-module bundle
                                                                    budgets (byte-exact)
src/partner/dashboard-data.ts ──── partner:dashboard (bakes           · renderHq() SSR ceiling
  (template -> TOKENS)                 the desk board to TOKENS)     · data-driven colors
                                                                    allowlisted via state.json
scripts/generate-color-artifacts.ts ── colors:artifacts                 colors:check
  → public/colors.css                    → hq-app/{color-vars,          · drift of generated
  → hq-app/color-vars.css                    token-vars}.css              CSS/registry/docs
  → hq-app/token-vars.css                 → docs/COLORS.{md,html}
  → docs/TOKENS.md                         → docs/TOKENS.md
  → public/registry/color-system.json      → public/registry/*
```

Entry points into the gates: `bun run check` (full local merge proof,
includes design:check) and the pre-commit hook (design:check + colors:check
fire conditionally on staged surface/pipeline files).

## 2. Frontend module inventory

| Module | Source | Bundle / artifact | Budget | Audit status |
|--------|--------|-------------------|--------|--------------|
| design-system (TOKENS + color kernel) | `src/institutions/design-system.ts` (+ `src/lib/color/*`, `design-tokens.ts`) | `dist/design-system.js` · **4.65 KB** · served at `/design-system.js` | 12 KB | enforced |
| hq-app (live HQ browser graph) | `src/research/hq-app/app.js` (+ `hash-routes.ts`, `surface-edge.ts`) | `dist/hq-app.js` · **48.50 KB** (73.8 KB source) | 64 KB | enforced |
| renderHq() SSR template | `src/research/hq-view.ts` | SSR HTML · **57.4 KB** | 128 KB ceiling | enforced (+ ceiling) |
| design-system.css (token vars + components) | `baseCssVars()` + `componentCss()` | served at `/design-system.css` (computed, never stored) | — | enforced (generated) |
| hq-ui component library | `src/institutions/hq-ui.ts` | SSR helpers, embedded via renderHq | — | enforced (via renderHq) |
| hq-app static files | `src/research/hq-app/{index.html,styles.css,app.js,color-vars.css,token-vars.css}` | served at `/hq` | — | enforced |
| partner-dashboard (baked desk board) | `public/partner-dashboard/index.html` + `src/partner/dashboard-data.ts` | static (regenerate: `bun run partner:dashboard`) | — | **enforced** (data-driven partner hexes allowlisted from state.json) |
| colors.css + registry | `public/colors.css`, `public/registry/*` | static | — | enforced (generated; colors:check drift gate) |
| playground (dev sandbox) | `playground/funding-playground*.html` | static | — | **reported** (20 issues, never blocks) |

`design:check` audits **11 surfaces**: 9 enforced (fail on issues) + 2
reported (playground only). The enforced set includes the migrated
partner-dashboard board — its per-partner identity hexes (getPartnerVisual)
are data-driven and are allowlisted exactly from the committed
`state.json`; all UI chrome must be TOKENS.

## 3. Review findings

### What's solid
- **One vocabulary enforced at merge time**: every shipped surface is
  audited in design:check AND pre-commit; the server self-checks live via
  `/api/design/audit`.
- **Byte-exact budgets from the metafile**: `outputs[].entryPoint -> bytes`.
- **Drift-checked generated artifacts**: colors/token CSS, TOKENS.md,
  registry fail `colors:check` when stale.
- **Profiling wired**: `profile:design` (--cpu-prof-md).

### Gaps closed by this pass
1. **Pipeline covered one module; the frontend is many.** hq-app's 73.8 KB
   browser graph now has `hq-app.js` + per-module metafiles + a 64 KB
   budget, and `design:watch` rebuilds both modules.
2. **Audit coverage stopped at hq-app.** partner-dashboard (15 issues) and
   playground (19) were invisible. Now: partner-dashboard is **migrated to
   TOKENS and enforced** (template in `dashboard-data.ts` emits token
   values; the baked board is compliant; data-driven partner identity hexes
   are allowlisted from `state.json` — UI chrome stays one-vocabulary).
   Playground stays reported as a dev sandbox.
3. **The dist design-system bundle had no consumer.** Now served at
   `/design-system.js`; the page CSS is served at `/design-system.css`
   and renderHq links it instead of inlining (57.4 KB vs 60.1 KB, cacheable).
4. **SSR output had no ceiling.** renderHq() now has a 128 KB budget gate
   (current 57.4 KB) — the template can't silently balloon.
5. **CLI watch wrote a stray duplicate** (`dist/app.js`): fixed with
   `--outfile=<module>.js` in build + watch.
6. **token-vars.css** is now in the pre-commit `colors:check` paths.
7. **Metafile analysis deepened**: the gate now reads the *largest
   single-module contributor* per bundle (design-system <= 4 KB, hq-app
   <= 60 KB), runs **dependency-graph checks** (import cycles fail; the only
   allowed external is the documented `bun` import in the design-system
   bundle), and tracks a **build-history trend** (`dist/bundle-history.json`,
   +25% growth vs previous build fails, +10% warns).
8. **The artifacts got live consumers**: `/design` is a token-inspector page
   that links `/design-system.css` (enforced surface), and
   `/api/design/budgets` exposes the gate's numbers (sizes, budgets, largest
   contributor, delta) as JSON.
9. **API + branding integration**: `/api/design` is now the COMPOSED
   design-status endpoint — manifest (brand/tokens/components) + `budgets`
   + `audit` health in one call. The live hq-app frontend (`app.js`) imports
   `TOKENS` from source and renders the balance chart with token values, and
   the color kernel gained a **pure-JS browser fallback** (`convertColorFallback`)
   with byte-parity tests — the served `design-system.js` bundle and the
   live page now execute WITHOUT Bun (verified under Node; parity proven for
   css/HEX/number/{rgb}/{rgba}/ansi-16m across all 15 palette keys).
   Constraint: `/hq` (Bun HTML import) cannot link runtime-served routes
   like `/design-system.css` (the bundler tries to resolve them as modules),
   so it keeps the generated `token-vars.css`; the served CSS is consumed by
   the inspector pages and external consumers.
10. **Browser-safe kernel hardened**: the fallback now covers hsl, lab
    (CSS Color 4, D50 Bradford-adapted — matches Bun to float precision) and
    ansi-256, proven by round-trip property tests (Bun is the oracle);
    byte-exact parity holds for the six cached formats the design system
    actually consumes. A **browser-safety lint** (design:check FAIL +
    `design:browser-safety` CLI) enforces that no graph file references Bun
    at runtime outside kernel.ts's `HAS_BUN_COLOR` guard — `typeof Bun`
    guards and string/comment mentions are exempt.
11. **Server-side token injection**: the live hq-app no longer bundles the
    color kernel — `app.js` fetches the composed `/api/design` manifest and
    uses its token colors for the chart (seeded with current TOKENS values).
    The live client bundle is now **zero Bun references** (verified in the
    served bundle); the fallback lives only in the standalone
    `dist/design-system.js` for external browser consumers.
13. **Git-correlated trend history**: every size-change entry in
    `dist/bundle-history.json` now records the git commit/branch/message
    (`gitSnapshot`), and `/design/trend` renders the commit per build — a
    size jump is directly attributable to the change that caused it.
14. **Output-level integrity (post-build)**: design:check also scans the
    BUILT bundles — a runtime `from "bun"` import (macro regression) or any
    `Bun.` reference in the hq-app bundle fails. The source lint (#10)
    prevents regressions at the source; this catches them in the artifact.
15. **Fuzz parity proof**: the fallback is now fuzz-tested — 200 random hex
    colors × all six cached formats are byte-identical to `Bun.color`
    (tests/lib/design-fuzz-parity.test.ts), beyond the 15-key palette.
    `design:report` also prints the top-3 module contributions per bundle.
16. **CORS for cross-UI sharing**: `/api/design`, `/api/design/budgets`,
    `/api/design/audit`, `/design-system.css`, `/design-system.js`,
    `/design`, `/design/trend` send `Access-Control-Allow-Origin` (default
    `*`, tighten with `DESIGN_CORS_ORIGIN`) — the feed aggregator's admin UI
    can link `/design-system.css` and fetch `/api/design` from another
    origin and render the same branding.

### Known limits (deliberate)
- `dist/` is gitignored: budgets are enforced locally (check/pre-commit),
  not in CI; GitHub Actions is a manual diagnostic only.
- The hq-app bundle is an **analysis artifact** — the runtime still serves
  the source graph via Bun HTML imports. Wiring the prebuilt bundle into
  `/hq` would trade dev HMR for a fixed artifact.
- `design:check` builds on demand when metafiles are missing.

## 4. Plan per frontend module

Status legend: ✅ done · 🟡 planned · ⛔ out of scope (documented).

### design-system bundle
- ✅ Multi-module build + per-module metafile + 12 KB budget.
- ✅ Served at `/design-system.js` + `/design-system.css`.
- ✅ `design:watch` rebuilds it live.
- ✅ `/design` token-inspector page consumes `/design-system.css`; budget
  numbers exposed at `/api/design/budgets`.
- 🟡 External projects importing `/design-system.js` for client-side token
  math — documented artifact, verified by curl + budget today.

### hq-app (browser module graph)
- ✅ Bundle analysis: 73.8 KB source → 48.50 KB minified, 64 KB budget.
- ✅ Largest-contributor budget (app.js 46.4 KB / 60 KB) — the monolith
  can't grow unboundedly.
- ✅ Part of `design:watch` / `design:build`.
- 🟡 Ship the minified artifact behind a flag (index.html swap + per-tab
  smoke test).
- 🟡 Split the 73.8 KB monolith into per-tab chunks — the metafile
  `Largest Modules` table (app.js 95.7% of the bundle) is the working list.

### renderHq() / hq-ui
- ✅ Enforced audit surfaces (0 issues) + 128 KB SSR output ceiling.
- ✅ Page links `/design-system.css` (token vars + component base styles)
  instead of inlining them.

### partner-dashboard (desk board)
- ✅ **Migrated to TOKENS**: template (`src/partner/dashboard-data.ts`)
  emits token values for `:root` palette, status color, badge/chip/code/th
  chrome; radii use `TOKENS.radius`; status uses `ok`/`bad` tokens.
- ✅ Committed baked board regenerated to match (same mapping applied to the
  committed snapshot) — enforced surface, 0 issues.
- ✅ Data-driven partner identity hexes allowlisted from `state.json`
  (partners + outs) via the audit's `{ legal }` option — the one design
  decision: identity colors are data, not vocabulary.
- ✅ Regression tests: committed board + generator template must stay
  token-compliant (tests/partner/dashboard-design.test.ts).

### playground (dev sandbox)
- ⛔ Kept as a dev sandbox with its own neon palette — not a shipped
  surface. 20 issues stay reported (visibility) and non-blocking.

### colors.css / registry
- ✅ Generated + drift-gated (`colors:check`), token-vars.css now in the
  pre-commit paths.

## 5. Tooling (built on the metafile data)

| Tool | Command | What it does |
|------|---------|--------------|
| Trend dashboard | `/design/trend` | renders `bundle-history.json` as a table + pure-CSS sparklines (no client libs) — the visual regression surface |
| Watch feedback | `bun run design:watch` | rebuilds both modules AND prints a one-line budget status after each save (shift-left) |
| Budget report | `bun run design:report` | markdown budget summary (PR-comment format); `-- --pr=N` posts via Bun.fetch when `GITHUB_TOKEN` is set |
| PR comment workflow | `.github/workflows/design-budget-comment.yml` | posts the report on pull_requests — **on hold** until hosted runners return (AGENTS.md: manual diagnostic only today) |
| Deps audit | `bun run design:audit-deps` | zero-npm-dep contract for the frontend bundles (fails) + `bun audit` passthrough |
| Dead imports | `bun run design:dead-imports` | heuristic scan for imported bindings never used in the module body (warning; `-- --fail` to gate) |
| Browser safety | `bun run design:browser-safety` | lints the graph for unguarded `Bun.` references (fails in design:check; `typeof Bun` guards + strings/comments exempt) |
| Image meta | `bun run images:meta <path...> [--to=...] [--resize=WxH]` | Bun.Image metadata table (token-colored) + re-encode/resize via `Bun.file().image()` |

The zero-npm-dep contract and the dead-import warning are ALSO wired into
design:check itself, so they run at every merge gate without extra commands.

## 6. Gate matrix (design:check)

| Surface | Mode | Gate |
|---------|------|------|
| renderHq(), hq-app/* (6 files) | enforced | fails on hardcoded color/radius |
| design-system.css (generated) | enforced | token-generated, fails on drift |
| partner-dashboard (board) | enforced | fails on non-token chrome; partner hexes allowlisted |
| public/colors.css | enforced | fails on non-token values (colors:check is the real drift gate) |
| design-system bundle | budget 12 KB + largest <= 4 KB | fails over budget/contributor |
| hq-app bundle | budget 64 KB + largest <= 60 KB | fails over budget/contributor |
| both bundles | build-history delta | +25% vs prev fails, +10% warns |
| both bundles | dependency graph | cycles fail; externals fail (except documented `bun`) |
| both bundles | zero-npm-dep contract | any node_modules module in the graph fails |
| both bundles | dead-import scan | warnings only (heuristic; see design:dead-imports) |
| both bundles | browser-safety lint | any unguarded `Bun.` ref outside kernel.ts's HAS_BUN_COLOR guard fails |
| both bundles | output integrity (built) | `from "bun"` leak or `Bun.` in hq-app.js output fails |
| hq-app (live) | server-side injection | token colors come from /api/design; live bundle has zero Bun refs |
| trend history | git correlation | entries carry commit/branch/message; /design/trend shows them |
| renderHq() SSR output | budget 128 KB | fails over ceiling |
| /design page | enforced surface | token-inspector, links /design-system.css |
| playground (2 files) | reported | prints issues; stays dev-only |

## 6. Commands

```bash
bun run design:build      # bundle design-system + hq-app (js + meta.json + meta.md)
bun run design:watch      # live rebuild of both modules (Ctrl-C stops both)
bun run design:check      # token audit (11 surfaces) + budgets + SSR ceiling
bun run colors:artifacts  # regenerate CSS/registry/docs from the kernel
bun run colors:check      # fail on stale generated artifacts
bun run partner:dashboard # re-bake the desk board (template -> TOKENS)
bun run profile:design    # CPU profile of the design build (--cpu-prof-md)
bun run check             # full local merge proof (includes design:check)
```

## 7. Brand-image production readiness

All `/brand/*` endpoints: **rate-limited** (shared limiter; the WebView card
has a tighter 30/min limiter), **param-validated** (400 on bad format/tone/
values/font URL; `w/h` clamped 100–4000; swatch `size` 16–512), **ETag +
`If-None-Match` → 304** (content-addressed), CORS, and **metrics**
(`/api/brand/metrics`: generation ms, cache hit/miss/error, per-template
served counts). SVG inputs are server-generated — no user SVG, no script
injection surface.

| Endpoint | Notes |
|----------|-------|
| `/brand.svg` | wordmark card SVG (ETag by design version) |
| `/brand/card.png` | WebView-rasterized, `?w&h&format=png\|jpeg\|webp\|avif&font=https…` (cached per version×size×format×font; warmed at boot) |
| `/brand/swatch/<token>.png` | solid token colors, `?size=` (ETag) |
| `/brand/badge.svg` | status card, `?tone=ok\|warn\|bad\|dim&text=` |
| `/brand/quote.svg` | quote card, `?quote=&by=` |
| `/brand/chart.svg` | bar preview, `?values=1,2,3` (1–12 numbers) |
| `POST /brand/purge` | admin cache purge (CSRF + rate limited) |
| `/api/brand/metrics` | generation time, hit/miss/error, cache size |
| `/health` | now also probes `Bun.Image` (real decode) + `Bun.WebView` |

Templates: badge, quote, chart (all token-built, audited surfaces). Dynamic
fonts: the WebView rasterizer accepts a validated https stylesheet URL
(`validateFontUrl` — non-localhost guard). AVIF is a supported `format`.
Animated GIF encoding is not offered (Bun.Image decodes GIF only) — future
extension. A client SDK / image admin UI remain documented nice-to-haves;
metrics + purge cover the ops needs today.

Brand assets: `/brand.svg` (token-built wordmark card, enforced surface) ·
`/brand/card.png` (the same card **rasterized via Bun.WebView** — the Bun 1.4.0
rasterizer path — 1200×630, cached per design version, decode-verified via
Bun.Image) · `/brand/swatch/<token>.png` (semantic token colors as images) ·
`bun run images:meta` (terminal metadata + conversion using the Bun.Image
constructor: in-memory decode, `.resize(fit)`/`.rotate()`/`.webp({quality})`
chain, Images as Response bodies, `--to/--resize/--fit/--rotate/--quality`).

Artifacts: `dist/design-system.js` (+ meta) · `dist/hq-app.js` (+ meta) ·
`dist/bundle-history.json` (trend) · served at `/design-system.js` +
`/design-system.css` · composed status (brand + tokens + budgets + audit)
at `/api/design` · budgets alone at `/api/design/budgets` · live audit at
`/api/design/audit` · token inspector at `/design` · trend at `/design/trend`.

The color kernel is browser-safe: `convertColorFallback` (pure JS) matches
`Bun.color` byte-for-byte for every cached format, proven by parity tests in
tests/lib/color-kernel.test.ts and by executing `dist/design-system.js`
under Node (no Bun global).
## 13. Combined pipeline report + per-module enhancement plans (§107)

`bun run design:pipeline-report` renders dist/pipeline.meta.md — the
"mtafile of mtafiles": every module's size vs budget, largest
contributor, growth vs history, and a DATA-DRIVEN enhancement plan per
module (derived from budget/contributor/growth status, not hardcoded
prose). Current findings (probe, 1.4.0):

- design-system 6.32 KB / 12 KB (largest 3.53 KB — color kernel, 55.8%,
  expected core weight) — keep the kernel lean; revisit
  maxContributorBytes when adding color formats.
- hq-app 48.70 KB / 64 KB — the app.js monolith is 95.8% of the bundle:
  consider chunking hash-routes.ts + surface-edge.ts out of the entry
  (the 60 KB maxContributorBytes budget forces the issue as it grows).

The report is pure (src/lib/pipeline-report.ts — unit-tested, 5 tests)
fed by the same buildBudgetHealth data as design:check and /api/design/
budgets, so the report, the gate, and the live API can never drift.

## 14. Builds verified (work-through, 2026-08-24)

`bun run design:build` → both modules rebuilt with fresh metafiles →
`bun run design:pipeline-report` → dist/pipeline.meta.md regenerated →
`bun run design:check` → ok · 0 enforced · 20 backlog (playground only)
· 32 surfaces. The full chain: build → analyze → gate, all green.

