# Data model — current state and unified target

Surveyed from the live databases (`research/cache/massey.db`, `research/cache/event-store.db`) and the ingest/pipeline code. Goal: one canonical event identity, one side vocabulary, one odds-row contract.

## 1. Current state (the fragmentation)

### Databases

| DB | Tables | Role |
|----|--------|------|
| `massey.db` | `massey_snapshots`, `massey_ratings` | Massey ratings snapshots (fetch/cache), keyed by sport target |
| `event-store.db` | 33 tables | Book catalog, odds, markets, execution, source-* staging, live scores |

### Event identity: four namespaces, no single join key

| Namespace | Where it appears | Example |
|-----------|------------------|---------|
| Canonical hash (32-hex) | `events.event_id`, `price_snapshots.event_id`, `book_ticks.event_id`, `event_links.stadion_event_id`/`kalshi_event_id` | `78021648fa8c…` |
| fantasy402 numeric `odds_event_id` | `skin_events.odds_event_id`, `odds_ticks.event_id` (pandora capture), coefficient store | `19749582` |
| Kalshi ticker | `price_snapshots.ticker`, `book_ticks.ticker`, `markets.ticker` | `KXITFMATCH-26JUL22SANALV-SAN` |
| Readable `match_key` | `event_links.match_key`, `price_snapshots.match_key`, `stadion-kalshi-bridge.buildMatchKey` | `2026-07-22|KXITFWMATCH|pace|trevisan` |

`events` (canonical hash + `player_a`/`player_b` + `start_ts`) is the closest thing to an identity registry; `event_links` maps stadion↔kalshi hashes + match_key. `skin_events`/`odds_ticks` are NOT linked to it (fantasy402 numeric ids only). `price_snapshots.match_key` is currently unpopulated in the live DB.

### Side vocabulary: four dialects

| Dialect | Where | Canonical mapping |
|---------|-------|-------------------|
| `home` / `away` | pandora capture, massey crossref, odds-ticks contract | — (canonical) |
| `winner` / `loser` | tennis-history odds (canonical corpus) | resolve via `events.winner`/`loser` names vs `player_a`/`player_b` |
| selection `1` / `2` | coefficient lines (`marketType` 3, `period m`) | 1 → home, 2 → away |
| yes / no | Kalshi markets (`yes_side_label`, `side_code`) | resolve via competitor/side labels |

## 2. Unified target model

### Canonical event key: `match_key`

`day|lane|sorted-last-names` (as built by `buildMatchKey`) is the single join key. Every source id maps to it through an identity registry:

- `events` = the registry: `event_id` (canonical hash) + `player_a`/`player_b`/`start_ts` (names needed to resolve sides).
- `event_links` = source-id → match_key map (stadion/kalshi today; extend to odds_event_id + ticker).
- New/migrated rows: `skin_events` and `odds_ticks` gain `match_key` (and `competitor_a`/`competitor_b` where available) so any consumer joins on one key.

### Unified side vocabulary: home/away

One `normalizeSideToHomeAway(side, homeName, awayName)` in `src/institutions/event-store/event-identity.ts`:

- `home`/`away` → as-is; `1`/`2` → home/away; `yes`/`no` → home/away.
- `winner`/`loser` → home/away by comparing the winning/losing competitor name against `homeName`/`awayName`; `null` when names are unavailable or ambiguous.

### Unified odds row contract (odds_ticks)

`event_key(match_key)` · `source` · `side` (home/away) · `decimal_odds` · `implied_prob` · `ts` · `corpus` · `limit_context`.

- pandora capture already writes home/away (✓).
- tennis-history writes `winner`/`loser` under the canonical hash — migrate to home/away by resolving through `events` names, and add the match_key.

### Table roles (grouped)

| Role | Tables |
|------|--------|
| Identity registry | `events`, `event_links` |
| Book catalog | `skin_events`, `inventory_leagues`, `provider_sport_mappings` |
| Odds | `odds_ticks` (live contract), `price_snapshots` (multi-venue probs), `book_ticks` (orderbooks) |
| Market reference | `markets`, `match_liquidity`, `resolutions` |
| Execution | `betting_accounts`, `partner_ledger`, `partners` |
| Source staging | `source_*` (inventory/metadata runs, events, markets, outcomes, participants) |

## 3. Migration steps (incremental, gate-safe)

