# ProtonPass integration — secret management

This project uses [Proton Pass CLI](https://protonpass.github.io/pass-cli/) (`pass-cli`) for secret management. Secrets are stored in a dedicated Proton Pass vault and injected at runtime — never committed to the repository.

## Prerequisites

1. **Install Proton Pass CLI** (one-time):
   ```bash
   curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
   # Binary lands in ~/.local/bin/pass-cli — ensure it's on PATH
   ```
   Or via Homebrew:
   ```bash
   brew install protonpass/pass-cli/pass-cli
   ```

2. **Log in** (one-time):
   ```bash
   pass-cli login
   ```
   This opens a browser for Proton authentication. Session persists until explicit logout.

3. **Create a dedicated vault** in Proton Pass (web/mobile app):
   - Recommended name: `Kalshi Bot` (or any name — update `.env.protonpass` if different)
   - Share it with team members if collaborative

4. **Create items** in that vault with the exact titles and fields listed below.

## Vault item structure

Create these items in your `Kalshi Bot` vault. Use **exact item titles** — they are referenced by `.env.protonpass`.

### Item: `Kalshi API`
| Field | Type | Value |
|-------|------|-------|
| `keyId` | Hidden | Your Kalshi API key ID (e.g. `abc123def`) |
| `privateKey` | Hidden | Full PEM private key content — `-----BEGIN PRIVATE KEY-----`... |
| `privateKeyPath` | Text | Absolute path to `.pem` file (alternative to inline key) |

> **Note:** Either `privateKey` (inline PEM) or `privateKeyPath` (file path) is required. Inline PEM is preferred for `pass-cli` injection because it avoids file-path assumptions across machines.

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

## Configuration file

The file `.env.protonpass` (gitignored) maps `pass://` URIs to environment variables:

```
KALSHI_API_KEY_ID=pass://Kalshi Bot/Kalshi API/keyId
KALSHI_PRIVATE_KEY=pass://Kalshi Bot/Kalshi API/privateKey
ODDS_API_KEY=pass://Kalshi Bot/The Odds API/apiKey
GH_TOKEN=pass://Kalshi Bot/GitHub/token
```

A template is provided at `.env.protonpass.template`. Copy and adjust vault/item names if yours differ:

```bash
cp .env.protonpass.template .env.protonpass
# Edit .env.protonpass if your vault or item names differ
```

## Usage

### Run any command with ProtonPass-injected secrets

```bash
# Using pass-cli directly
pass-cli run --env-file .env.protonpass -- bun run research

# Using the project wrapper (validates pass-cli is installed + logged in)
bun tools/protonpass-run.ts -- bun run research

# With a specific dimension
bun tools/protonpass-run.ts -- bun run research -- --dimension=market-making

# Tennis data plane (requires Kalshi API key)
bun tools/protonpass-run.ts -- bun run tennis:record -- --ws --ws-seconds=300

# Tour baseline with Odds API
bun tools/protonpass-run.ts -- bun run alpha:run -- --program=tennis-tour-pinnacle-novig --ticker=KXATPMATCH-...
```

### Verify secrets are loading

```bash
bun tools/protonpass-run.ts --env-check
# Prints: vault reachable, item count, which secrets resolved
```

### Dry-run without secrets (existing behavior)

All commands that do not touch live APIs still work without ProtonPass:

```bash
bun run tennis:live -- --canary        # no auth needed
bun run tennis:collect -- --days=1     # no auth needed
bun run typecheck                      # no auth needed
bun run research:dry                   # offline mode
```

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

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pass-cli not found` | Install CLI and ensure `~/.local/bin` is on `PATH` |
| `pass-cli login required` | Run `pass-cli login` and authenticate in browser |
| `Vault not found` | Check vault name matches exactly (case-sensitive) |
| `Item not found` | Check item title matches exactly in `.env.protonpass` |
| `Field not found` | Check field name matches exactly; Proton Pass uses `username`, `password`, `custom` fields |
| `KALSHI_PRIVATE_KEY_PATH` vs inline PEM | `pass-cli` injects the field value as a string. For inline PEM, the consuming code must handle multiline. For path, store the absolute path as the field value. |

## Security notes

- `.env.protonpass` contains **only URIs**, never actual secret values. It can be reviewed safely.
- Actual secrets live encrypted in Proton Pass infrastructure and are decrypted locally at runtime.
- `pass-cli` session keys are stored in the OS keyring (macOS Keychain / Linux keyring).
- The wrapper script never logs secret values (masks them in output).
- No secrets are exported to child processes except those explicitly requested in `.env.protonpass`.
