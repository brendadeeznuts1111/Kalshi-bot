# Core tech stack (Bun-native) — grounded

Agent checklist for Kalshi-bot. Prefer native Bun over npm. Deep API map:
[`BUN_NATIVE.md`](BUN_NATIVE.md) · time dual-stamp: [`TIME.md`](TIME.md) · shell: [`BUN_SHELL.md`](BUN_SHELL.md).

**Hubs:** [docs/llms.txt](https://bun.com/docs/llms.txt) · [API reference](https://bun.com/reference) · [Bun APIs overview](https://bun.com/docs/runtime/bun-apis)

| Status | Meaning |
| ------ | ------- |
| **yes** | Used in this repo |
| **partial** | Available / used lightly |
| **—** | Not adopted (documented alternative) |

---

## Runtime & language

| Rule | Here |
| ---- | ---- |
| Bun latest stable, native APIs only | **yes** — pin `bun-types@1.4.x` in `package.json`; run with Bun |
| TypeScript `strict: true` | **yes** — [`tsconfig.json`](../tsconfig.json) |
| `"types": ["bun"]` (or bun-types package) | **yes** — `"types": ["bun"]` loads the `bun-types` package surface |
| Branded domain IDs | **yes** — event-store brands, market-registry brands, partner execution brands; mint sortables via [`mintSortableId()`](../src/lib/ids.ts) (UUID v7) |
| Boundary parse | **yes** — `zod` at edges only; interior branded / domain types |

```jsonc
// tsconfig.json (excerpt)
{
  "compilerOptions": {
    "strict": true,
    "types": ["bun"],
    "moduleResolution": "bundler",
    "noEmit": true
  }
}
```

---

## HTTP & WebSockets

| API | Status | Repo |
| --- | ------ | ---- |
| `Bun.serve()` | **yes** | Research report browser [`serve.ts`](../src/research/serve.ts); regulatory example |
| `Server` / `ServerWebSocket` from `"bun"` | **partial** | Server routes; client orderbook uses browser/`WebSocket` + Kalshi TLS |
| Client `WebSocket` | **yes** | [`kalshi-ws.ts`](../src/bot/kalshi-ws.ts) |

```ts
// @see https://bun.com/docs/runtime/http/server
// @see https://bun.com/reference/bun/serve
import type { Server } from "bun";

const server: Server = Bun.serve({
  fetch(req) {
    return new Response("ok");
  },
});
```

---

## File I/O

| API | Status | Repo |
| --- | ------ | ---- |
| `Bun.file` → `.exists()` / `.json()` / `.text()` / `.slice()` | **yes** | config, reports, artifacts, color check |
| `Bun.write` | **yes** | artifacts, journals, stdout |

---

## Database

| API | Status | Repo |
| --- | ------ | ---- |
| `bun:sqlite` | **yes** | event-store, research cache, experiments |
| Drizzle on sqlite | **yes** | [`src/db/`](../src/db/) — typed SQL layer |
| `Bun.sql` / `Bun.SQL` | **—** | Not adopted; sqlite + drizzle own the plane |
| Redis / `Bun.RedisClient` | **—** | Not in process; vault/health are separate |

---

## Shell & processes

| API | Status | Repo |
| --- | ------ | ---- |
| `$` template | **yes** | [`gh.ts`](../src/research/gh.ts), network probes · [`BUN_SHELL.md`](BUN_SHELL.md) |
| `Bun.spawn` / `spawnSync` | **yes** | agent IPC, rate-budget |
| `Bun.which` | **yes** | preflight `gh`, protonpass CLI |

---

## Utilities (ground truth)

| API | Usage | Status | SSOT / call sites |
| --- | ----- | ------ | ----------------- |
| `Bun.randomUUIDv7` | Trace IDs, PKs (`hex` / `base64` / `buffer`) | **yes** | [`mintSortableId`](../src/lib/ids.ts) — journal, orders, experiments, leases |
| `Bun.sleep` / `sleepSync` | Delays (Date form supported) | **yes** | rate-limit, retries (`sleepSync` rare) |
| `Bun.nanoseconds` | High-precision **duration** | **yes** | phase-timing, live poll — **not** event wall-clock ([`TIME.md`](TIME.md)) |
| `Bun.peek` / `peek.status` | Settled-promise inspect | **yes** | [`bun-settle.ts`](../src/research/bun-settle.ts) |
| `Bun.deepEquals` | Deep equality | **yes** | inspect-utils |
| `Bun.inspect` / `.table` | Debug + TTY tables | **yes** | [`table-schema.ts`](../src/lib/table-schema.ts) + analyze/shortlist schemas · patterns `--inspect`, protonpass health |
| `Bun.JSONL.parse` / `.parseChunk` | JSONL parse + incremental chunk streaming (byte-offset carry) | **yes** | [`src/lib/jsonl.ts`](../src/lib/jsonl.ts) — live-tracker logs, WebView WS captures |
| `Bun.escapeHTML` | HTML entities | **yes** | views / boards |
| `Bun.stringWidth` / `stripANSI` / `wrapAnsi` | TTY width | **yes** | terminal-out, report-term |
| `Bun.fileURLToPath` / `pathToFileURL` | URL ↔ path | **partial** | as needed |
| `Bun.resolveSync` | Module resolution | **—** | rare |
| `Bun.version` / `revision` / `main` / `env` | Runtime metadata | **yes** | `Bun.env`; CLIs use `import.meta.main` |
| `Bun.openInEditor` | `$EDITOR` jump | **yes** | pattern editor |

Pure entropy (temp names, browser form) may stay on `crypto.randomUUID()` (v4).

---

## Compression

| API | Status | Repo |
| --- | ------ | ---- |
| `gzip` / `gunzip` | **yes** | fantasy coefficients wire |
| `deflate` / `inflate` | **partial** | available |
| `zstdCompress[Sync]` / `zstdDecompress[Sync]` | **yes** | audit evidence |

---

## Markdown

| API | Status | Repo |
| --- | ------ | ---- |
| `Bun.markdown.html` | **yes** | [`markdownToHtml`](../src/lib/markdown.ts) presets: `gfm` / `docs` / `dashboard` / `strict` |
| `Bun.markdown.ansi` | **yes** | [`markdownToAnsi`](../src/lib/markdown.ts), report-term |

GFM defaults: tables / strikethrough / tasklists **on**. Opt-in: `autolinks`, `headings`, `tagFilter`, `noHtmlBlocks`, … — full table in [BUN_NATIVE § markdown](BUN_NATIVE.md#bunmarkdown--native-markdown--html--ansi).

**Do not** add `marked` / `markdown-it` / `remark` for standard MD→HTML.

---

## Color

| API | Status | Repo |
| --- | ------ | ---- |
| `Bun.color` (css / hex / ansi / …) | **yes** | [`src/lib/color/`](../src/lib/color/) · partner visuals · `colors:artifacts` |

---

## Testing

| API | Status | Repo |
| --- | ------ | ---- |
| `bun:test` — `describe` / `test` / `expect` / `mock` | **yes** | `tests/**`, alpha packages; package script `--isolate --timeout 15000` |
| `expectTypeOf` | **yes** | `*.types.test.ts` (compile-time; prove with `bun run typecheck`) |
| Snapshots | **yes** | e.g. tennis circuit contract |

---

## Code quality

| Rule | Here |
| ---- | ---- |
| No casual `any` / raw `unknown` interiors | Boundary: zod + parse; brands inside |
| Import types from `"bun"` when Bun-native | e.g. `Server`, `Database` from `bun:sqlite` |
| `satisfies` over loose `as` | Domain tables / presets use `satisfies` |
| Small pure functions | Prefer helpers over fat classes |
| DI over God objects | Clients / fetch impls injected in bots & partners |

---

## Production readiness

| Concern | Here |
| ------- | ---- |
| Health / readiness | Partner risk-health, protonpass secret health, live canaries — not a single universal `/health` yet |
| Graceful shutdown | Recorders / serve abort paths; cron jobs bounded by duration |
| Structured logs + trace id | Prefer `mintSortableId()` for correlation IDs; domain loggers (protonpass) |
| Circuit breakers / retries / jitter | GitHub rate budget, Kalshi WS reconnect, factorial experiments |
| Config | `.env` auto-load + [`config.ts`](../src/lib/config.ts) TOML + `bunfig.toml` |
| Deploy | Operator machine + Cloudflare Pages for public portal; Docker optional |

---

## Interaction rules (for agents)

1. **Complete files** — no `// TODO implement` placeholders in shipped code.
2. **Tests** — nearest `*.test.ts` or new suite under `tests/`; run targeted then pre-commit.
3. **Quick-start**
   ```bash
   bun install
   bun run typecheck
   bun test --isolate --timeout 15000
   bun run report:term          # markdown.ansi
   bun run colors:artifacts     # markdown.html → docs/COLORS.html
   ```
4. **Before new deps** — re-check this table + [BUN_NATIVE API map](BUN_NATIVE.md#bun-api-map).
5. **`@see`** — guide + [reference](https://bun.com/reference) for Bun APIs.

---

## Deliberate non-adoptions

| Spec item | Why not (yet) |
| --------- | ------------- |
| `Bun.sql` | Event-store + research already on `bun:sqlite` + drizzle |
| `Bun.RedisClient` | No in-process Redis requirement |
| Universal `/health` | Domain-specific health (secrets, risk, canaries) first |
| npm `which` / `string-width` / `uuid` / `ms` / MD parsers | Replaced by Bun natives above |
