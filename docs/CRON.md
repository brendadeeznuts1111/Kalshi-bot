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

| `bun run dashboard -- --cron` | In-process pulse probe (UTC) |
| `bun run dashboard -- --cron-research` | In-process weekly research (UTC) |

## Architecture

### OS-level (primary for desktop)

```
OS scheduler (launchd / crontab / Task Scheduler)
  → Bun.cron(SCHEDULED_WORKER_PATH, schedule, title)   # schedule-cli register
    → bun run --cron-title=<title> scheduled.ts
      → export default { scheduled() }
        → runResearch()   ← SSOT (cli.ts)
```

**OS-persistent** — survives reboot, fresh process each fire, `gh` auth via user keychain.

### In-process (dashboard / containers)

```
bun run dashboard -- --cron [--cron-research]
  → registerInProcessCron()   # in-process-cron.ts
    → Bun.cron(schedule, handler)   # UTC, shared state, no overlap
      → runPulseProbeTick() / runInProcessResearchTick()
```

Use when the dashboard (or agent daemon) stays up and should share sqlite + module state. See [v1.3.12 in-process cron](https://bun.com/blog/bun-v1.3.12#in-process-buncron-scheduler).

## Two cron forms

| Form | API | Time zone | Kalshi-bot entry |
|------|-----|-----------|------------------|
| **OS-level** | `Bun.cron(path, schedule, title)` | System local | `schedule:register` |
| **In-process** | `Bun.cron(schedule, handler)` | **UTC** | `dashboard --cron` / `--cron-research` |

### In-process behaviors

- **No overlap** — next fire waits until handler + `Promise` settle (Bun runtime); research also uses `beginResearch()` lock.
- **UTC** — `0 6 * * MON` = Monday 06:00 UTC (not local).
- **Errors** — sync throws → `uncaughtException`; rejected promises → `unhandledRejection`. Listeners in `in-process-cron.ts` / `scheduled.ts` log and allow reschedule (process does not exit).
- **`--hot` safe** — in-process jobs cleared on module re-eval when using `bun --hot`.
- **Disposable** — `using jobs = registerInProcessCron(...)` or dispose returned handles at shutdown.
- **`ref` / `unref`** — cron jobs `.ref()` by default (keep process alive with `Bun.serve`); call `.unref()` on a job if it should not hold the event loop alone.
- **Shared state** — direct access to `runResearch()`, cache, pulse log.

```bash
bun run dashboard -- --cron --open=false
bun run dashboard -- --cron-research --open=false
DASHBOARD_CRON_PULSE="0 */4 * * *" bun run dashboard -- --cron --open=false
```

## Defaults

| Constant | Value | Meaning |
|----------|-------|---------|
| `RESEARCH_CRON_TITLE` | `kalshi-research-weekly` | launchd plist / crontab marker |
| `RESEARCH_CRON_SCHEDULE` | `0 6 * * MON` | OS register: Monday 06:00 **local** |
| `PULSE_PROBE_CRON_UTC` | `0 */6 * * *` | In-process pulse probe (**UTC**) |
| `RESEARCH_CRON_IN_PROCESS_UTC` | `0 6 * * MON` | In-process research (**UTC**) |

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

# Optional: dimension-specific scheduled run (see research/dimensions.json)
# RESEARCH_DIMENSION=market-making bun run schedule:register

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
| [`in-process-cron.ts`](../src/agent/in-process-cron.ts) | Dashboard UTC cron handlers |
| [`schedule-cli.ts`](../src/research/schedule-cli.ts) | register / remove / preview |
| [`constants.ts`](../src/research/constants.ts) | `RESEARCH_CRON_*` defaults |
| [`cli.ts`](../src/research/cli.ts) | `runResearch()` SSOT |
