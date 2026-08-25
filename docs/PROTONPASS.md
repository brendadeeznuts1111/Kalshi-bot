# ProtonPass integration — secret management

This project uses [Proton Pass CLI](https://protonpass.github.io/pass-cli/) (`pass-cli`) for secret management. Secrets are stored in a dedicated Proton Pass vault and resolved at runtime — never committed to the repository.

**First-principles design, error logging, failure codes, and proof plan:**  
[`PROTONPASS-INTEGRATION-SPEC.md`](PROTONPASS-INTEGRATION-SPEC.md).

## Official documentation

Canonical docs: **[protonpass.github.io/pass-cli](https://protonpass.github.io/pass-cli/)**

| Topic | Doc |
|-------|-----|
| Overview / install | [Overview](https://protonpass.github.io/pass-cli/) |
| Web / interactive / PAT login | [`login`](https://protonpass.github.io/pass-cli/commands/login/) |
| Personal access tokens (create, grant, renew) | [`pat`](https://protonpass.github.io/pass-cli/commands/personal-access-token/) |
| `pass://vault/item/field` URIs | [Secret references](https://protonpass.github.io/pass-cli/commands/contents/secret-references/) |
| Resolve env + exec command | [`run`](https://protonpass.github.io/pass-cli/commands/contents/run/) |
| Template → file (`{{ pass://… }}`) | [`inject`](https://protonpass.github.io/pass-cli/commands/contents/inject/) |
| Session status | [`info`](https://protonpass.github.io/pass-cli/commands/info/) · [`test`](https://protonpass.github.io/pass-cli/commands/test/) |
| Vaults / items | [`vault`](https://protonpass.github.io/pass-cli/commands/vault/) · [`item`](https://protonpass.github.io/pass-cli/commands/item/) |
| Troubleshooting | [Troubleshoot](https://protonpass.github.io/pass-cli/help/troubleshoot/) · [Configuration](https://protonpass.github.io/pass-cli/get-started/configuration/) |

**Two resolution styles** (both official):

| Style | Syntax | When |
|-------|--------|------|
| [`run`](https://protonpass.github.io/pass-cli/commands/contents/run/) | bare `pass://vault/item/field` in env / `--env-file` | This project's default (`tools/protonpass-run.ts`) |
| [`inject`](https://protonpass.github.io/pass-cli/commands/contents/inject/) | `{{ pass://vault/item/field }}` in templates | FactoryWager monorepo (`proton:inject:*`) |

Monorepo agent PAT / inject SSOT (sibling tree): [`~/Projects/docs/harness/tenants/proton-integration.md`](../../docs/harness/tenants/proton-integration.md).

**Vault map (FactoryWager only):** display chrome for the monorepo lives in [`~/Projects/config/vault-map.toml`](../../config/vault-map.toml) (Bun `import … with { type: "toml" }` — [Bun TOML guide](https://bun.com/docs/guides/runtime/import-toml)). Kalshi-bot does **not** ship a parallel map; secrets stay in `.env.protonpass` + [`run`](https://protonpass.github.io/pass-cli/commands/contents/run/). When a `PROTON_PASS_KALSHI_BOT_TOKEN` exists, wire it via Projects `agent-env.sh` — do not duplicate vault-map entries here unless Kalshi joins the portal env board.

## Prerequisites

1. **Install Proton Pass CLI** (one-time) — see [Overview](https://protonpass.github.io/pass-cli/):
   ```bash
   curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
   # Binary lands in ~/.local/bin/pass-cli — ensure it's on PATH
   ```
   Or via Homebrew:
   ```bash
   brew install protonpass/pass-cli/pass-cli
   ```

2. **Authenticate** — see [`login`](https://protonpass.github.io/pass-cli/commands/login/):
   ```bash
   pass-cli login
   ```
   Browser flow by default. Session persists until explicit logout.

3. **Create a dedicated vault** in Proton Pass (web/mobile app):
   - Recommended name: `Kalshi Bot` (or any name — update `.env.protonpass` if different)
   - Share it with team members if collaborative

4. **Create items** in that vault with the exact titles and fields listed below.

## Agent PAT (recommended for automation)

Interactive `pass-cli login` is fine for a human terminal. For agents / CI, prefer a scoped [personal access token](https://protonpass.github.io/pass-cli/commands/personal-access-token/) (same pattern as FactoryWager `.env.pass-tokens`).

**Mint** (main account session — once):

```bash
pass-cli login   # main account (browser)

# Expiration is required: 1d | 1w | 1m | 3m | 6m | 1y
pass-cli pat create --name kalshi-bot --expiration 1y
# Prints once: PROTON_PASS_PERSONAL_ACCESS_TOKEN=pst_…::…
# Save immediately — full token is not shown again.

# Create alone does NOT grant vault access — grant explicitly:
pass-cli pat access grant \
  --pat-name kalshi-bot \
  --vault-name "Kalshi Bot" \
  --role viewer

pass-cli pat access list-access --pat-name kalshi-bot
```

**Register** (gitignored, never commit):

```bash
# ~/Projects/.env.pass-tokens
PROTON_PASS_KALSHI_BOT_TOKEN='pst_YOUR_TOKEN_HERE'
```

**Use**:

```bash
export PROTON_PASS_PERSONAL_ACCESS_TOKEN="$PROTON_PASS_KALSHI_BOT_TOKEN"
export PROTON_PASS_KEY_PROVIDER=fs
export PROTON_PASS_SESSION_DIR=/tmp/pass-agent-kalshi-bot
pass-cli login
pass-cli info   # should show Personal Access Token: kalshi-bot
```

Rotate with [`pat renew`](https://protonpass.github.io/pass-cli/commands/personal-access-token/#pat-renew) and update `.env.pass-tokens` only.

## Vault item structure

Create these items in your `Kalshi Bot` vault. Use **exact item titles** — they are referenced by `.env.protonpass`.

### Item: `Kalshi API`
| Field | Type | Value |
|-------|------|-------|
| `keyId` | Hidden | Your Kalshi API key ID (e.g. `abc123def`) |
| `privateKey` | Hidden | Full PEM private key content — `-----BEGIN PRIVATE KEY-----`... |
| `privateKeyPath` | Text | Absolute path to `.pem` file (alternative to inline key) |

> **Note:** Either `privateKey` (inline PEM) or `privateKeyPath` (file path) is required. Inline PEM is preferred for `pass-cli` resolution because it avoids file-path assumptions across machines.

### Item: `The Odds API`
| Field | Type | Value |
|-------|------|-------|
| `apiKey` | Hidden | Your Odds API key |

### Item: `GitHub`
| Field | Type | Value |
|-------|------|-------|
| `token` | Hidden | GitHub personal access token (classic: `repo`, `read:user`) |

### Item: `Kalshi Environment` (optional)
| Field | Type | Value |
|-------|------|-------|
| `env` | Text | `demo` or `prod` |
| `prodArmed` | Text | `1` to enable live trading (requires `--live` + `ALPHA_LIVE`) |

### Item: `Fantasy402` (Ultra Live partner desk)

**Custom item** (not a bare Login). Live `pass-cli item create login` only has
username/password/url — no `--field`. Multi-field desk secrets use
`item create custom --from-template`.

| Field | Type | Env |
|-------|------|-----|
| `customerID` | Text | `FANTASY402_CUSTOMER_ID` |
| `agentID` | Text | `FANTASY402_AGENT_ID` |
| `password` | Hidden | `FANTASY402_PASSWORD` |
| `bearerToken` | Hidden | `FANTASY402_BEARER_TOKEN` (browser JWT; short-lived) |
| `domain` | Text | `DESK_DOMAIN` (optional; default from `SKINS[].hosts` via `resolveDeskDomainFromEnv` → SkinId) |
| `skin` | Text | Vault field maps to env `FANTASY402_LIVE_PRODUCT` (optional; default `2`; not white-label SkinId) |
| `currency` | Text | `FANTASY402_CURRENCY` (optional; default `USD`) |

Provision helper (dry-run by default; never prints secret values):

```bash
# After pass-cli login — export real values into this shell only:
export FANTASY402_CUSTOMER_ID='…'
export FANTASY402_AGENT_ID='…'
export FANTASY402_PASSWORD='…'
export FANTASY402_BEARER_TOKEN='…'   # DevTools Authorization: Bearer eyJ…

bun run partner:vault:provision              # dry-run + print pass:// map
bun run partner:vault:provision -- --apply   # create custom item in "Kalshi Bot"
bun run partner:vault:provision -- --update  # patch fields on existing item

# Runtime (preferred — no secrets in shell history):
bun run protonpass:run -- bun run partner:test-fantasy
```

**Not the same as vault `partners` / `Partner ASH`:** those items are
FactoryWager seat identity for the monorepo partner desk. Fantasy402 Ultra Live
JWT + agent body live under **Kalshi Bot / Fantasy402**.

Optional per-out isolation (only if you truly need a separate vault — PAT
viewer sessions **cannot** create vaults):

```bash
# Main account session required
bun run partner:vault:provision -- \
  --create-vault --vault=vault-out-ASH-1 --title=Fantasy402 --apply
# Then point .env.protonpass URIs at that vault name.
```

## Configuration file

The file `.env.protonpass` (gitignored) maps [secret references](https://protonpass.github.io/pass-cli/commands/contents/secret-references/) to environment variables. For [`run`](https://protonpass.github.io/pass-cli/commands/contents/run/), use **bare** `pass://` URIs (no `{{ }}`):

```text
KALSHI_API_KEY_ID=pass://Kalshi Bot/Kalshi API/keyId
KALSHI_PRIVATE_KEY=pass://Kalshi Bot/Kalshi API/privateKey
ODDS_API_KEY=pass://Kalshi Bot/The Odds API/apiKey
GH_TOKEN=pass://Kalshi Bot/GitHub/token
```

Template: [`env-protonpass.template`](../env-protonpass.template). Copy and adjust vault/item names if yours differ:

```bash
cp env-protonpass.template .env.protonpass
# Edit .env.protonpass if your vault or item names differ
```

## Usage

### Run any command with ProtonPass-injected secrets

Uses [`pass-cli run`](https://protonpass.github.io/pass-cli/commands/contents/run/) under the hood:

```bash
# Using pass-cli directly
pass-cli run --env-file .env.protonpass -- bun run research

# Using the project wrapper (validates pass-cli is installed)
bun tools/protonpass-run.ts -- bun run research
# or: bun run protonpass:run -- bun run research

# With a specific dimension
bun tools/protonpass-run.ts -- bun run research -- --dimension=market-making

# Tennis data plane (requires Kalshi API key)
bun tools/protonpass-run.ts -- bun run tennis:record -- --ws --ws-seconds=300

# Tour baseline with Odds API
bun tools/protonpass-run.ts -- bun run alpha:run -- --program=tennis-tour-pinnacle-novig --ticker=KXATPMATCH-...
```

### Verify secrets are loading

```bash
bun run protonpass:check
# or: bun tools/protonpass-run.ts --env-check
# Prints: session, vaults, env-file URIs, parallel fetch results, cache status
```

### Audit secret health

```bash
bun tools/protonpass-run.ts --health-check
# Scores all secrets 0–100 on accessibility, speed, and cache hits
```

```bash
bun run protonpass:check
# or: bun tools/protonpass-run.ts --env-check
# Prints: session, vaults, env-file URIs, first-URI resolve (values masked)
```

Also useful from the CLI docs: `pass-cli test`, `pass-cli vault list`, `pass-cli info`.

### Dry-run without secrets (existing behavior)

All commands that do not touch live APIs still work without ProtonPass:

```bash
bun run tennis:live -- --canary        # no auth needed
bun run tennis:collect -- --days=1     # no auth needed
bun run typecheck                      # no auth needed
bun run research:dry                   # offline mode
```

## Headless / PAT login (no browser)

Source: `protonpass/pass-cli` — `login_pat.rs`, `main.rs`, `access/grant.rs`
(verified against installed CLI 2.2.3).

Interactive browser login is **not** the only path. The CLI accepts a
Personal Access Token (format `pst_<token>::<key>`):

```bash
pass-cli login --pat 'pst_<token>::<key>'   # creates a PAT session in the session dir
```

Verified behavior (CLI 2.2.3, 2026-07-28):

- `PROTON_PASS_PERSONAL_ACCESS_TOKEN` only routes the **login** command to
  PAT auth — `run`/`item`/etc. still require an existing session. The
  headless pattern is `login --pat` once, then `run`.
- PAT sessions must set `PROTON_PASS_AGENT_REASON="..."` for item commands
  (audit trail; enforced: "Agent sessions must set PROTON_PASS_AGENT_REASON").
- PAT sessions cannot manage PATs, create vaults, or self-grant access.
- PAT login skips the `can_use_cli` account gate browser login enforces.
- **Session-dir gotcha:** `PROTON_PASS_SESSION_DIR` (see `utils.rs`) redirects
  the session store. This machine's `~/.zshrc` sets it to
  `/tmp/pass-agent-admin` for interactive shells — a login there is invisible
  to shells/cron using the default
  `~/Library/Application Support/proton-pass-cli`. Pick ONE dir per consumer;
  `/tmp` is wiped on reboot, so automation must use the default dir.

### Fixing "PAT has no vault access"

A PAT session authenticates but sees zero vaults until access is granted.
Granting requires an authenticated session with manage rights on the vault
(i.e. the main account — one browser login, once):

```bash
pass-cli login                                   # main account, browser, one time
pass-cli vault list                              # confirm "Kalshi Bot" vault visible
pass-cli pat create --name kalshi-bot-agent --expiration 1y --output json
pass-cli pat access grant \
  --personal-access-token-id '<pat-id>' \
  --vault-name 'Kalshi Bot' \
  --role viewer                                  # viewer is enough for run/inject
```

After the grant, the PAT works headless — no keyring, no browser, cron-safe:

```bash
pass-cli login --pat "$PROTON_PASS_KALSHI_BOT_TOKEN"   # once per session store
PROTON_PASS_AGENT_REASON="kalshi data plane" \
  pass-cli run --env-file .env.protonpass -- bun run tennis:record -- --ws --ws-seconds=300
```

### As-built state (2026-07-28)

- Vault `Kalshi Bot` (note: an empty duplicate `Kalshi-bot` hyphen vault also
  exists) contains item `Kalshi API` with `privateKey` (PEM verified resolving),
  `privateKeyPath`, and `keyId` **empty** — pending the Kalshi dashboard key ID.
- PAT `kalshi-bot-agent` (viewer on `Kalshi Bot`, expires 2027-07-28) is stored
  as `PROTON_PASS_KALSHI_BOT_TOKEN` in `~/Projects/.env.pass-tokens`, with an
  active session in the default session dir.
- Still missing items for full `.env.protonpass` resolution: `The Odds API`
  (apiKey) and `GitHub` (token) — create them in `Kalshi Bot` when the keys
  are available, or scope env files per-lane (see `research/cache/.env.kalshi-only`).

Manage PATs: `pass-cli pat create|list|renew|delete`, and per-item scoping
via `pat access grant --item-title 'Kalshi API'`.

## Caching (optional)

`pass-cli` API calls take 2–5 seconds. For frequently-run commands, the wrapper supports a short-lived cache via the macOS/Linux keyring:

```bash
# Cache for 15 minutes (900 seconds)
PROTONPASS_CACHE_TTL=900 bun tools/protonpass-run.ts -- bun run rate-limit:status
```

First run fetches from Proton Pass; subsequent runs read from keyring cache.

## Migration from .env

If you previously used `.env` for secrets:

1. Move each secret value into a Proton Pass item (see structure above)
2. Replace `.env` contents with `.env.protonpass` (pass:// URIs)
3. Delete `.env` or keep only non-secret overrides (ports, schedules)
4. `.env` remains gitignored — `.env.protonpass` is also gitignored

Optional FactoryWager-style path: use [`inject`](https://protonpass.github.io/pass-cli/commands/contents/inject/) with `{{ pass://… }}` in an `env.template` to materialize a plain `.env` cache. This repo's default remains `run` + `.env.protonpass`.

## Bun-native capabilities (v2)

The wrapper (`tools/protonpass-run.ts`) is built entirely on Bun-native APIs with zero external dependencies.

| Capability | Bun API | Module |
|------------|---------|--------|
| **Parallel secret fetch** | `Promise.allSettled` | `src/protonpass/parallel-fetch.ts` |
| **Secret caching (TTL)** | `Bun.file` + `Bun.write` | `src/protonpass/cache.ts` |
| **Retry with backoff** | `Bun.sleep` | `src/protonpass/retry.ts` |
| **Command timeout** | `Promise.race` + `proc.kill()` | `src/protonpass/timeout.ts` |
| **Structured logging** | `Bun.inspect` | `src/protonpass/logger.ts` |
| **Secret health score** | `Bun.inspect.table` | `src/protonpass/health.ts` |
| **CLI discovery** | `Bun.which()` | `tools/protonpass-run.ts` |
| **Telemetry timing** | `Bun.nanoseconds()` | `src/protonpass/parallel-fetch.ts` |
| **Subprocess execution** | `Bun.spawn()` | `tools/protonpass-run.ts` |

### Parallel secret fetch

All `pass://` URIs in `.env.protonpass` are resolved concurrently via `Promise.allSettled`, then cached. A single 4-secret env file drops from ~12s (sequential) to ~3s (parallel).

```bash
# 4 URIs fetched in parallel, not one-by-one
bun tools/protonpass-run.ts -- bun run rate-limit:status
```

### Secret caching with TTL

Resolved secrets are cached in `.protonpass-cache.json` (gitignored) with configurable TTL. Subsequent runs skip ProtonPass API calls entirely for cached secrets.

```bash
# Cache for 1 hour (3600 seconds)
bun tools/protonpass-run.ts --cache-ttl=3600 -- bun run research

# Default TTL is 15 minutes (900s)
```

The cache auto-purges expired entries on every `--env-check` run.

### Retry with exponential backoff

Each `pass-cli item view` is wrapped in `withRetry` with jitter:
- Base delay: 500ms
- Max delay: 10s
- Jitter: up to 30% random variance
- Max attempts: 2 (fast path; increase for CI)

### Command timeout

All `pass-cli` subprocesses have a 15s timeout. If they hang, they receive `SIGTERM`, then `SIGKILL` after 2s.

### Structured logging

Three modes: `pretty` (colorized terminal), `json` (machine-parseable), `quiet` (errors only). Controlled by the logger, not CLI flags today.

```ts
import { createLogger } from "./src/protonpass/logger.ts";
const log = createLogger({ prefix: "my-module", mode: "json" });
log.info("Fetched secret", { uri, durationMs: 1200 });
```

### Secret health score

Audit all secrets for accessibility, speed, and cache hit rate. Returns a 0–100 score.

```bash
bun tools/protonpass-run.ts --health-check
# Output:
# === Secret Health Audit ===
# Health Score: 75/100
# Total Secrets: 4
# Accessible: 3
# Errors: 1
# Cache Hits: 2
# Avg Fetch: 2300ms
# Overall: 🟡 Good
```

### SSH temp file (PEM auto-detection)

When `KALSHI_PRIVATE_KEY` resolves to inline PEM content, the wrapper automatically:
1. Writes it to a temp file with `0o600` permissions
2. Sets `KALSHI_PRIVATE_KEY_PATH` to that temp file
3. Cleans up the temp file on process exit

This avoids multiline string handling issues in child processes.

---.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pass-cli not found` | Install CLI — [Overview](https://protonpass.github.io/pass-cli/) — ensure `~/.local/bin` is on `PATH` |
| `pass-cli login required` | [`login`](https://protonpass.github.io/pass-cli/commands/login/) (browser) or PAT via `PROTON_PASS_PERSONAL_ACCESS_TOKEN` |
| PAT session but vault empty | [`pat access grant`](https://protonpass.github.io/pass-cli/commands/personal-access-token/#pat-access-grant) for `"Kalshi Bot"` — create alone does not grant access |
| `Vault not found` | Check vault name matches exactly (case-sensitive) |
| `Item not found` | Check item title matches exactly in `.env.protonpass` |
| `Field not found` | Check field name; see [secret references](https://protonpass.github.io/pass-cli/commands/contents/secret-references/) |
| `KALSHI_PRIVATE_KEY_PATH` vs inline PEM | `run` injects the field as a string. Inline PEM needs multiline handling in consumers; path stores an absolute filesystem path |
| CLI SIGKILL / codesign | See monorepo note in [proton-integration.md](../../docs/harness/tenants/proton-integration.md); official [Troubleshoot](https://protonpass.github.io/pass-cli/help/troubleshoot/) |

## Security notes

- `.env.protonpass` contains **only URIs**, never actual secret values. It can be reviewed safely.
- Actual secrets live encrypted in Proton Pass and are decrypted locally at runtime.
- Prefer PATs scoped with [`viewer`](https://protonpass.github.io/pass-cli/commands/personal-access-token/#pat-access-grant) over full-account login for agents.
- `pass-cli run` masks secret values in child stdout/stderr by default ([`run`](https://protonpass.github.io/pass-cli/commands/contents/run/)).
- The wrapper never logs secret values (masks them in `--env-check` output).
- No secrets are exported to child processes except those requested in `.env.protonpass`.
- Never commit `.env.pass-tokens`, `.env.protonpass` with resolved values, or `pst_…` tokens.
