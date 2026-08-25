# Semantic layer — glossary as root, registry as consumer

**Authority:** glossary owns **meaning**. Registry owns **structure** (column index, feature name, nullability). UI owns **placement**.

You are closest to: **controlled vocabulary + data dictionary + UI copy tokens**, not a full ontology.

```
Glossary (semantic authority)          ids never rename for schema churn
    │
    ├─► Desk column registry  ── concept?: GlossaryId (FK, kind=registry)
    ├─► HQ tip("id") / panel  ── id is GlossaryId (ui | registry | composite)
    ├─► Filter enums          ── resolveValues / filter-catalog / filterCatalog API
    ├─► Related terms         ── seeAlso[] → panel chips
    ├─► Units / lifecycle     ── unit ∈ UNITS · status active|deprecated|draft
    └─► Integrity audit       ── bidirectional + seeAlso/unit/status
```

## Pattern map (industry → Tennis HQ)

| Pattern | Your stack |
|---------|------------|
| Controlled vocabulary | `GLOSSARY_ENTRIES` + hard tip/controlled-label gate |
| Concept / term split | stable `id` · mutable `label` · `description` summary |
| Synonym / alias | `synonyms` on entries |
| Faceted taxonomy | `category` (domain) × `kind` (role: registry\|ui\|composite) |
| Foreign-key semantics | `ColumnMeta.concept` → glossary |
| Soft relations | `mapsTo` (ui → registry/composite); `seeAlso[]` for panel discoverability |
| Lifecycle | `status`: active (default) · deprecated (+ `deprecatedBy`) · draft |
| Units | `unit` ∈ `UNITS` keys — cents · usd · pp · pct · count · atMs · … |
| Data dictionary | registry + `featurePurpose` + glossary |
| UI copy tokens | `ui.*` ids |
| Governance | `glossary:check` / `:report` |
| Agent dump | `glossary-dump.json` |

**kind = structural consumer; category = browse facet.** Don’t conflate `category: "ui"` with `kind: "ui"`.

## Why glossary is root

| Registry owns meaning | Glossary owns meaning |
|-----------------------|------------------------|
| Rename feature → UI/docs break | `concept` id stays; registry updates `feature` |
| Agents confuse column names with concepts | Agents see `concept: "kalshi_mu"` |
| Two features can claim “market price” | IDs unique; `concept` is FK |

Registry changes for CSV order / SQLite migrations. Glossary concepts are **semantic** and outlive refactors.

## Three rules

### 1. Glossary IDs are the global namespace

| Kind | ID pattern | Example |
|------|------------|---------|
| `registry` | Exact desk/export `feature` name | `kalshi_mu`, `poly_volume`, `league` |
| `ui` | Camel tip keys or `ui.{context}.{purpose}` | `balanceCents`, `ui.events.filter.reset` |
| `composite` | `composite.{name}` | `composite.liquidity_score` |

- **label** may change for copy.
- **id** is stable (tip keys + registry FKs).

### 2. Registry features opt-in via `concept`

```ts
{ column: 11, feature: "kalshi_mu", concept: "kalshi_mu", … }
```

- `concept` optional (WIP features).
- If set → glossary entry **must** exist and `kind === "registry"`.

### 3. Bidirectional integrity (`glossary:check` / `semantic:audit`)

1. Every `concept` FK resolves + kind is `registry`.
2. Every `kind: "registry"` entry has a matching registry `feature` (or is marked pending).
3. HQ `tip("x")` keys exist in glossary (any kind).

### Pending registry (`PENDING_REGISTRY_CONCEPTS`)

Allowlist for `kind: "registry"` ids that board/HQ already use but are **not** yet on desk CSV `columns[]`:

| id | Why pending |
|----|-------------|
| `tier` | HQ / filter catalog only — desk export schema has not grown a tier column |
| `round` | Same — tournament round is a board filter, not a desk feature yet |

**Phase 1 decision (glossary polish):** keep `tier` / `round` **pending** — do not promote until desk CSV export actually emits those columns. Integrity still requires the glossary entries themselves to exist.

