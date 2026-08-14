# Inventory Map-lane backlog

**Status:** living operator backlog (Lane B only — never on the 30s Capture loop).  
**Playbook:** [`INVENTORY.md`](INVENTORY.md) · modules: `src/inventory/`  
**Snapshot date:** 2026-08-14 · `main` @ post-promote/resolve/enrich pass

---

## Done (do not re-litigate)

| Item | Evidence |
| ---- | -------- |
| Multi-sport CSV Capture (`--sport=a,b`) | #131 |
| Soccer ↔ Football sportId filter | #132 |
| Operator Capture profile + two-lane docs | `INVENTORY.md` |
| `inventory:leagues --resolve` scored + threshold apply | #133 |
| Enrich `--limit` + sport-scoped candidates | #133 |
| Promote min-peak=2 seeds (5) + wire aliases (6 exact resolve) | `competitions.ts` commit |
| First Map enrich batch live | odds-link **19 → 25** (4% → **5%**) |

---

## Current metrics (operator machine)

| Metric | Value | Notes |
| ------ | ----- | ----- |
| `inventory_leagues` total | ~146 | grows with Capture |
| Unmapped leagues | **~45** | of which **soccer ~27** (many junk matchups) |
| Live unmapped | ~13 | peak=1 mostly |
| Resolve auto @0.9 | **0** | after last apply; review ~7 |
| `skin_events` odds-link | **25/471 (5%)** | unlinked ~446 |
| Worst event link rates | BB **0%**, TT **~4%**, soccer **~2%**, tennis **~20%** | Map enrich focus |

---

## Weakest points (ranked)

### W1 — Odds link rate ~5% (largest value gap)

**Why weak:** Statscore name soft-match only; no `start_time` on stream rows; TT Masters names rarely in public booked catalog; basketball 0% linked.

**Next work:**

1. Enrich batches by sport priority (not full book thrash):
   ```bash
   bun run inventory:sync -- --enrich-only --sport=tennis --limit=100
   bun run inventory:sync -- --enrich-only --sport=table_tennis --limit=100 --dry-run --json
   bun run inventory:sync -- --enrich-only --sport=soccer,basketball --limit=80 --dry-run --json
   ```
2. Inspect `enrich-quality` `byReason` (today: mostly `no_score`) — improve `booked-match` only if tennis improves first.
3. Optional: adapter `listBookedEvents` when Fantasy env present (wider catalog than public alone).
4. **Do not** invent start_time match until wire has kickoff; document that limit.

**Done when:** core sports linkedPct ≥ 15% tennis / ≥ 10% TT on unlinked-attempted cohort (not whole historical book).

---

### W2 — Soccer unmapped pile (junk + real leagues mixed)

**Why weak:** ~27 unmapped soccer rows; many are **matchup blobs** already rejected by promote (`matchup_blob`). Real cups (Sudamericana, Concacaf CAC, NVSL) still peak=1 so min-peak=2 promote skips them.

**Next work:**

1. Alias pass for real cups already in `COMPETITIONS` (pattern: Libertadores):
   - `Copa Sudamericana` → existing CONMEBOL Sudamericana seed if any
   - `Concacaf Central American Cup` → existing seed if any
2. Promote **allowlist** peak=1 for named real leagues only (not country/junk):
   ```bash
   bun run inventory:leagues -- --promote --min-peak=1 --sport=soccer --json
   # apply only non-junk after eye-ball
   ```
3. Consider quarantine: stop upserting leagues that fail `junkLeagueReason` into durable registry (Capture hygiene — separate PR).

**Done when:** live unmapped soccer is only obscure regionals, not major CONMEBOL/Concacaf labels.

---

### W3 — Wire label drift vs seed names (alias treadmill)

**Why weak:** Stream uses `ATP - Cincinnati`; seeds use `ATP Cincinnati, USA`. Resolve exact needs hand aliases; soft 0.85 never auto-applies (correct).

**Next work:**

1. Alias pack for live unmapped that have obvious seeds:
   - `WTA Doubles - Toronto` → dedicated doubles seed or `tennis.wta_doubles` only if product-level OK
   - `UTR Pro Tennis Series` → international UTR seed alias
   - `Challenger - Brownsburg` already aliased; doubles line stays separate
