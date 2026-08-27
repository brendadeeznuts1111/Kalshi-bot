# Snapshot Layer — grounded design (repo-verified)

A corrected version of the "Unified Terminal Layer" proposal. Every claim about
the repo was grep/read-verified against the actual tree; every design fix
addresses a concrete flaw in the original.

## 1. Repo reality vs the original proposal

| Proposal item | Reality |
| --- | --- |
| `bun cli snapshot/watch/tick` | ❌ no `cli` router — only `src/cli/argv.ts` (parseArgs helper) + the `kalshi-research` and `kalshi-agent` bins |
| `captureSnapshot`, `getClusters`, `getIntel`, `getTileManifest`, `getBookProfiles`, `getIngestCount`, `diffSnapshots` | ❌ none exist |
| Clusters | ✅ `src/alpha/cluster/odds-vector.ts` (`OddsPrint`, `ClusterResult`, `clusterOddsPrints`) + `src/lib/odds-tile.ts` (`parseOddsClusters`) |
| Books | ✅ partial — `src/institutions/odds-registry/` (venues, xml-feed, value-patterns) |
| Tiles | ✅ `src/lib/odds-tile.ts` (`renderTile`, `rgbaPng`) |
| Intel (leadership/arbitrage/steam/providerClusters) | ❌ no such model in `src/` |
| UI heatmap/intel/timeline | ❌ `serve.ts` has research pages + KPI routes only |
| SQLite snapshot store | ⚠️ pattern exists — `serve.ts` `snapshot()` SQL helper + `score_snapshots`/`price_snapshots` tables (different purpose) |
| `ODDS_SOURCE` env | ❌ only `FONBET_ODDS_SOURCE`/`PANDORA_ODDS_SOURCE` feed-name constants |
| Live detection | ✅ real gate: `src/protonpass/gate.ts` — `KALSHI_ENV` demo/prod + `KALSHI_PROD_ARMED === "1"` (+ `KALSHI_AUTHORIZED_EXECUTION_ENABLED`) |

## 2. Design fixes (each corresponds to a flaw in the original)

1. **Snapshot id must be timestamp + hash.** The original type said "timestamp +
   hash" but the code used `snap-<Date.now()>` (collides within a ms). Fix:
   `id = snap-<ts>-<hash>` where `hash` is a short digest over the serialised
   state (Bun.CryptoHasher sha256, first 8 hex chars).
2. **The honesty flag must key off the real gate, not a new env var.** A
   self-declared `ODDS_SOURCE` is pretendable by construction — it repeats the
   exact dishonesty the layer exists to kill. Fix:
   `source = isLiveAuthorized() ? "live" : "simulated"` where
   `isLiveAuthorized()` = `KALSHI_ENV === "prod" && KALSHI_PROD_ARMED === "1"`
   (mirror `src/protonpass/gate.ts`). Nothing else may set `source`.
3. **Drop `meta.isSimulated`** — it is `source === "simulated"` twice.
4. **Phase 1 intel scope:** leadership/arbitrage/steam do not exist. Phase 1
   snapshots clusters (odds-vector), books (odds-registry), tiles
   (odds-tile manifest), and DB KPIs (the existing `serve.ts` `snapshot()`
   counts). Add the intel block only when the analytics layer exists.
5. **Snapshots are a derived projection, not a third truth.** The snapshots
   table stores `{ id, ts, source, projection_json, state_hash }` computed
   FROM research/cache + event-store — CLI and UI both read the projection.
   No parallel write path.

## 3. What the original got right

- One snapshot object → JSON / table / WebSocket, consumed by both CLI and UI:
  sound, and the repo already proves the pattern (`serve.ts` `snapshot()`).
- tick → snapshot → SQLite → WS → watch/UI loop: feasible with verified
  primitives (Bun.serve websockets, bun:sqlite).
- The honesty principle — correct, once wired to the real gate.

## 4. Phased outline against real modules

| Phase | Work | Uses |
| --- | --- | --- |
| 1 | `captureSnapshot()` — clusters + books + tiles + KPI counts + `source` from the gate | `alpha/cluster/odds-vector.ts`, `lib/odds-tile.ts`, `institutions/odds-registry/`, `protonpass/gate.ts` |
| 2 | `bun cli snapshot` (`--json` / `--diff` / table) | `src/cli/argv.ts` parsing + a new snapshot command module beside it (path TBD at implementation) |
| 3 | `/api/snapshot` + `/ws` push + `bun cli watch` | `serve.ts` routes, Bun.serve websocket (verified) |

**Status:** design only — no code exists yet; Phase 1 is the only honest first
commit (intel and the UI are aspirational).