1. `event-identity.ts` SSOT (match_key build/parse + side canonicalization) + tests. **done**.
2. `match_key` columns on `skin_events` + `odds_ticks` (open-db migrations) + `backfillMatchKeys` (copies from `event_links`, stadion or kalshi side) + `canonicalizeOddsSides` (winner/loser → home/away via `events` names) + `db:canonicalize` CLI + `latestOddsByMatchKey` query. **done** — all unit-tested; the live DB currently has no linked/winner-loser rows to migrate (honest 0s).
3. Tennis-history odds writes stay `winner`/`loser` (no Kalshi lane → no match_key); `canonicalizeOddsSides` handles them at read time. **partial — documented**.
4. Canonical key flows through the odds pipeline: `matchKeyForEventId` (backfilled column or `event_links`), `PricedBookEvent.matchKey` → `EdgeFlag.matchKey` (CLI prints it, JSON artifact carries it), and `latestOddsForEvent`/`latestOddsByMatchKey` now resolve `winner`/`loser` sides through the `events` registry (names) — the unified query returns home/away for every corpus. **done**. (The Massey side remains a team-name lookup — Massey ratings are per-team, not per-match, so crossref matching stays name-based by nature.)
5. Optionally a `unified_odds` view over odds_ticks + price_snapshots for reporting.

## 4. Open notes

- `price_snapshots.match_key` is empty in the live DB (population pending).
- Volleyball (corrected 2026-08): the full bucket IS ingested — cvol/ncaa-d1 (698 rows), cvol d2/d3, cmvol d1, dlv (894), dlvw (800, domestic women: Turkey/Italy/Poland/China clubs), csand (124), all via the WebView Cloudflare path. Real book coverage is 0/8 because the fantasy402 volleyball leagues (Belarus Liga Pro, Indiya, Russia League Pro Women, UPVL Nations League Women) are not in Massey's NCAA or domestic club ratings. The one apparent crossref match (book "Sokol" → Massey "SG SVS SokolAustria") is a FALSE POSITIVE — the 4-char strong-match heuristic matched a shared club nickname across countries; cross-country nickname collisions are a known quality risk of the name-matching guard.
- NCAA women's volleyball READINESS (verified 2026-08, Fonbet sighting): the cvol/ncaa-d1 ratings match real NCAA teams with EXACT quality (Nebraska/Texas → p(home) 0.967; Wisconsin/Stanford → 0.839) and edge flags compute (Nebraska @1.35 → away +54.9%; Wisconsin @1.80 → away +33.9%). When the book adds NCAA women's volleyball under `sport='volleyball'`, the pipeline lights up with no code change. Caveat: pre-season Massey EW/EL spreads are extreme (0-0 records extrapolated) — early-season flags will be noisy until the season develops; expect to raise the flag threshold or gate on games played.
- Fonbet feed adapter (2026-08): `src/institutions/fonbet/` — parser built fixture-first on the documented ODDSCORP wire shape (update_event + update_markets; market_type 1 family = moneyline; outcomes resolve by team name or literal 1/2), sync persists into the UNIFIED contract (`skin_events` book_id='fonbet', inventory_id = native event id; `odds_ticks` source='fonbet.oddscorp', home/away decimal) so edge-flags consume it with zero changes. `bun run fonbet:sync` supports `--fixture` (offline JSONL messages) and live ODDSCORP WS (needs ODDSCORP_AUTH_KEY; endpoint reachable from this machine, fonbet.com itself geo-403s). Parser is UNVERIFIED against a real capture — the fixture-first tests pin the documented shape; verify with one real feed before trusting. Third-party feed — comply with provider ToS. Connection manager (`connection.ts`, Bun-native): `Bun.dns.prefetch` + `fetch.preconnect` DNS/TCP warm-up (BOTH real in 1.4.0 — preconnect is typed in globals.d.ts, not bun.d.ts; verified working with `http://host:port` + `{ dns, tcp }`, while `https://` URLs throw "Invalid port" in this build), manual WebSocket reconnect with exponential backoff (Bun's reconnect/idleTimeout options are server-side only), client-side sport/league/team filters applied before persistence, `live_delay` surfaced via logs, `dnsCacheStats()` passthrough (`Bun.dns.getCacheStats()` → hits/misses/size/errors).
- `match_key` as built today is tennis-lane-specific; generalize to `day|sport|competitors` if non-tennis sports need it.
