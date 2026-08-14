# Proton Pass integration — first principles, error logging, proof

**Status:** specification (Kalshi-bot SSOT)  
**Implements today:** [`docs/PROTONPASS.md`](PROTONPASS.md) · `src/protonpass/*` · `tools/protonpass-run.ts`  
**Related:** Inventory Map lane needs Fantasy desk secrets via this path ([`INVENTORY-MAP-BACKLOG.md`](INVENTORY-MAP-BACKLOG.md) W1).

Official CLI: [protonpass.github.io/pass-cli](https://protonpass.github.io/pass-cli/).

---

## 0. First principles

### 0.1 Problem

Operators and agents need **runtime secrets** (Kalshi PEM, Odds API, GitHub PAT, Fantasy402 desk JWT/password) without:

1. Committing secrets to git  
2. Pasting vault values into shell history / chat / PR bodies  
3. Duplicating secret stores across machines without a single custody SSOT  

### 0.2 Solution shape

| Principle | Rule |
| --------- | ---- |
| **Custody SSOT** | Proton Pass vault holds secret **values** |
| **Reference SSOT** | Git holds only `pass://vault/item/field` **references** (`.env.protonpass`) |
| **Resolve at boundary** | Secrets become process env only for a **child command** (or short-lived resolved file) |
| **Never log values** | Logs/metrics may name env keys and URIs; **never** secret payloads, PEMs, JWTs, passwords |
| **Fail closed for live risk** | Missing optional research keys → degrade; missing live-trade arming → block |
| **Session is identity** | `pass-cli` must be authenticated (human login **or** agent PAT) before resolve |

### 0.3 Two resolution styles (official)

| Style | Syntax | Kalshi-bot use |
| ----- | ------ | -------------- |
| **`pass-cli run`** | bare `pass://v/i/f` in env file | **Default** — `bun run protonpass:run -- <cmd>` |
| **`pass-cli inject`** | `{{ pass://v/i/f }}` in templates | FactoryWager monorepo inject; **not** Kalshi default |

Do not mix styles in one file.

### 0.4 Trust boundaries

```text
┌──────────────────┐     pass:// refs only      ┌─────────────────────┐
│  Git repository  │ ─────────────────────────▶ │  .env.protonpass    │
│  (public-ish)    │     never secret values    │  (gitignored)       │
└──────────────────┘                            └──────────┬──────────┘
                                                           │
                     authenticated pass-cli session        │
                     (login OR PROTON_PASS_*_TOKEN)        ▼
┌──────────────────┐     resolve field values    ┌─────────────────────┐
│  Proton Pass     │ ◀────────────────────────── │  tools/protonpass-  │
│  cloud vault     │     item view / run         │  run.ts             │
└──────────────────┘                             └──────────┬──────────┘
                                                           │ env only
                                                           ▼
                                                ┌─────────────────────┐
                                                │  child process      │
                                                │  inventory:enrich   │
                                                │  partner:test-…     │
                                                │  research / bot     │
                                                └─────────────────────┘
```

**Interior code** (`loadFantasy402ProfileFromEnv`, Kalshi clients) only sees **already-resolved** `Bun.env` strings. It must not call `pass-cli` itself.

---

## 1. Components (as-built)

| Layer | Path | Role |
| ----- | ---- | ---- |
| CLI binary | `pass-cli` on PATH | Auth, vault list, item view, run |
| Agent PAT | `PROTON_PASS_KALSHI_BOT_TOKEN` in `~/Projects/.env.pass-tokens` (preferred) or local | Non-interactive vault **viewer** |
| URI map | `.env.protonpass` ← `env-protonpass.template` | Env key → `pass://…` |
| Display map | `config/vault-map.toml` | Labels/colors only — **no values** |
| Wrapper | `tools/protonpass-run.ts` | Find CLI, session, resolve, spawn child |
| Library | `src/protonpass/` | cache, retry, timeout, circuit, gate, telemetry, logger |
| Consumers | `src/partner/*`, bot, research | Read `Bun.env` after `protonpass:run` |

### 1.1 Scripts

| Script | Behavior |
| ------ | -------- |
| `bun run protonpass:check` | Session + URI map + parallel resolve (redacted) |
| `bun run protonpass:health` | Health score table; exit 1 if any URI errors |
| `bun run protonpass:run -- <cmd…>` | Resolve `.env.protonpass` → child env → exec |
| `bun run protonpass:mint` / `:check` | Agent PAT mint / presence |
| `bun run partner:vault:provision` | Create/update Fantasy402 vault **items** (main session) |

### 1.2 Fantasy desk (inventory Map unlock)

`loadFantasy402ProfileFromEnv()` requires resolved env (any fallback chain level):

| Env key | Vault field (typical) |
| ------- | --------------------- |
| `FANTASY402_*_BEARER_TOKEN` or `FANTASY402_BEARER_TOKEN` | `bearerToken` |
| `FANTASY402_*_CUSTOMER_ID` | `customerID` |
| `FANTASY402_*_AGENT_ID` | `agentID` |
| `FANTASY402_*_PASSWORD` | `password` |

Fallback chain (SSOT in `src/partner/toml-config.ts`):  
**out** `FANTASY402_SPEN_1_` → **partner** `FANTASY402_SPEN_` → **book** `FANTASY402_`.

Without Proton resolve, profile is `null` → inventory enrich uses **public** Statscore catalog only (Map W1 ceiling ~7%).

**Correct Map enrich invocation:**

```bash
bun run protonpass:run -- bun run inventory:sync -- \
  --enrich-only --sport=table_tennis,tennis,soccer,basketball --limit=150 --json
```

Never: paste bearer into shell, then bare `bun run inventory:sync`.

---

## 2. Lifecycle (happy path)

```text
1. Install pass-cli
2. Authenticate
   a. Human: pass-cli login
   b. Agent: PAT in .env.pass-tokens + ensureKalshiAgentSession
3. Vault "Kalshi Bot" exists; items + fields filled (values never in git)
4. cp env-protonpass.template .env.protonpass  (adjust titles if needed)
5. bun run protonpass:check   → session OK, all URIs resolve
6. bun run protonpass:run -- <workload>
7. Workload reads Bun.env; no pass:// left in values
```

### 2.1 Failure modes (ordered)

| Code | Condition | Operator action | Log level |
| ---- | --------- | --------------- | --------- |
| `PASS_CLI_MISSING` | `Bun.which('pass-cli')` null | Install CLI; fix PATH | **error** |
| `SESSION_MISSING` | `vault list` fails / “login” | `pass-cli login` or register PAT | **error** |
| `PAT_MISSING` | Agent mode needs token, none found | Mint + grant + `.env.pass-tokens` | **error** / warn |
| `PAT_NO_VAULT` | Token valid but no vault access | `pat access grant --vault-name "Kalshi Bot" --role viewer` | **error** |
| `ENV_FILE_MISSING` | `.env.protonpass` absent | Copy template | **error** |
| `URI_RESOLVE_FAIL` | item/field missing, wrong title, empty field | Fix vault item; re-check URI | **error** per URI |
| `URI_EMPTY_VALUE` | Resolve OK but empty string | Fill field in Pass app | **error** |
| `CACHE_STALE_OK` | Cache hit within TTL | none | **debug** / info |
| `CHILD_EXIT_N` | Child non-zero after inject | Fix app, not vault | **error** (exit code) |
| `GATE_BLOCK` | e.g. ALPHA_LIVE without PROD_ARMED | Disarm or arm deliberately | **error** |
| `DESK_PROFILE_NULL` | After run, still no Fantasy keys | URIs missing from env file or wrong prefix | **warn** (Map lane) |

---

## 3. Error logging specification

### 3.1 Logger contract (`src/protonpass/logger.ts`)

| Requirement | Spec |
| ----------- | ---- |
| Levels | `debug` · `info` · `warn` · `error` · `silent` |
| Modes | `pretty` (TTY) · `json` (agents/CI) |
| Timestamp | ISO-8601 UTC on every line |
| Prefix | Component name: `protonpass`, `gate`, `parallel-fetch`, `circuit` |
| Structure | `{ ts, level, msg, …fields }` — **json mode is parseable NDJSON-ready** |

### 3.2 Redaction (mandatory)

| May log | Must **never** log |
| ------- | ------------------- |
| Env **key** names (`FANTASY402_SPEN_1_BEARER_TOKEN`) | Token/password/PEM **values** |
| Full `pass://vault/item/field` URI | Resolved secret string |
| `status: ok\|error`, `durationMs`, `fromCache` | `Authorization: Bearer …` headers |
| Exit codes, truncated error messages (≤120 chars, no body) | Full `pass-cli` stdout of `item view` |
| Vault **names**, item **titles** | Field contents |
| Fingerprint: `len=N sha256[:8]=…` if needed for debug | Full hash of secret (optional later) |

**Rule:** if a log field could be copy-pasted into a curl header, it is forbidden.

### 3.3 Event taxonomy (structured `msg` + fields)

Use stable `msg` strings for agents/grep:

| `msg` | Required fields | Level |
| ----- | --------------- | ----- |
| `pass_cli_located` | `path` | info |
| `pass_cli_missing` | `candidates[]` | error |
| `session_probe` | `ok`, `timedOut`, `vaultCount?` | info/error |
| `agent_session` | `mode`, `ok`, `sessionDir` | info/error |
| `env_file` | `path`, `ok`, `uriCount` | info/warn |
| `secret_fetch_start` | `uriCount` | info |
| `secret_fetch_result` | `uri`, `status`, `durationMs`, `fromCache`, `error?` (redacted) | info/error |
| `secret_fetch_summary` | `ok`, `total`, `cached`, `durationMs` | info |
| `cache_purge` | `purged`, `remaining` | info |
| `circuit_open` | `failures`, `resetMs` | error |
| `gate_start` / `gate_pass` / `gate_fail` | `checks`, `blockers[]` | info/error |
| `child_spawn` | `cmd` (argv only, no env dump) | info |
| `child_exit` | `code`, `durationMs` | info/error |
| `desk_profile` | `ok`, `prefix`, `missingKeys[]` (names only) | info/warn |

### 3.4 Telemetry (`src/protonpass/telemetry.ts`)

- Optional append-only JSONL path (gitignored), e.g. `research/cache/protonpass-telemetry.jsonl`
- Same redaction as §3.2
- Fields: `ts`, `uri`, `durationMs`, `status`, `fromCache`, `error?`
- Best-effort write; **never** throw into caller path

### 3.5 Circuit + retry

| Mechanism | Spec |
| --------- | ---- |
| Retry | Transient CLI failures: max 2–3, exponential backoff + jitter (`retry.ts`) |
| Circuit | After N consecutive resolve failures, open; fail fast with `circuit_open` log |
| Timeout | Per `item view` / `vault list`: default 10–15s (`timeout.ts`); log `timedOut: true` |

---

## 4. Gate matrix

### 4.1 `protonpass:check` (operator / agent preflight)

Exit **0** only if:

1. `pass-cli` found  
2. Session authenticated (vault list OK) **or** agent PAT session OK  
3. `.env.protonpass` exists and has ≥1 `pass://` URI  
4. **All** listed URIs resolve non-empty (or documented optional set)

Exit **1** on any required failure; print actionable hints (mint PAT, grant vault, copy template).

### 4.2 Application gate (`src/protonpass/gate.ts`)

| Check | Required? | On fail |
| ----- | --------- | ------- |
| Kalshi key id / PEM | optional for public | warn |
| ODDS_API_KEY | optional | warn |
| GH_TOKEN | optional | warn |
| ALPHA_LIVE ⇒ KALSHI_PROD_ARMED=1 | **required** if live set | **block** |
| Fantasy desk keys | optional globally; **required** for Map adapter enrich | warn / fail that subcommand |

### 4.3 Inventory Map enrich gate (spec — wire into enrich entry)

Before preferring adapter catalog:

```text
IF loadFantasy402ProfileFromEnv() is null:
  log desk_profile ok=false missingKeys=[…]
  log warn: "Fantasy desk env absent — public Statscore catalog only"
  CONTINUE public path (do not crash Capture)
ELSE:
  log desk_profile ok=true prefix=FANTASY402_… (no values)
  ATTEMPT adapter.listBookedEvents
  ON login/list failure:
    log error redacted message; FALL BACK public catalog
```

---

## 5. Security & hygiene

| Rule | Detail |
| ---- | ------ |
| Gitignore | `.env.protonpass`, `.env.pass-tokens`, `.protonpass-cache.json`, resolved temp env, PEM temps |
| Temp PEM | `writePemTemp` → mode `0600`, delete on process exit |
| Cache | Disk cache of resolved secrets OK only with TTL (default 15m); path gitignored; purge expired on check |
| PAT role | **viewer** on vault “Kalshi Bot” for agents; create/update items needs main account |
| No dual custody | Do not also store same secrets in committed JSON / `docs/API-KEY.txt` |
| Chat | Never paste vault passwords or `pst_` tokens into prompts |

---

## 6. Proof plan (“make sure”)

### 6.1 Static / unit

```bash
bun test tests/protonpass.test.ts
# cache TTL, circuit, retry, gate, redaction-safe session helpers
```

### 6.2 Session proof (no secret echo)

```bash
pass-cli --version
bun run protonpass:check
# Expect: session active OR clear missing-token path
# Expect: each pass:// URI ✅ or ❌ with error snippet only
```

### 6.3 Fantasy desk proof (Map W1)

```bash
# A. Without protonpass:run
bun -e 'import { loadFantasy402ProfileFromEnv } from "./src/partner/index.ts";
  console.log(loadFantasy402ProfileFromEnv() ? "PROFILE_OK" : "PROFILE_NULL");'
# Expect PROFILE_NULL if secrets only in Pass

# B. With protonpass:run
bun run protonpass:run -- bun -e 'import { loadFantasy402ProfileFromEnv, fantasyDeskEnvPresence } from "./src/partner/index.ts";
  const p = loadFantasy402ProfileFromEnv();
  const pr = fantasyDeskEnvPresence("FANTASY402_");
  console.log(JSON.stringify({ profile: !!p, ok: pr.ok, missing: pr.missing, present: pr.present }));'
# Expect profile true, missing [], present includes bearer/customer/agent/password
# Never print process.env values

# C. Enrich path
bun run protonpass:run -- bun run inventory:sync -- \
  --enrich-only --sport=tennis --limit=50 --json
# Expect notes mention adapter/catalog source richer than public-only when desk works
```

### 6.4 Negative tests (manual)

| Inject fault | Expected |
| ------------ | -------- |
| Rename vault item | `URI_RESOLVE_FAIL`, check exit 1 |
| Empty field in Pass | empty value error, not silent |
| Logout session | `SESSION_MISSING` |
| Delete `.env.protonpass` | `ENV_FILE_MISSING` |
| Broken PAT | agent session fail + hint |

### 6.5 Current machine snapshot (2026-08-14)

| Probe | Result |
| ----- | ------ |
| `pass-cli` | installed (`~/.local/bin/pass-cli` 2.2.3) |
| Session | **not logged in** (`Command is not logout there is no session`) |
| `.env.protonpass` | **exists** (URIs present) |
| Plain `.env` FANTASY402_* | **absent** → `loadFantasy402ProfileFromEnv()` = null |
| Map enrich | public catalog only until `protonpass:run` + session + vault items filled |

---

## 7. Implementation backlog (from this spec)

| ID | Work | Priority |
| -- | ---- | -------- |
| P1 | Extend `protonpass:check` with **desk presence** block (`fantasyDeskEnvPresence` for configured prefixes) — keys only | P0 |
| P2 | Inventory enrich: structured `desk_profile` log + explicit public fallback reason | P0 |
| P3 | JSON log mode flag: `PROTONPASS_LOG=json` for agents | P1 |
| P4 | Telemetry JSONL path opt-in in `protonpass-run` | P1 |
| P5 | Operator: `pass-cli login` or PAT; fill Fantasy402 item; prove §6.3 | **operator** |
| P6 | Optional vault-map.toml rows for Fantasy402 env keys (display only) | P2 |

---

## 8. Operator checklist (copy)

```bash
# 1. CLI + session
pass-cli --version
pass-cli login   # or ensure PROTON_PASS_KALSHI_BOT_TOKEN

# 2. Map file
test -f .env.protonpass || cp env-protonpass.template .env.protonpass

# 3. Preflight
bun run protonpass:check
bun run protonpass:health

# 4. Desk (after vault item filled)
bun run protonpass:run -- bun -e \
  'import { fantasyDeskEnvPresence } from "./src/partner/index.ts";
   console.log(fantasyDeskEnvPresence("FANTASY402_SPEN_1_"));
   console.log(fantasyDeskEnvPresence("FANTASY402_"));'

# 5. Map enrich under Pass
bun run protonpass:run -- bun run inventory:sync -- \
  --enrich-only --sport=table_tennis,tennis,soccer,basketball --limit=150 --json
```

---

## 9. See also

- Operator how-to: [`PROTONPASS.md`](PROTONPASS.md)  
- FactoryWager monorepo inject (sibling): `~/Projects/docs/harness/tenants/proton-integration.md`  
- Fantasy provision: `tools/provision-fantasy402-vault.ts`  
- Inventory Map: [`INVENTORY-MAP-BACKLOG.md`](INVENTORY-MAP-BACKLOG.md)  
- Official: [Secret references](https://protonpass.github.io/pass-cli/commands/contents/secret-references/) · [run](https://protonpass.github.io/pass-cli/commands/contents/run/) · [PAT](https://protonpass.github.io/pass-cli/commands/personal-access-token/) · [Troubleshoot](https://protonpass.github.io/pass-cli/help/troubleshoot/)
