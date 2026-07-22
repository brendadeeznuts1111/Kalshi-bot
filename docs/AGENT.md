# Agent tools

CLI for pipeline status, research triggers, rotor verification, module lift suggestions, and headless web evidence capture.

## Commands

```bash
bun run agent status                    # dashboard API or local fallback (+ verification summary)
bun run agent audit-list                # shortlist vs rotor catalog
bun run agent suggest-lift              # per-component lift map (rotor-aware badges)
bun run agent run-research              # POST /api/research/run if dashboard up
bun run agent run-research --local        # always in-process (no HTTP)
bun run agent capture-evidence -- --url=https://kalshi.com/markets/...
bun run agent capture-evidence -- --market=KXHIGHNY-25JAN01
bun run agent verify-dashboard [--json] [--max-age-days=N] [--require-pulse]
```

JSON on parsed subcommands: append `--json` (no extra `--`).

```bash
bun run agent status --json
bun run agent suggest-lift --json
bun run agent audit-list --json --run=2026-07-22T05-50-48-875Z
```

Use `--` only when passing through raw flags (e.g. `capture-evidence -- --url=…`).

Start the dashboard first when you want API-backed `status` / `run-research`:

```bash
bun run dashboard
# other terminal:
bun run agent status
```

## Closed loop (Kalshi-bot ↔ rotor)

```
research --export-audit  →  rotor ingest (findings + evidence)
        ↓                           ↓
   cache.db / latest.md      audit-catalog.json
        ↓                           ↓
 agent audit-list  ←—— pulse.log (bun run pulse:start in ~/Projects)
        ↓
 agent suggest-lift (✓ / ⚠ / ✗ per component)
```

No monorepo imports — the agent reads rotor files as plain JSON (`ROTOR_ROOT`, `AUDIT_CATALOG_PATH`).

## `status`

Latest run, pulse tick, dashboard phase, and a **one-line rotor verification summary** when a shortlist exists:

```text
Rotor verification: 1 verified, 1 watchlist, 4 unverified
```

Missing catalog → warning only (all repos treated as unverified). Same summary is on `GET /api/status` as `verification`.

## `audit-list`

Cross-references the latest shortlist against `tools/audit-catalog.json` under `ROTOR_ROOT`.

```bash
bun run agent audit-list
bun run agent audit-list --repo=openfi-dao/kalshi-trading-bot
bun run agent audit-list --run=2026-07-22T05-50-48-875Z
```

| `verification` | Meaning |
|----------------|---------|
| `verified` | In rotor catalog (high-value tier) and last pulse tick ok |
| `watchlist` | Watchlist finding in catalog (`meta.tier: watchlist`) |
| `unverified` | Not in catalog, or high-value but pulse not ok |

## `suggest-lift`

Reads the latest (or `--run <id>`) research run from `cache.db` and emits a **component map** — strongest shortlist repo per scoring component (auth, orders, tests, docs, maintenance, risk).

Each line includes rotor badges: **✓ verified**, **⚠ watchlist**, **✗ unverified**. JSON includes `verified`, `verification`, and `findingId` on recommendations and shortlist entries.

Designed for an LLM or human deciding what to lift into a composite bot.

## `capture-evidence`

Uses headless [`Bun.WebView`](https://bun.com/blog/bun-v1.3.12#bun-webview-headless-browser-automation) to:

1. Navigate to a Kalshi market URL
2. Capture a PNG screenshot
3. Write sha3-256 digest + manifest under `research/evidence-captures/` (gitignored)

Headless only today (`headless: false` throws). Human UI uses `Bun.serve` + system browser.

## `verify-dashboard`

Pipeline self-check: **`GET /api/status`** plus headless **WebView** load of `/` to confirm `#agent-dashboard-meta` matches the API (run id, timestamp, shortlist).

```bash
bun run dashboard
bun run agent verify-dashboard
bun run agent verify-dashboard --json --require-pulse
```

Exit **0** = pass, **1** = fail.

## Environment

| Variable | Purpose |
|----------|---------|
| `DASHBOARD_URL` | Base URL (default `http://127.0.0.1:3457`) |
| `DASHBOARD_PORT` | Port when `DASHBOARD_URL` unset |
| `ROTOR_ROOT` | Monorepo root for `pulse.log` and audit catalog |
| `AUDIT_CATALOG_PATH` | Override path to `tools/audit-catalog.json` |
| `DASHBOARD_VERIFY_MAX_AGE_DAYS` | Verify freshness window (default 21) |
| `DASHBOARD_VERIFY_REQUIRE_PULSE` | Set `1` to require pulse ok |
| `DASHBOARD_FETCH_TIMEOUT_MS` | API timeout (default 5000) |

## Files

| File | Role |
|------|------|
| [`cli.ts`](../src/agent/cli.ts) | Subcommand router |
| [`dashboard-client.ts`](../src/agent/dashboard-client.ts) | HTTP client + local fallback |
| [`audit-list.ts`](../src/agent/audit-list.ts) | Rotor catalog cross-reference |
| [`suggest-lift.ts`](../src/agent/suggest-lift.ts) | Component lift recommendations |
| [`capture-evidence.ts`](../src/agent/capture-evidence.ts) | WebView screenshot + hash |
| [`verify-dashboard.ts`](../src/agent/verify-dashboard.ts) | WebView + API parity checks |

See also [`DASHBOARD.md`](DASHBOARD.md).
