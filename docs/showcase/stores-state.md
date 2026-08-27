## Metadata & integrity

Content-addressed ETags: sha-256 of the report/docs body → `If-None-Match` 304. The maps.toml triple-lock hashes runtime version + bun-types + docs ref via `Bun.hash`, self-healed by `docs:refresh`. Bundle budgets come from `--metafile-md` with contributor caps (and `routes:check` keeps the manifest honest — it caught `/api/odds-report` itself).

## Bun.secrets — keychain, not .env

Kalshi API credentials live in the OS keychain via `Bun.secrets` (`src/lib/secrets.ts`): get/set/delete with no-echo fallbacks, tested. Proton Pass vault routes injection (`pass://…` in env.template); feed adapters read `api-key-ref` indirection — raw keys never enter prompts, shell history, or the repo. A keychain-locked environment degrades to no-creds: fail-closed.

## Bun linker — isolated + global store

Machine bunfig: `linker=isolated` + `globalStore=true` → `node_modules/.bun` store + `cache/links/<pkg>@<ver>-<entry_hash>` mounts (16-hex dependency-closure hash). Grounding probes read bun-types docs through the store; after worktree/CI ENOENTs they resolve through the stable `node_modules/bun-types` path with a version guard.
