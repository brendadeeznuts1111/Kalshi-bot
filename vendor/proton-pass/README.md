# `@factorywager/proton-pass`

Portable **Proton Pass CLI** integration for Bun hosts (Kalshi-bot, FactoryWager monorepo, or any repo).

## Principles

| Rule | Detail |
| ---- | ------ |
| Custody | Secret **values** only in Proton Pass vaults |
| References | Git holds `pass://vault/item/field` only |
| Boundary | Resolve into child process env; domain code never shells `pass-cli` for secrets mid-request |
| Logging | Never log secret values — keys, URIs, status, ms only |

Official CLI: [protonpass.github.io/pass-cli](https://protonpass.github.io/pass-cli/).

## Install

### Inside FactoryWager monorepo (preferred)

Root already links the package:

```json
{
  "dependencies": {
    "@factorywager/proton-pass": "workspace:*"
  }
}
```

```bash
bun run add:safe -- @factorywager/proton-pass@workspace:*   # once, if not linked
bun pm ls | rg proton-pass
bun pm why @factorywager/proton-pass
bun run --filter @factorywager/proton-pass test
bunx --bun proton-pass version
```

PM surface cookbook: [`docs/harness/tenants/monorepo-workspaces.md`](../../docs/harness/tenants/monorepo-workspaces.md#bun-pm-surface-operator-cookbook).

### Sibling / out-of-tree host (e.g. Kalshi-bot)

```json
{
  "dependencies": {
    "@factorywager/proton-pass": "file:../Projects/packages/proton-pass"
  }
}
```

Or interim: `bun link` from `packages/proton-pass`, then `bun link @factorywager/proton-pass` in the host. Prefer path/`workspace:*` over global link for reproducible installs.

**Do not** add Kalshi-bot to root `workspaces.packages` just for this package.

## API

```ts
import {
  findPassCli,
  checkEnvFile,
  fetchSecretsParallel,
  ensureAgentSession,
  KALSHI_AGENT_SESSION,
  FACTORYWAGER_AGENT_SESSION,
  envPrefixPresence,
  createLogger,
} from '@factorywager/proton-pass';
```

## Modes

| Mode | Use |
| ---- | --- |
| **run** | Bare `pass://` in `.env.protonpass` + spawn child with resolved env (Kalshi default) |
| **inject** | `{{ pass:// }}` templates → write `.env` (FactoryWager default) — host scripts still wrap CLI for now |

## CLI

Prefer **space-separated** flags (command, then flags, then values):

```bash
bunx --bun proton-pass check --env-file .env.protonpass --agent kalshi --json
bunx --bun proton-pass health --env-file .env.protonpass
bunx --bun proton-pass inject --in-file env.template --out-file .env --agent factorywager
bunx --bun proton-pass run --env-file .env.protonpass --agent kalshi -- bun run serve
bun run --filter @factorywager/proton-pass test
```

Monorepo wrapper still maps project → template path:

```bash
bun run proton:inject:factorywager
# → bunx --bun proton-pass inject --in-file env.template --out-file .env --agent factorywager
```

Avoid glued forms like `--env-file=path` in docs (still accepted for compatibility).

## Tests

```bash
bun test packages/proton-pass
# or
bun run --filter @factorywager/proton-pass test
```

## Spec

Kalshi: `Kalshi-bot/docs/PROTONPASS-INTEGRATION-SPEC.md`  
Monorepo: `docs/harness/tenants/proton-integration.md`