Do **not** remove from the allowlist until `column-registry.ts` gains matching features.

## Code map (this repo)

| Piece | Path |
|-------|------|
| Glossary SSOT | `src/institutions/glossary.ts` |
| Filter catalogs | `src/institutions/filter-catalog.ts` (`resolveValues` · no `LEAGUE_OPTIONS` mirrors) |
| Desk column registry | `src/institutions/column-registry.ts` |
| Integrity | `src/institutions/validate-glossary-integrity.ts` |
| HQ panel + tips | `src/research/hq-app/app.js` (uses `filterCatalog` from API) |
| API | `GET /api/glossary` → `entries` + `filterCatalog` |
| Gate | `bun run glossary:check` · pre-commit (includes `auditBoardFilterValues`) |
| Agent dump | `bun run glossary:dump` → `concepts[]` + `conceptsById` + id arrays |
| Desk export facts | `artifacts-browser/SCHEMA.md` + `*.meta.json` columns |

## HQ tip keys vs registry

| Tip key | Kind | Relationship |
|---------|------|----------------|
| `balanceCents` | `ui` | Trading form — not a desk export column |
| `league` | `registry` | Same id as desk `league` feature |
| `avgKalshiVolumeFp` | `ui` | `mapsTo: "kalshi_volume"` (profile avg ≠ tick volume) |
| `ui.events.filter.reset` | `ui` | Pure chrome |

Prefer **same id** for “field is the concept.” Use `ui.*` only for pure presentation chrome. Use `mapsTo` when UI shadows a different registry feature.

## Govern controlled UI labels

```bash
bun run glossary:report   # soft: list ungoverned sel()/label surfaces
bun run glossary:check    # hard: tip keys + integrity + controlled labels
```

Controlled catalog lives in `scripts/check-glossary-usage.ts` (`GOVERNED_SURFACES`).  
HQ uses `selGloss(id, label, …)` + `tip(id)` so labels stay linked to glossary ids.

## Filter options (single write path)

Board dropdowns read **glossary `values`** (and optional `valueLabels`), never parallel constants:

| Before | After |
|--------|--------|
| `TIER_ORDER` / `LEAGUE_OPTIONS` in HQ | `resolveValues("tier")` / `liveFilterChoices("league", live)` |
| Hardcoded when labels in `app.js` | `valueLabels` on `ui.events.filter.when` |
| Filter label `"League"` | `resolveLabel("league")` / `filterCatalog.league.label` |

```ts
// Server / SSR
import { liveFilterChoices, filterLabel } from "../src/institutions/filter-catalog.ts";
liveFilterChoices("surface", liveSurfaces);

// Browser — from GET /api/glossary
GLOSSARY.filterCatalog.tier.values; // closed set order
```

`glossary:check` fails if any `FILTER_CATALOG_IDS` concept lacks `values[]`.

Unknown tier display: `displayTier(raw)` → `resolveLabel("ui.filter.unclassified")`.

## Ship order

1. ✅ Glossary `kind` + registry entries for desk columns  
2. ✅ Column registry + bidirectional validation  
3. ✅ `glossary:check` / dump  
4. ✅ Events `selGloss` + report/hard gate  
5. ✅ Filter options from glossary `values` (kill duplicate catalogs)  
6. ✅ seeAlso · status · unit annotations (panel + integrity)  
7. Later: warehouse UI facets from registry; hide draft from hard consumers  

## seeAlso / status / unit

| Field | Role | Consumers |
|-------|------|-----------|
| `seeAlso: string[]` | Soft related terms (not inheritance) | HQ panel “related” chips · dump · search |
| `status` | `active` (default) · `deprecated` · `draft` | Panel badges · agents skip deprecated |
| `deprecatedBy` | Required when `status: "deprecated"` | Panel “replaced by” link |
| `unit` | Key of `UNITS` (cents, usd, pp, …) | Charts, exports, tooltips |

```ts
resolveSeeAlso("mid");     // → ["kalshi_mu", "spreadCents", "poly_mid"]
resolveUnit("surfaceEdge"); // → "pp"
resolveStatus("kalshi_mu"); // → "active"
```

