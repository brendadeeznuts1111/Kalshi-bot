# Sports/source registry

The sports/source registry is the project contract for adding a sport, venue, or market family without creating a second acquisition stack.

## Three planes

| Plane | Authority | Purpose |
|---|---|---|
| Declaration | [`market-registry/registry.ts`](../src/institutions/market-registry/registry.ts) | What sports, sources, adapters, selectors, capabilities, and competition bindings the artifact supports |
| Discovery | [`source-metadata-runner.ts`](../src/institutions/event-store/source-metadata-runner.ts) | What source-global metadata Kalshi and Polymarket currently publish, classified for every registered sport |
| Inventory | Source inventory adapters and event-store tables | The actual events and markets acquired through sport/source selectors |

Metadata discovery does not invent event coverage. It discovers venue taxonomy, then the declared competition selectors own event inventory.

## Public surfaces

| Surface | Contract |
|---|---|
| `public/registry/sports-sources.json` | Stable declaration artifact (`sports-source-registry/v1`) |
| `GET /registry/sports-sources.json` | Served declaration artifact |
| `GET /api/registry/sports-sources` | Declaration plus current discovery/store health (`sports-source-catalog/v1`) |
| `research/cache/event-store.db` | Durable run, entity, classification, and inventory truth |

The live API is client-side `no-store` and uses a five-second server cache. A missing or legacy database returns `unavailable`/`degraded` without erasing declared integrations.

## Operate

```bash
bun run sports:registry:check
bun run sports:metadata:sync
bun run sports:metadata:sync -- --source=kalshi --sport=tennis,table_tennis
bun run sports:metadata:sync -- --json
```

The master cron refreshes source metadata every 15 minutes. Each source is acquired once and classified across all of its registered sports. Runs are isolated per venue: one failed venue does not suppress the other venue's completed snapshot.

Scheduler ownership rules:

- one in-process single-flight owner joins overlapping ticks;
- graceful shutdown drains the active metadata job before closing SQLite;
- a durable `running` authority is recovered after a five-minute no-progress lease;
- recovery uses the latest checkpoint/start heartbeat, scopes to prevalidated targets, and never mutates an unrelated source;
- freshness and serving retention remain separate: `freshForMs` marks stale, `staleForMs` marks expired.

## Add a sport

1. Add its branded `SportKey` constant in [`brands.ts`](../src/institutions/market-registry/brands.ts).
2. Add one `SportDefinition` to `SPORTS` with its family and aliases.
3. Add one `SportSourceRegistration` per supported source. Declare:
   - integration state and capabilities;
   - metadata classification policy;
   - competition selectors;
   - event types and participant formats;
   - market mappings and identity fields;
   - inventory/match/trade use.
4. Reuse the source's metadata adapter. Source-global metadata must not be fetched once per sport.
5. Bake and verify the declaration, then run discovery:

```bash
bun run sports:registry:bake
bun run sports:registry:check
bun run sports:metadata:sync -- --sport=<sport_key>
```

6. Add classification, inventory, and catalog-cell tests. The catalog must emit the new cell even before its first acquisition.

## Add a source

1. Add branded source, adapter, selector, scope, and provider identity constructors.
2. Implement strict wire parsers for source metadata and event/market inventory.
3. Register one adapter definition with cache policy, metadata discovery selector, page mode, and selector validator.
4. Compose both runtime adapters in [`runtime.ts`](../src/institutions/market-registry/runtime.ts).
5. Add sport/source registrations only where semantics are known. Unsupported combinations remain explicit rather than inferred.
6. Prove source failure isolation, cursor/atomic completeness, literal outcome mapping, and active-snapshot retirement behavior.

No scheduler, read-model, API, or catalog code should need a source-specific branch after runtime composition.

## Required invariants

- Domain IDs are branded after the boundary; provider wire values are parsed once.
- There is exactly one metadata discovery authority per source.
- Concurrency ownership is `(source, selector scope)`; adapter identity is stored and validated as part of the run contract, but it does not permit a second owner for the same scope.
- Event type and participant format are pre-match gates, never conclusions drawn from a successful name match. Kalshi resolves the lane from an enabled, reconciliation-authorized exact series binding. A Polymarket sport tag remains acquisition scope only: the adapter resolves a match lane only when an attached tag, a registry-owned `seriesSlug` mapping, and one coherent two-participant moneyline agree. Unknown series, selector drift, generic outcomes, missing/ambiguous moneylines, participant conflicts, and format conflicts remain quarantined. A separate redundant rule classifies field tournaments only when a `Winner` title, tournament/winner resolution text, multiple named Yes/No child markets, and absence of sports market types agree; tournament rows remain excluded from match reconciliation, and proposition events remain quarantined.
- Price snapshots persist the exact Kalshi series/event/participant lane plus the Polymarket observation time and cache state. HQ re-resolves the stored lane against the current registry and never counts legacy, expired, or identity-free prices as healthy coverage; stale/degraded/circuit-fallback quotes remain visible but force degraded health.
- Atomic sources publish one complete terminal page. Cursor sources may terminate on an empty tail only after staging records.
- Empty, partial, replay-mutated, clock-regressed, or registry-drifted snapshots cannot retire active truth.
- Latest attempt and serving complete snapshot are separate health concepts.
- Registered/quarantined detail is public; ignored bulk is counted in SQL and not emitted.
- Registry-run and classification fingerprints are separate, so reclassification is not mislabeled as mixed source data.

## Verification

```bash
bun test tests/institutions/market-registry.test.ts
bun test tests/institutions/source-metadata-adapters.test.ts
bun test tests/institutions/source-metadata-runner.test.ts
bun test tests/institutions/source-metadata-read.test.ts
bun test tests/scripts/sync-sports-source-metadata.test.ts
bun test tests/scripts/cron-sports-metadata.test.ts
bun run typecheck
```

For live proof, run `bun run sports:metadata:sync` and inspect the four tennis/table-tennis × Kalshi/Polymarket cells from `/api/registry/sports-sources`.
