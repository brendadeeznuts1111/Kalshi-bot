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
