# Semantic layer — glossary as root, registry as consumer

**Authority:** glossary owns **meaning**. Registry owns **structure** (column index, feature name, nullability). UI owns **placement**.

```
Glossary (semantic authority)          ids never rename for schema churn
    │
    ├─► Desk column registry  ── concept?: GlossaryId (FK, kind=registry)
    ├─► HQ tip("id") / panel  ── id is GlossaryId (ui | registry | composite)
    └─► Integrity audit       ── bidirectional (orphans + kind mismatch)
```

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

## Code map (this repo)

| Piece | Path |
|-------|------|
| Glossary SSOT | `src/institutions/glossary.ts` |
| Desk column registry | `src/institutions/column-registry.ts` |
| Integrity | `src/institutions/validate-glossary-integrity.ts` |
| HQ panel + tips | `src/research/hq-app/app.js` |
| API | `GET /api/glossary` |
| Gate | `bun run glossary:check` · pre-commit |
| Agent dump | `bun run glossary:dump` → `research/registry/glossary-dump.json` |
| Desk export facts | `artifacts-browser/SCHEMA.md` + `*.meta.json` columns |

## HQ tip keys vs registry

| Tip key | Kind | Relationship |
|---------|------|----------------|
| `balanceCents` | `ui` | Trading form — not a desk export column |
| `league` | `registry` | Same id as desk `league` feature |
| `avgKalshiVolumeFp` | `ui` | `mapsTo: "kalshi_volume"` (profile avg ≠ tick volume) |
| `ui.events.filter.reset` | `ui` | Pure chrome |

Prefer **same id** for “field is the concept.” Use `ui.*` only for pure presentation chrome. Use `mapsTo` when UI shadows a different registry feature.

## Ship order

1. ✅ Glossary `kind` + registry entries for desk columns  
2. ✅ Column registry + bidirectional validation  
3. ✅ `glossary:check` / dump  
4. Next: wire Events `sel(..., "league")` etc.  
5. Later: generate `RegistryConceptId` types; warehouse UI facets from registry  

## What agents should do

1. Read `glossary-dump.json` or `GLOSSARY_ENTRIES` for meaning.  
2. Never invent SQL for `ui.*` ids.  
3. For desk fields, use registry `feature` names; attach `concept` when exposing.  
4. For new tips, add glossary entry first, then `tip("id")`.
