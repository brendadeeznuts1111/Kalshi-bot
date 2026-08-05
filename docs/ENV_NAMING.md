# Env Variable Naming Standard

Canonical naming rules for all environment variables in Kalshi-bot.

## Prefix rule

```
SERVICE_SUBSYSTEM_PROPERTY
```

Every env var MUST have a service prefix. Examples:

| Pattern | Example |
|---------|---------|
| `KALSHI_*` | `KALSHI_API_KEY_ID`, `KALSHI_PROD_ARMED` |
| `TELEGRAM_*` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` |
| `TENNIS_*` | `TENNIS_LIVE_INTERVAL_MS`, `TENNIS_WS_RECORDER_CRON_SCHEDULE` |
| `RESEARCH_*` | `RESEARCH_DIMENSION`, `RESEARCH_CRON_SCHEDULE` |
| `PROTON_PASS_*` | `PROTON_PASS_KEY_PROVIDER` |
| `TOXICITY_*` | `TOXICITY_CRON_SCHEDULE` |

## Suffix conventions

| Suffix | Meaning | Example |
|--------|---------|---------|
| `_KEY` | API key string | `ODDS_API_KEY` |
| `_TOKEN` | Auth token | `TELEGRAM_BOT_TOKEN` |
| `_PATH` | Filesystem path | `KALSHI_PRIVATE_KEY_PATH` |
| `_URL` | HTTPS URL | `ALERT_WEBHOOK_URL`, `OPS_DASHBOARD_URL` |
| `_ID` | Identifier | `KALSHI_API_KEY_ID`, `TELEGRAM_ALERT_CHAT_ID` |
| `_MS` | Duration in milliseconds | `TENNIS_LIVE_INTERVAL_MS` |
| `_SECONDS` | Duration in seconds | `TENNIS_WS_RECORDER_WS_SECONDS` |
| `_SCHEDULE` | Cron expression | `RESEARCH_CRON_SCHEDULE` |
| `_TITLE` | Cron job title | `RESEARCH_CRON_TITLE` |
| `_LIVE` | Boolean toggle (live mode) | `ALPHA_LIVE` |
| `_ARMED` | Safety gate (must be "1") | `KALSHI_PROD_ARMED` |
| `_WAIT` | Blocking flag | `GITHUB_RATE_LIMIT_WAIT` |
| `_ENABLED` | Boolean toggle | `RESEARCH_EXPORT_AUDIT` |

## Cron pairs

Cron registrations MUST come in pairs:

```
SERVICE_CRON_SCHEDULE    →  "0 6 * * MON"
SERVICE_CRON_TITLE       →  "kalshi-research-weekly"
```

## Orphans (deliberately prefix-free)

These lack a service prefix by design:

| Var | Justification |
|-----|---------------|
| `ALERT_WEBHOOK_URL` | Multi-channel (Discord + Slack), not scoped to a single service |
| `ODDS_API_KEY` | The service name IS "The Odds API" |
| `GITHUB_TOKEN`, `GH_TOKEN` | GitHub CLI convention (Node.js ecosystem standard) |
| `NODE_ENV` | Node.js standard |
| `BUN_PORT`, `NO_COLOR`, `DO_NOT_TRACK` | Bun built-ins |

## Compatibility aliases

When renaming, add a backward-compat read wrapper:

```typescript
// New name preferred, old name still works
const hubUrl = Bun.env.OPS_DASHBOARD_URL ?? Bun.env.SERVE_URL;
```

## Rename log

| Old name | New name | Date |
|----------|----------|------|
| `SERVE_URL` | `OPS_DASHBOARD_URL` | 2026-07-30 |
| `ALPHA_LIVE` | `KALSHI_ALPHA_LIVE` | 2026-07-30 |
| `REPO_CLONE_ROOT` | `RESEARCH_REPO_CLONE_ROOT` | 2026-07-30 |
| `REGULATORY_DB` | `REGULATORY_DATABASE_PATH` | 2026-07-30 |
| `COMPLIANCE_URL` | `REGULATORY_COMPLIANCE_URL` | 2026-07-30 |

## Governance: single source of truth

| Concern | SSOT | Enforced by |
|---------|------|-------------|
| Runtime config | `config.toml` + `KALSHI__SECTION__KEY` env overrides | `config.ts` Zod schema |
| Env var types | `declare module "bun" { interface Env }` in `config.ts` | TypeScript |
| Alert thresholds | `config.toml [pipeline-alerts]` | `price-logger.ts` reads `config.pipelineAlerts` |
| Alert semantics | `glossary.ts GLOSSARY_ENTRIES` (references config keys, not numbers) | TypeScript union type + `/api/glossary` |
| Alert payloads | `SnapshotDiagnostics` type | TypeScript |
| Glossary IDs | `glossary.ts` → generated `glossary-ids.ts` | `bun glossary:generate` + CI diff |
| URL patterns | `patterns.ts SERVE_PATTERNS` | TypeScript |
| Dependencies | `package.json` (2 deps) | `bun audit:deps` + `scripts/audit-bun-native.ts` |

**Drift-free contract:** glossary values reference config keys (`poly-dropout-pct`, `staleness-threshold-ms`) — not hardcoded numbers. Changing `config.toml` automatically updates the ops meaning. No manual sync needed.
