# Pipeline Map — every pipeline, its SSOT, stages, gates and dashboard channel

> Status: consolidated 2026-08-25. One table per pipeline. The signal
> pipeline is the umbrella: every other pipeline reports its health into a
> dashboard channel. `bun run ops:pipelines` (scripts/pipeline-status.ts)
> prints the live terminal view of the table below — fully offline.

## Conventions

- **SSOT** — the single declarative source; everything else derives.
- **Stages** — the ordered transform chain.
- **Gates** — merge-time checks (pre-commit + `bun run check` / `verify:contracts`).
- **Channel** — the /dashboard channel the pipeline reports into.

## 1. Signal pipeline (umbrella)

| | |
|---|---|
| SSOT | `src/institutions/channel-registry.ts` (channels/actions/cron) |
| Stages | sources → signals → channels → actions (`src/institutions/signal-pipeline.ts`) |
| Artifacts | `.data/*.json` gate states (consumed, never fetched live) |
| Gates | `verify:contracts` (docs/refresh/routes gates) |
| Channel | all 12 channels — design · deps · brand · releases · ops · inventory · cron · prune · mapping · docs · compliance · github |
| Cron | `Bun.cron */5 * * * *` signal refresh + daily blog-map `0 3 * * *` |

## 2. Content pipeline (posts → hashes → ETags → prune)

| | |
|---|---|
| SSOT | `src/lib/content-pipeline.ts` (ingest/render/toc) + content manifest |
| Stages | frontmatter parse → renderMarkdownBody → content-hash (Bun.sha) → ETag/304 → prune (`.trash/` archive, Bun.Archive) |
| Artifacts | `/content/posts/*` served with ETag/conditional responses |
| Gates | `content:check` + `assets:check` (verify:contracts) |
| Channel | prune (`content-check` action) |

## 3. Design pipeline (TOKENS → bundles → metafiles → budgets)

| | |
|---|---|
| SSOT | `src/institutions/design-tokens.ts` + `src/institutions/hq-ui.ts` |
| Stages | design:build (`scripts/build-design-system.ts`) → `dist/*.meta.{json,md}` → design-budget gates (`src/lib/design-budget.ts`) |
| Artifacts | `dist/design-system.js` (4.65 KB) · `dist/hq-app.js` (48.5 KB) · `dist/*.meta.md` (the mtafile) |
| Gates | `design:check` + `colors:check` (enforced; playground reported only) — see `docs/DESIGN-PIPELINE.md` |
| Channel | design |

## 4. Docs pipeline (Bun docs cache + maps.toml triple-lock + repo docs gates)

| | |
|---|---|
| SSOT | `tools/bun-docs-index.ts` (discovery) + `src/lib/maps-lock.ts` (triple-lock) + `maps.toml` |
| Stages | discover (tag/repo/site) → fetch 333 pages → INDEX/DISCOVERY json → mapsHash lock → docs:refresh (weekly OS cron `0 6 * * 1`) |
| Artifacts | `research/cache/bun-docs/` · `maps.toml` · `.data/{docs,api,integrity,output}-state.json` |
| Gates | `docs:check` · `docs:api` (STRICT) · `docs:integrity` · `output:probe` · `docs:refresh` (verify:contracts #19) |
| Channel | docs |

## 5. Data pipelines

### Massey ratings (Bun.WebView fallback)

| | |
|---|---|
| SSOT | `src/institutions/massey/sports.ts` (MASSEY_SPORT_TARGETS) |
| Stages | fetch → Cloudflare 403? → circuit breaker → Bun.WebView → HTMLRewriter extract → parse → bun:sqlite WAL (massey_snapshots/ratings) |
| Gates | massey:sync freshness skip (`--max-age-hours`) |
| Channel | inventory |

### Event store (tennis ITF bridge + WS orderbook recorder)

| | |
|---|---|
| SSOT | `src/institutions/event-store/` (open-db, brands, recorder) |
| Stages | ITF sync → markets+events → WS book_ticks → derived tables (match_liquidity) |
| Artifacts | `research/cache/event-store.db` (6.2k events · 8.9k markets) |
| Gates | tennis:itf --sync · recorder capture |
| Channel | inventory |

### Sports/source registry

| | |
|---|---|
| SSOT | `src/institutions/market-registry/registry.ts` + `brands.ts` |
| Stages | declaration → discovery (source-metadata-runner) → inventory adapters → catalog payload |
| Artifacts | `public/registry/sports-sources.json` · `/api/registry/sports-sources` |
| Gates | sports:registry:check · sports:metadata:sync |
| Channel | inventory |

## 6. Compliance pipeline (license gate + SBOM)

| | |
|---|---|
| SSOT | `config/licenses-allowlist.json` + `tools/licenses-gate.ts` |
| Stages | bun pm licenses → SPDX eval → exemptions → CycloneDX XML twin (Bun.XML.stringify §104) → Telegram alerts (opt-in) |
| Artifacts | `research/outputs/licenses-sbom.xml` · `.data/licenses-state.json` |
| Gates | licenses:gate (verify:contracts + pre-commit) |
| Channel | compliance |

## 7. API surface (route manifest)

| | |
|---|---|
| SSOT | `src/research/route-manifest.ts` (~98 entries, layer-tagged) |
| Stages | serve.ts dispatch (exact → URLPattern → dir) enforced against the manifest |
| Gates | routes:check (verify:contracts #20) |
| Channel | n/a (documentation surface — /bun/api renders it) |
