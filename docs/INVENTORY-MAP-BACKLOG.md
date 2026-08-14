# Inventory Map-lane backlog

**Status:** living operator backlog (Lane B only — never on the 30s Capture loop).  
**Playbook:** [`INVENTORY.md`](INVENTORY.md) · modules: `src/inventory/`  
**Snapshot date:** 2026-08-14 · Map P1 (junk purge + full-catalog enrich)

---

## Done (do not re-litigate)

| Item | Evidence |
| ---- | -------- |
| Multi-sport CSV Capture (`--sport=a,b`) | #131 |
| Soccer ↔ Football sportId filter | #132 |
| Operator Capture profile + two-lane docs | `INVENTORY.md` |
| `inventory:leagues --resolve` scored + threshold apply | #133 |
| Enrich `--limit` + sport-scoped candidates | #133 |
| Map P0 aliases + 10 seeds + resolve | earlier pass |
| **W4** junk skip on league upsert + `--purge-junk` | this pass |
| **W1** enrich-only uses **full** public catalog (not sport-narrowed) | this pass |
| Map enrich multi-sport batch | odds-link **26 → 34** (**5% → 7%**) |

---

## Current metrics (operator machine)

| Metric | Value | Notes |
| ------ | ----- | ----- |
| `inventory_leagues` total | **~119** | purged 30 junk |
| Unmapped leagues | **~5** | TT soft (Setka, Masters Belarusy, country buckets) |
| Live unmapped | ~0 | restart Capture after junk filter ships |
| Resolve auto @0.9 | 0 | soft TT only |
| `skin_events` odds-link | **34/482 (7%)** | full catalog + core multi-sport enrich |
| Fantasy adapter enrich | **blocked** | `loadFantasy402ProfileFromEnv()` → null (no FANTASY402_* in env) |

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

### W4 — Live garbage “leagues” — **mostly done**

**Shipped:** upsert skips `junkLeagueReason`; `inventory:leagues --purge-junk [--apply]` deleted 30 (25 matchup_blob + 5 no_structure).

**Residual:** soft TT labels (Setka, Masters Belarusy); country buckets (Polysha, Ispaniya) kept. Restart Capture so new upsert filter is live.

**Done when:** live unmapped has no opaque tokens / matchup blobs — **met after purge**; keep Capture process updated.

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

### P1 — this pass

- [x] **W4:** junk filter on upsert + `--purge-junk --apply` (30 deleted)
- [x] **W1:** full catalog on enrich-only; multi-sport enrich → **7%** linked
- [ ] **W1:** Fantasy adapter path when Proton/FANTASY402_* env loaded (profile currently null)
- [ ] **W1:** name-match improvements for doubles/UTR/Masters TT (`no_score` dominant)
- [ ] Restart Capture watch process after deploy (picks up junk upsert filter)
- [ ] Optional aliases for residual TT: Masters Belarusy, Setka short label

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

# Odds (batched; enrich-only uses full public catalog)
bun run inventory:sync -- --enrich-only --sport=tennis --limit=100 --dry-run --json
bun run inventory:sync -- --enrich-only \
  --sport=table_tennis,tennis,soccer,basketball --limit=150
bun run inventory:enrich:quality

# Registry hygiene
bun run inventory:leagues -- --purge-junk
bun run inventory:leagues -- --purge-junk --apply

# Capture (do not mix Map flags)
bun run inventory:watch -- --loop \
  --sport=table_tennis,tennis,soccer,basketball \
  --interval-ms=30000
```

---

## Next-thread opener (paste)

> Continue Map from `docs/INVENTORY-MAP-BACKLOG.md`. **P0+P1 W4 done** (unmapped ~5, linked **7%**). Weakest: **W1** still `no_score` on doubles/UTR/TT; Fantasy env null. Next: load FANTASY402_* for adapter catalog; improve `booked-match` for doubles names; restart Capture.

---

## See also

- [`INVENTORY.md`](INVENTORY.md) — Capture profile + Map cadence  
- [`CRON.md`](CRON.md) — `INVENTORY_SYNC` (Capture; promote-report only)  
- `src/inventory/league-resolve.ts` · `booked-match.ts` · `domain/competition-promote.ts`
