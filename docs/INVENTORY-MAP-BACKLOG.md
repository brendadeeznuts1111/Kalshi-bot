# Inventory Map-lane backlog

**Status:** living operator backlog (Lane B only — never on the 30s Capture loop).  
**Playbook:** [`INVENTORY.md`](INVENTORY.md) · modules: `src/inventory/`  
**Snapshot date:** 2026-08-14 · `main` @ Map P0 pass (aliases + 10 seeds + resolve + enrich)

---

## Done (do not re-litigate)

| Item | Evidence |
| ---- | -------- |
| Multi-sport CSV Capture (`--sport=a,b`) | #131 |
| Soccer ↔ Football sportId filter | #132 |
| Operator Capture profile + two-lane docs | `INVENTORY.md` |
| `inventory:leagues --resolve` scored + threshold apply | #133 |
| Enrich `--limit` + sport-scoped candidates | #133 |
| Promote min-peak=2 seeds (5) + first wire aliases | earlier `competitions.ts` |
| **Map P0:** aliases + 10 curated seeds + resolve 13 exact | this pass |
| First Map enrich batches | odds-link **19 → 26** (still ~**5%**) |

---

## Current metrics (operator machine)

| Metric | Value | Notes |
| ------ | ----- | ----- |
| `inventory_leagues` total | ~146 | grows with Capture |
| Unmapped leagues | **~32** (was ~45) | mostly soccer **matchup_blob** junk + TT short labels |
| Live unmapped | **0** | all live board labels mapped this pass |
| Resolve auto @0.9 | **0** remaining | review ~3 (TT soft only) |
| `skin_events` odds-link | **26/473 (5%)** | tennis enrich 0/8; soccer 1/32 this tick |
| Worst event link rates | BB **0%**, TT low, soccer low | **W1 still dominant** |

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

## Work queue

### P0 — Map ops — **done 2026-08-14**

- [x] Alias pack: WTA Doubles Toronto, UTR Pro Tennis Series, Brazil FPB
- [x] Curated seeds (10): ATT Tallahassi, Brownsburg MD doubles, WNBA, Copa do Brasil U22, Liga JugaBet, Copa Sudamericana, Concacaf CAC, USA NVSL, Dominica PL, Boa-Viagense
- [x] `inventory:leagues -- --resolve --apply` → **13** exact stamps; unmapped **45→32**; live unmapped **0**
- [x] Enrich tennis (0/8) + soccer (1/32); odds-link **25→26** (still 5%)

### P1 — next thread (priority order)

- [ ] **W1 deep-dive:** enrich with Fantasy adapter catalog (not public-only) when env present; compare match rate
- [ ] **W1:** TT-focused catalog aliases / softer name fold for Masters. * players (measure only)
- [ ] **W4:** junk filter on league upsert + purge matchup_blob rows from `inventory_leagues`
- [ ] Optional `suggest-aliases` for conf 0.8–0.89 review (TT Setka / Argentina / Belarusy)

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

> Continue Map from `docs/INVENTORY-MAP-BACKLOG.md`. **P0 done** (live unmapped=0, unmapped 32 junk-heavy). Weakest left: **W1 odds ~5%** (tennis 0/8 public catalog). Next: Fantasy-adapter enrich vs public; **W4** purge matchup_blob leagues from registry.

---

## See also

- [`INVENTORY.md`](INVENTORY.md) — Capture profile + Map cadence  
- [`CRON.md`](CRON.md) — `INVENTORY_SYNC` (Capture; promote-report only)  
- `src/inventory/league-resolve.ts` · `booked-match.ts` · `domain/competition-promote.ts`
