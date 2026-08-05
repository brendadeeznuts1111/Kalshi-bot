# Design System — Kalshi HQ

**SSOT:** `src/institutions/design-tokens.ts` (tokens) · `src/institutions/hq-ui.ts` (components)
**Agent:** `src/agent/design-agent.ts` · **Live manifest:** `/api/design` · **Self-audit:** `/api/design/audit`

## Brand

| | |
|---|---|
| Name | Kalshi HQ |
| Wordmark | `KALSHI` + accent `HQ` |
| Tagline | Research · Alpha · Trading |
| Voice | terminal-dense, monospace numerals, no decoration without data |

## Tokens (v1.0.0)

Dark-first palette. Semantic colors: `acc` #4da3ff (links/active), `ok` #3fb27f,
`warn` #e0a93e, `bad` #e05e5e — badges use 15%-alpha tints of the same hue.
Surfaces: `bg` → `panel` → `panel2` (three-step elevation), `line` borders.
Type: system sans body, monospace for all numbers/prices/ids.

Rules:
- Views import `TOKENS` / `baseCssVars()` — never hardcode hex or radii.
- Versioning: MAJOR = token removed/meaning changed, MINOR = token added, PATCH = value tweak.

## Components (`hq-ui.ts`, individually versioned)

| Component | v | Use |
|---|---|---|
| `badge` | 1.0.0 | semantic status pill (ok/warn/bad/dim) |
| `statCard` | 1.0.0 | headline metric + unit + subline |
| `panel` | 1.0.0 | titled section container |
| `dataTable` | 1.0.0 | canonical table; `num` columns right-aligned mono, `tooltip` feeds `hint` |
| `hint` | 1.0.0 | `?` tooltip dot — copy from `glossary.ts` TOOLTIPS only |
| `tag` | 1.0.0 | neutral keyword chip |

Import: `import { badge, statCard, dataTable, componentCss } from "../institutions/hq-ui.ts";`
Embed `baseCssVars() + componentCss()` once per page `<style>`.

Add — never rename — registry entries; bump a component's version when its markup contract changes.

## Design agent

`DesignAgent.manifest()` → full token/component/brand payload (what `/api/design` serves).
`DesignAgent.audit(html)` → flags hardcoded hex colors and px radii not in TOKENS.
`/api/design/audit` runs the audit against the live HQ page on every call —
a passing audit (`ok: true`) is the merge gate for view changes.

## Tooltips & copy

Tooltip text lives in `src/institutions/glossary.ts` (`TOOLTIPS`) — the design
system owns *how* hints render, the glossary owns *what* they say.
