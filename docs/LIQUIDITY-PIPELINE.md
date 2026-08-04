# Match liquidity pipeline

Operator guide for desk `match_liquidity` (event-store) — gates, API, ground, cron, and volume backfill.

## Day loop

```bash
# Offline recompute + HTML ground
bun run liquidity:pipeline -- --no-ground   # recompute only
bun run liquidity:ground -- --html-only     # dashboard only

# Network: fill null markets.volume_* on quoted events, then recompute
bun run liquidity:backfill-volume -- --limit=80

# Full one-shot (volume + ground + registry snapshot)
bun run liquidity:pipeline -- --fetch-volume --snapshot
```

## Automation (Bun.cron)

| Mode | Command | Behavior |
|------|---------|----------|
| In-process | `bun run cron:start` | Every 30m recompute + ground; set `LIQUIDITY_PIPELINE_FETCH_VOLUME=1` for market GET |
| OS cron | `bun run liquidity:pipeline:register` | Survives restarts; worker `tools/match-liquidity-scheduled.ts` |
| Preview | `bun run liquidity:pipeline:preview` | Next fire times (UTC parse) |
| Remove | `bun run liquidity:pipeline:remove` | Uninstall OS job |

macOS OS job title: `kalshi-match-liquidity-pipeline`  
Logs: `/tmp/bun.cron.kalshi-match-liquidity-pipeline.stdout.log`

### Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `LIQUIDITY_PIPELINE_FETCH_VOLUME` | off (in-process) | Enable Kalshi public volume GET in `cron:start` |
| `LIQUIDITY_PIPELINE_SKIP_NETWORK` | off | OS worker: recompute+ground only |
| `LIQUIDITY_PIPELINE_VOLUME_LIMIT` | 80 (OS) / 40 (in-process) | Backfill batch size |
| `LIQUIDITY_PIPELINE_SNAPSHOT` | on for OS worker | Set `0` to skip registry write |

## Reactive ground (`fs.watch`)

```bash
bun run liquidity:ground:watch-db              # watch event-store.db dir
bun run liquidity:ground:watch-db -- --once    # single rebuild
bun run liquidity:ground:watch-db -- --fetch-volume
```

Complements cron: time-based volume/snapshot vs instant HTML after local DB writes.

## REST

```text
GET /api/liquidity                 # board: summary + top + byTournament + concepts
GET /api/liquidity/summary         # alias of board
GET /api/liquidity/:eventId
GET /api/liquidity/by-tournament/:key?limit=50&recompute=1
GET /api/kpi                       # tight_markets / tradable_matches / quoted_books from match_liquidity
GET /api/events?liquidity=…&minVolume=N  # open board + deskLiquidity join (HQ filters/badges)
GET /ops/partners/:nodeId          # includes deskLiquidity board (same concepts)
```

No rate limit on liquidity GETs (bulk HQ polls).

### Live events board (Phase 2)

| Piece | Behavior |
|-------|----------|
| `GET /api/events` | Joins `match_liquidity` → each event may include `deskLiquidity` `{ liquidityOk, tradable, quoted, … }` |
| Query `liquidity=` | `all` \| `priced` \| `active` \| `quoted` \| `liq_ok` \| `tradable` (server filter; HQ also filters client-side) |
| Query `minVolume` / `minVol` | Min gate volume (desk 24h\|lifetime, else board 24h sum) |
| HQ UI | Liquidity select + quick toggles (Quoted / Liquid / Tradable counts) + per-row chips |

### Domain concepts (glossary)

| Concept | Role |
|---------|------|
| `liquidity_ok` | Volume + tight non-empty book |
| `desk.tradable` | liquidity_ok + mid band 20–80¢ |
| `desk.quoted` | Non-empty two-sided top-of-book |
| `kpi.tight_markets` / `kpi.tradable_matches` / `kpi.quoted_books` | HQ KPI strip chips |
| `ui.events.filter.liquidity` | Board filter enum (priced/active + desk gates) |
| `kalshi_spread` / `kalshi_volume` | Spread / volume metrics |

HQ overview loads `/api/liquidity/summary` for desk chips + `#volume-liquidity-panel`.

## Gates (glossary-aligned)

- **Volume**: prefer `volume_24h_fp`, else lifetime `volume_fp` ≥ 500  
- **Spread**: ≤ 15¢ on last non-empty top-of-book (14d max age)  
- **Tradable**: liquidity_ok ∧ mid ∈ [20, 80]¢  

Empty `bids:[]` shells do not count as quotes.

## Artifacts

| Path | Role |
|------|------|
| `research/cache/match-liquidity-ground/dashboard.html` | Desk board |
| `research/cache/match-liquidity-ground/latest.json` | Ground index |
| `research/registry/` + `snapshots/keeper-*.json` | Data-plane snapshots (`liquidity` KPIs) |

## Tests

```bash
bun run test:liquidity
```

## Related

- [`docs/CRON.md`](CRON.md) — schedule inventory  
- [`docs/BUN_NATIVE.md`](BUN_NATIVE.md) — Bun.cron / WebView / Image / fs.watch map  
- Implementation: `src/institutions/event-store/match-liquidity*.ts`, `tools/match-liquidity-*.ts`