Integrity (`glossary:check`) fails on missing seeAlso targets, unknown units, or deprecated without `deprecatedBy`.

## What agents should do

1. Read `glossary-dump.json` or `GLOSSARY_ENTRIES` for meaning.  
2. Never invent SQL for `ui.*` ids.  
3. For desk fields, use registry `feature` names; attach `concept` when exposing.  
4. For new tips, add glossary entry first, then `tip("id")`.

## Concept arrays (agent / API shape)

Prefer **arrays of records with `id`**, not bare maps as the primary surface.

| Field | Type | Role |
|-------|------|------|
| `concepts` | `GlossaryConceptRecord[]` | Primary ordered list (every element has `id`) |
| `conceptsById` | `Record<id, record>` | Secondary O(1) index (dump only; optional) |
| `conceptIdsByKind` | `{ registry, ui, composite: string[] }` | Kind browse |
| `filterConceptIds` | `string[]` | Board filters that must have `values[]` |
| `pendingRegistryConcepts` | `string[]` | Registry-kind not yet on desk columns |
| `entries` | same as `concepts` | API back-compat alias |

```ts
import { listConcepts, FILTER_CATALOG_IDS } from "./glossary.ts";

const concepts = listConcepts();           // array
const league = concepts.find((c) => c.id === "league");
// filters
for (const id of FILTER_CATALOG_IDS) { … }
```

Dump (`glossary:dump`) and `GET /api/glossary` share this shape (`schemaVersion: 5`). Concepts may include a resolved `color: { key, css, foregroundCss }` from the Bun-native color kernel (`src/lib/color/`).

## Naming lanes (alignment audit)

Keep these namespaces separate — same English word can mean different lanes.

| Lane | Example | Authority |
|------|---------|-----------|
| **Glossary id** | `league`, `ui.events.filter.when`, `kalshi_mu` | `GLOSSARY_ENTRIES` |
| **Registry feature** | `kalshi_mu`, `poly_volume` | desk column registry (snake_case) |
| **UI tip / camel** | `balanceCents`, `avgKalshiVolumeFp` | glossary `kind: ui`; often `mapsTo` registry |
| **Filter catalog** | `FILTER_CATALOG_IDS` | must have `values[]` (+ optional `valueLabels`) |
| **ROUTES** | `ROUTES.home = "/"` | research **report browser** only |
| **SERVE_PATTERNS** | `EXACT.hq = "/hq"`, `opsPartner` | HQ / ops / tennis **fetch** paths |
| **GitHub parse** | `:owner` / `:repo` | external URLs only — not `ROUTES.repo`’s `:name` |
| **Env** | `GITHUB_TOKEN` / `GH_TOKEN` | `declare module "bun" { interface Env }` in `config.ts` |
| **Tests** | `tests/research/patterns.test.ts` | mirror `src/<domain>/` — not flat `tests/patterns.test.ts` |

### Fixed / intentional duals

| Pair | Status |
|------|--------|
| `ROUTES.home` (`/`) vs HQ (`/hq`) | Intentional — EXACT key is **`hq`**, never `home` |
| `ROUTES.repo` `:name` vs GitHub `:repo` | Intentional — different lanes |
| `GITHUB_TOKEN` vs `GH_TOKEN` | Dual accepted; both on `Env` |
| `SERVE_URL` vs `OPS_DASHBOARD_URL` | Prefer `OPS_DASHBOARD_URL`; `SERVE_URL` legacy alias |
| `league` values | Must match `leagueFromSeries` (`ATP`, `WTA`, `ATP Challenger`, `WTA 125`, `ITF Men`, `ITF Women`) |
| `ITF-M` / `ITF-W` | **Tour** codes in event-store — not board `league` labels |

### When adding a board filter

1. Glossary entry with `values` (+ `valueLabels` if display ≠ code)  
2. Add id to `FILTER_CATALOG_IDS`  
3. HQ: `liveFilterChoices` / `choicesFromCatalog` only — no hardcode pairs  
4. `bun run glossary:check`
