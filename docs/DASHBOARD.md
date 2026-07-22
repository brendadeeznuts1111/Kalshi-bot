# Agent dashboard

Native **single-process** control surface for the research pipeline and rotor pulse monitor.

## Quick start

```bash
bun run dashboard          # opens system browser at http://127.0.0.1:3457
bun run agent status       # same data via CLI (local or API)
bun run report:term        # ANSI-rendered latest.md in terminal
bun run report:diff        # ANSI-rendered latest.diff.md
```

## Architecture

```
┌─────────────────────────────────────────┐
│  bun run dashboard (one Bun process)    │
│  ┌─────────────┐    ┌─────────────────┐ │
│  │ Bun.serve   │◀──▶│ runResearch()   │ │
│  │ HTML + API  │    │ cache / reports │ │
│  └──────┬──────┘    └─────────────────┘ │
│         │ fetch POST /api/research/run  │
│  ┌──────▼──────┐    ┌─────────────────┐ │
│  │ Browser UI  │    │ pulse.log tail  │ │
│  └─────────────┘    └─────────────────┘ │
└─────────────────────────────────────────┘
```

The UI and [`bun run agent`](AGENT.md) share the same HTTP routes — no npm deps, no separate API server.

### Bun.WebView note

`Bun.WebView` is **headless-only** today (`headless: false` throws). The dashboard uses your OS browser by default; WebView mode is for automation.

| Mode | Command | Use |
|------|---------|-----|
| **Default** | `bun run dashboard` | Opens system browser to `:3457` |
| **Headless WebView** | `bun run dashboard:webview` | Automation / verify-dashboard |
| **Read-only browser** | `bun run serve` | Report browser on `:3456` |

## Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | Dashboard (shortlist tiers, pulse, report iframe) |
| `/api/status` | GET | Run + pulse + `verification` summary JSON |
| `/api/research/run` | POST | Full research + audit export |
| `/api/pulse` | GET | Rotor pulse log ticks |
| `/reports/latest.md` | GET | Markdown report (shared with `serve`) |
| `/repo/:owner/:name` | GET | Per-repo detail page |

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `DASHBOARD_PORT` | `3457` | Listen port |
| `DASHBOARD_URL` | — | Agent CLI target when set |
| `ROTOR_ROOT` | `~/Projects` | Monorepo root for `pulse.log` and audit catalog |
| `AUDIT_CATALOG_PATH` | — | Override path to rotor `tools/audit-catalog.json` |

## Flags

```bash
bun src/agent/dashboard.ts --port=4000
bun src/agent/dashboard.ts --open=false
bun src/agent/dashboard.ts --webview --open=false
bun src/agent/dashboard.ts --cron --open=false              # pulse probe (6h UTC)
bun src/agent/dashboard.ts --cron-research --open=false       # weekly research (UTC)
```

**Cron:** OS-level weekly research (`bun run schedule:register`) uses **system local time**. In-process dashboard cron uses **UTC** — see [`docs/CRON.md`](CRON.md).

## Agent CLI (same surface)

| CLI | HTTP equivalent |
|-----|-----------------|
| `bun run agent status` | `GET /api/status` |
| `bun run agent run-research` | `POST /api/research/run` |
| `bun run agent audit-list` | reads `ROTOR_ROOT/tools/audit-catalog.json` |
| `bun run agent suggest-lift` | cache.db + catalog verification |
| `bun run agent verify-dashboard` | API + WebView parity |

Full command reference: [`AGENT.md`](AGENT.md).

## Files

| File | Role |
|------|------|
| [`src/agent/in-process-cron.ts`](../src/agent/in-process-cron.ts) | UTC `Bun.cron` pulse + optional research |
| [`src/agent/dashboard.ts`](../src/agent/dashboard.ts) | Entry: server, browser open, optional WebView |
| [`src/agent/dashboard-server.ts`](../src/agent/dashboard-server.ts) | Routes + POST handler |
| [`src/agent/dashboard-views.ts`](../src/agent/dashboard-views.ts) | HTML + client script |
| [`src/agent/dashboard-state.ts`](../src/agent/dashboard-state.ts) | In-process research lock |
| [`src/agent/pulse-log.ts`](../src/agent/pulse-log.ts) | Tail rotor `pulse.log` |
| [`src/agent/report-term.ts`](../src/agent/report-term.ts) | `Bun.markdown.ansi` CLI |

See also [`BUN_NATIVE.md`](BUN_NATIVE.md).
