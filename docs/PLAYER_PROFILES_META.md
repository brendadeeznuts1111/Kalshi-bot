# Player profiles — meta contract

SSOT module: [`src/research/player-profile-meta.ts`](../src/research/player-profile-meta.ts).  
Unit rules: [`docs/GLOSSARY.md`](GLOSSARY.md) (`countFp`, `atMs`).

## One meaning per name

| Name | Layer | Meaning |
|------|--------|---------|
| `volume_fp` | SQLite `markets` (TEXT) | Kalshi **lifetime** contract volume (wire fixed-point string) |
| `volume_24h_fp` | SQLite `markets` (TEXT) | Kalshi **trailing 24h** contract volume; often `"0.00"` when empty |
| `open_interest_fp` | SQLite `markets` (TEXT) | Open interest (wire string) |
| `kalshi_volume_24h` | SQLite `price_snapshots` (REAL) | **Resolved** number written by price-logger (from markets, not poly) |
| `kalshi_open_interest` | SQLite `price_snapshots` (REAL) | Resolved OI from markets |
| `avg_kalshi_volume_fp` | SQLite `player_profiles` (REAL) | Mean resolved market volume over trading appearances |
| `last_seen_ts` | SQLite `player_profiles` (INTEGER) | Epoch **milliseconds** of latest event `start_ts` (event-store, not Kalshi wire seconds) |
| `avgKalshiVolumeFp` | TS + JSON API | Same as `avg_kalshi_volume_fp` |
| `lastSeenAtMs` | TS + JSON API | Same as `last_seen_ts`, capped ≤ now at read/write |
| `profilesSource` | JSON only | `"warehouse"` = event-store derived; `"seed"` = unavailable / fixture path |

## Resolve rule (volume)

```
resolved_vol = volume_24h_fp if cast(volume_24h_fp) > 0 else volume_fp
```

SQL fragments in the meta module:

| Constant | Role |
|----------|------|
| `SQL_MARKET_VOLUME_FP` | Per-market resolve (ticker / logger) |
| `SQL_EVENT_VOLUME_FP` | Per-event SUM of match_winner legs only |

Used by:

- `tools/tennis/build-player-profiles.ts` (event → player average)
- `tools/tennis/build-player-opponent-profiles.ts` (H2H average)
- `scripts/price-logger.ts` (ticker → snapshot `kalshi_volume_24h`)
- `tennis-hq-data` player detail recent events

**Secondary snapshots:** if markets yield no volume for a player, average `price_snapshots.kalshi_volume_24h` is used. Markets win when both exist (no `max` merge of estimators).

**Surfaces JSON:** nested `{ wins, losses, apps }` per surface (not bare counts). UI formats via `formatSurfacesDisplay`.

## Sort

| `?sort=` | ORDER BY |
|----------|----------|
| `volume` (default) | `avg_kalshi_volume_fp DESC NULLS LAST, appearances DESC` |
| `appearances` | `appearances DESC, win_rate DESC` |

## Forbidden / retired names

Do **not** use these for player profiles:

| Alias | Why retired |
|-------|-------------|
| `avgVolume` | Venue-ambiguous; not in schema |
| `avgVolumeFp` on profiles | Conflicts with warehouse **event** ITF avg; use `avgKalshiVolumeFp` |
| `avgKalshiVolume` | Missing `Fp` unit suffix (glossary) |
| `lastSeenMs` | Use `lastSeenAtMs` (glossary `AtMs`) |
| `lastSeenAt` as API number or dual ISO field | API is `lastSeenAtMs`; UI formats date at the edge |
| `poly_volume` | No column in event-store |
| separate `price_history.db` | SSOT is `event-store.db` |

## Not the same field

| Name | Entity |
|------|--------|
| `ItfVolumeSummary.avgVolumeFp` | Mean **event** volume in warehouse CLI summary — not a player profile field |
| market board `volume24h` | Live board mid market, not profile average |

## Commands

```bash
bun run tennis:profiles:dry    # no write; top-by-volume preview
bun run tennis:profiles:build  # rebuild player_profiles
bun run logging:dry            # one price-logger cycle, no INSERT
```
