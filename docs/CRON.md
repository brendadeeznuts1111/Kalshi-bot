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

**OS-persistent is primary** — survives reboot, fresh process each fire, `gh` auth via user keychain.

**In-process** `Bun.cron(schedule, handler)` is intentionally **not** used here — research belongs in a standalone worker, not inside `serve.ts`.

## Defaults

| Constant | Value | Meaning |
|----------|-------|---------|
| `RESEARCH_CRON_TITLE` | `kalshi-research-weekly` | launchd plist / crontab marker |
| `RESEARCH_CRON_SCHEDULE` | `0 6 * * MON` | Monday 06:00 **system local** time |

Override via env or CLI flags:

```bash
RESEARCH_CRON_SCHEDULE="0 9 * * MON-FRI" bun run schedule:register
```

## Setup

```bash
# Preview next fires (UTC parse — see TZ note below)
bun run schedule:preview

# Register (macOS → ~/Library/LaunchAgents/bun.cron.kalshi-research-weekly.plist)
bun run schedule:register

# Optional: export audit on each scheduled run
# Add RESEARCH_EXPORT_AUDIT=1 to launchd EnvironmentVariables or shell profile

# Remove
bun run schedule:remove
```

## Logs (macOS)

```bash
tail -f /tmp/bun.cron.kalshi-research-weekly.stdout.log
tail -f /tmp/bun.cron.kalshi-research-weekly.stderr.log
```

Inspect registration:

```bash
launchctl list | grep bun.cron
```

## Time zones

| Form | Time zone |
|------|-----------|
| `Bun.cron(path, schedule, title)` (OS) | System local |
| `Bun.cron.parse()` / in-process | UTC |

Set `TZ=UTC` in the launchd plist if you need OS and parse preview to agree.

## Requirements

- Bun ≥ 1.3.11 (cron API)
- `gh auth login` for the registering user (same as manual `bun run research`)
- Cross-platform schedules: prefer `@weekly`, `0 6 * * MON`, `*/15 * * * *` — avoid `*/7 * * * *` on Windows (48-trigger cap)

## Files

| File | Purpose |
|------|---------|
| [`scheduled.ts`](../src/research/scheduled.ts) | OS worker — `export default { scheduled }` |
| [`schedule-cli.ts`](../src/research/schedule-cli.ts) | register / remove / preview |
| [`constants.ts`](../src/research/constants.ts) | `RESEARCH_CRON_*` defaults |
| [`cli.ts`](../src/research/cli.ts) | `runResearch()` SSOT |
