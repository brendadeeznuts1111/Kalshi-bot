# Research scheduling (Bun.cron)

Weekly (or custom) research runs via **OS-level** Bun cron. The worker delegates to `runResearch()` — no duplicated pipeline logic.

Canonical API: [bun.com/docs/runtime/cron](https://bun.com/docs/runtime/cron)

## Entrypoints

| Command | Role |
|---------|------|
| `bun run research` | Manual one-shot pipeline |
| `bun run serve` | Report browser (read-only) |
| `bun run schedule:register` | Install OS cron job |
| `bun run schedule:remove` | Uninstall OS cron job |
| `bun run schedule:preview` | Preview next fire times (UTC) |

## Architecture

```
OS scheduler (launchd / crontab / Task Scheduler)
  → Bun.cron(SCHEDULED_WORKER_PATH, schedule, title)   # schedule-cli register
    → bun run --cron-title=<title> scheduled.ts
      → export default { scheduled() }
        → runResearch()   ← SSOT (cli.ts)
```

**OS-persistent** — survives reboot, fresh process each fire, `gh` auth via user keychain.

## Defaults

| Constant | Value | Meaning |
|----------|-------|---------|
| `RESEARCH_CRON_TITLE` | `kalshi-research-weekly` | launchd plist / crontab marker |
| `RESEARCH_CRON_SCHEDULE` | `0 6 * * MON` | OS register: Monday 06:00 **local** |

Override via env or CLI flags:

```bash
RESEARCH_CRON_SCHEDULE="0 9 * * MON-FRI" bun run schedule:register
bun run schedule:register -- --schedule="0 6 * * MON" --title=kalshi-research-weekly
bun run schedule:preview
bun run schedule:remove
```

Set `RESEARCH_EXPORT_AUDIT=1` on scheduled runs to also write audit JSONL + rotor bundle.

## Relation to serve

`bun run serve` is a read-only report browser. Scheduling is separate — register OS cron, do not keep a long-lived dashboard process.

## Master sports metadata loop

`bun run cron:start` owns the long-lived source metadata refresh alongside the price logger. It runs Kalshi and Polymarket source-global metadata discovery every 15 minutes, before the registry's 30-minute freshness deadline.

| Command | Role |
|---|---|
| `bun run sports:metadata:sync` | One-shot migration + both-venue acquisition + catalog projection |
| `bun run cron:start` | Start the in-process 15-minute metadata job |
| `bun run cron:once` | Run every master job once; exits nonzero if metadata venues fail |

The metadata job is single-flight, drains on graceful shutdown, and recovers abandoned cross-process runs after a five-minute no-progress lease. Adapter instances persist for the cron process lifetime so retry/circuit state survives individual ticks. Full registry mechanics: [`SPORTS_SOURCE_REGISTRY.md`](SPORTS_SOURCE_REGISTRY.md).

## Coverage inventory (plive/ezlive stream-list)

In-process job on `cron:start` (opt-in). Polls `stream-list-v2` → `skin_events`
(default sport `table_tennis`). Not seat-partner capital.

| Env | Role |
|-----|------|
| `INVENTORY_SYNC=1` | Enable job (legacy alias: `PARTNER_SYNC=1`) |
| `INVENTORY_SYNC_PUBLIC=1` | No real Fantasy login (inventory only; alias `PARTNER_SYNC_PUBLIC`) |
| `INVENTORY_SYNC_SPORT` | Default `table_tennis` (alias `PARTNER_SYNC_SPORT`) |
| `INVENTORY_SYNC_CRON_SCHEDULE` | Default every minute (alias `PARTNER_SYNC_CRON_SCHEDULE`) |

```bash
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 bun run cron:once
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 bun run cron:start
# or standalone:
bun run inventory:sync -- --loop --sport=table_tennis
```

See [`docs/FANTASY-ULTRA.md`](FANTASY-ULTRA.md).


## Tennis live canary

Separate job: dry-run `live_data` poll to the write boundary (zero SQLite score writes). Catches Kalshi schema/API drift before the aging loop is wrong.

| Command | Role |
|---------|------|
| `bun run tennis:live:canary` | One-shot `--canary` (exit 2 on fail) |
| `bun run tennis:live:canary:register` | Install OS cron (default `*/15 * * * *` local) |
| `bun run tennis:live:canary:preview` | Next fire times |
| `bun run tennis:live:canary:remove` | Uninstall |

See [`docs/TENNIS_PROGRAM_ARCHETYPES.md`](TENNIS_PROGRAM_ARCHETYPES.md) (Live dry-run as canary).

Override: `TENNIS_LIVE_CANARY_CRON_SCHEDULE`, `TENNIS_LIVE_CANARY_CRON_TITLE`.

## Tennis WS recorder

Separate job: authenticated orderbook WebSocket on the watch-set → `book_ticks` + session artifacts under `research/cache/tennis-ws-recorder/`. Requires `KALSHI_API_KEY_ID` + private key env.

| Command | Role |
|--------|------|
| `bun run tennis:record -- --ws --ws-seconds=300` | One-shot WS capture |
| `bun run tennis:record:ws:register` | Install OS cron (default `*/30 * * * *` local) |
| `bun run tennis:record:ws:preview` | Next fire times |
| `bun run tennis:record:ws:remove` | Uninstall |

Default schedule is every 30 minutes (`*/30 * * * *`) — cheap enough to catch live match windows without hammering the wire. Tighten to match hours only if needed (e.g. `*/30 6-23 * * *` local).

Override: `TENNIS_WS_RECORDER_CRON_SCHEDULE`, `TENNIS_WS_RECORDER_CRON_TITLE`, `TENNIS_WS_RECORDER_WS_SECONDS` (default 300).

See [`docs/TENNIS_PROGRAM_ARCHETYPES.md`](TENNIS_PROGRAM_ARCHETYPES.md) (WS recorder OS cron).

## Tennis factorial experiment (daily check)

| Action | Command |
|--------|---------|
| Manual check all active | `bun run tennis:experiment -- check-all` |
| Register OS cron | `bun run tennis:experiment:register` |
| Preview fires | `bun run tennis:experiment:preview` |
| Remove | `bun run tennis:experiment:remove` |

Default schedule: `0 9 * * *` (09:00 local). Worker: [`tools/tennis/experiment-scheduled.ts`](../tools/tennis/experiment-scheduled.ts). Persists artifacts via `dailyCheckAll` → `research/cache/tennis-experiments/` (each active experiment runs `dailyCheck`).

Override: `TENNIS_EXPERIMENT_CRON_SCHEDULE`, `TENNIS_EXPERIMENT_CRON_TITLE`.

Shadow metrics (not cron): `bun run tennis:experiment -- ingest --experiment=<id> --program=tennis-game-model`.

See [`docs/EXPERIMENT_FACTORIAL.md`](EXPERIMENT_FACTORIAL.md).

## Match liquidity (reactive ground)

Time-based pipeline (Bun.cron) is still the volume-backfill / snapshot owner.
For **immediate HTML ground after local ingest**, use `fs.watch` on the event-store:

```bash
bun run liquidity:ground:watch-db              # debounce 750ms, recompute + html-only ground
bun run liquidity:ground:watch-db -- --once    # one rebuild then exit
bun run liquidity:pipeline:register            # OS cron every 30m (volume optional)
```

SQLite WAL writes burst across `event-store.db`, `-wal`, and `-shm`; the watcher
coalesces events and serializes rebuilds.