2. Small tool (optional): `inventory:leagues -- --suggest-aliases` printing seed id + proposed alias for conf 0.8–0.89 review rows.

**Done when:** major tour short labels resolve exact without new promote noise.

---

### W4 — Live garbage “leagues”

**Why weak:** e.g. basketball `j0G05k8CMNI` live unmapped; soccer matchup blobs in registry at peak=1; promote correctly rejects but registry still grows.

**Next work:**

1. On league upsert: skip/drop `junkLeagueReason` keys (or mark `ignored` column) — **Capture-adjacent** but Map benefits.
2. One-shot cleanup: delete inventory_leagues where junk + peak≤1 + live=0.
3. Never promote ebasketball-style product noise without operator intent (already have one seed — freeze further e-* unless needed).

**Done when:** live unmapped list has no opaque tokens / matchup blobs.

---

### W5 — Capture / Map process hygiene

**Why weak:** dual runners (watch + cron) risk double poll; enrich on watch forbidden but easy to forget; stream-list 2m cache makes 30s ticks look “stuck” (OK).

**Next work:**

1. Operator checklist remains: **one** Capture process.
2. Document Map cron examples (no code required first):
   - daily: `inventory:leagues --resolve --apply`
   - every 6h: `inventory:sync --enrich-only --sport=table_tennis,tennis,soccer,basketball --limit=100`
3. Session-probe if public list empty / 403 (already built).

---

### W6 — Competition meta quality on new seeds

**Why weak:** promoted rows often `kind=unknown`, `countryCode=null` (UTR, Chile LNB, Paraguay).

**Next work:** hand-fill meta on high-traffic seeds; inference already helps display.

---

## Work queue (next thread)

Copy this into the next session and tick down.

### P0 — this week Map ops (no big code)

- [ ] Alias pack: Sudamericana, Concacaf CAC, WNBA (if seed exists), UTR Pro Tennis Series
- [ ] `inventory:leagues -- --resolve --apply` after aliases
- [ ] Enrich live: tennis then soccer (limit 100 each); record linkedPct delta
- [ ] Promote dry-run peak=1 core sports; apply **≤10** clean real leagues only

### P1 — small code (single PR)

- [ ] Junk filter on **league upsert** (or purge CLI for junk rows)
- [ ] `suggest-aliases` or resolve JSON export for conf 0.8–0.89 review
- [ ] Optional `enrich_attempted_at` cooldown if we re-hit same no_score forever

### P2 — later

- [ ] Pandora/start_time plane if wire gains schedule fields
- [ ] Coverage board bake refresh for Map metrics
- [ ] Lower resolve threshold **only** with per-kind policy (never global fuzzy auto)

---

## Commands cheat sheet (Map only)

```bash
# Status
bun run inventory:leagues -- --unmapped
bun run inventory:leagues -- --resolve --json
bun run inventory:sync -- --odds-status --json

# Leagues
bun run inventory:leagues -- --promote --min-peak=2 --json
bun run inventory:leagues -- --promote --apply --min-peak=2
bun run inventory:leagues -- --resolve --apply --threshold=0.9
bun run inventory:leagues -- --backfill

# Odds (batched)
bun run inventory:sync -- --enrich-only --sport=tennis --limit=100 --dry-run --json
bun run inventory:sync -- --enrich-only --sport=tennis --limit=100
bun run inventory:enrich:quality

# Capture (do not mix Map flags)
bun run inventory:watch -- --loop \
  --sport=table_tennis,tennis,soccer,basketball \
  --interval-ms=30000
```

---

## Next-thread opener (paste)

> Continue Map lane from `docs/INVENTORY-MAP-BACKLOG.md`. Weakest: **W1 odds ~5%**, **W2 soccer unmapped junk**, **W3 alias treadmill**. Run P0 alias pack + resolve apply + tennis/soccer enrich batches; only then P1 junk-on-upsert if registry still polluted.

---

## See also

- [`INVENTORY.md`](INVENTORY.md) — Capture profile + Map cadence  
- [`CRON.md`](CRON.md) — `INVENTORY_SYNC` (Capture; promote-report only)  
- `src/inventory/league-resolve.ts` · `booked-match.ts` · `domain/competition-promote.ts`
