import type { Database } from "bun:sqlite";
import {
  asSourceEventId,
  asSourceKey,
  asSportKey,
  unbrand,
  type SourceEventId,
  type SourceKey,
  type SportKey,
} from "../market-registry/brands.ts";
import {
  registrationFor,
  SPORTS_SOURCE_REGISTRY,
} from "../market-registry/registry.ts";
import type {
  NormalizedSourceObservation,
  SportsSourceRegistry,
} from "../market-registry/types.ts";

export type SourceObservationWriteResult = "inserted" | "updated" | "ignored_older";

export type SourceEventInventoryRow = {
  source: SourceKey;
  eventId: SourceEventId;
  sport: SportKey;
  title: string;
  startsAtMs: number | null;
  lastObservedAtMs: number;
};

export type SourceEventInventoryQuery = {
  source: SourceKey;
  sport: SportKey;
  afterEventId?: SourceEventId;
  limit?: number;
  includeRetired?: boolean;
};

type ExistingEventRow = {
  sport_key: string;
  title: string;
  source_updated_at_ms: number | null;
  last_observed_at_ms: number;
};
type ExistingMarketRow = {
  eventId: string;
  title: string;
  sourceUpdatedAtMs: number | null;
  lastObservedAtMs: number;
  subjectParticipantId: string | null;
};
type ExistingOutcomeRow = {
  ordinal: number;
  label: string;
};
type ActiveOutcomeRow = {
  marketId: string;
  outcomeKey: string;
  participantId: string | null;
};
type SourceEventWireRow = {
  source_key: string;
  source_event_id: string;
  sport_key: string;
  title: string;
  starts_at_ms: number | null;
  last_observed_at_ms: number;
};

/**
 * Persist one parsed source observation atomically. Older observations never
 * regress current state. Complete snapshots logically retire missing children;
 * partial snapshots retain them. Rows remain recoverable and are never deleted.
 */
export function upsertSourceObservation(
  db: Database,
  observation: NormalizedSourceObservation,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SourceObservationWriteResult {
  assertObservationInput(observation, registry);
  const write = db.transaction((): SourceObservationWriteResult => {
    const source = unbrand(observation.source);
    const eventId = unbrand(observation.eventId);
    const observedAtMs = observation.provenance.observedAtMs;
    const existing = db
      .query(
        `SELECT sport_key, title, source_updated_at_ms, last_observed_at_ms
         FROM source_events
         WHERE source_key = $source AND source_event_id = $eventId`,
      )
      .get({ $source: source, $eventId: eventId }) as ExistingEventRow | null;
    if (existing && existing.sport_key !== unbrand(observation.sport)) {
      throw new Error(`source event sport drift: ${source}:${eventId}`);
    }
    const eventTitle = observation.title ?? existing?.title;
    if (eventTitle === undefined) {
      throw new Error("partial event insert requires title");
    }
    const participants = observation.participants ?? [];
    const markets = observation.markets ?? [];
    if (existing) {
      const sourceVersionOlder = isOlderSourceVersion(
        observation.provenance.sourceUpdatedAtMs,
        existing.source_updated_at_ms,
        observedAtMs,
        existing.last_observed_at_ms,
      );
      if (sourceVersionOlder) {
        upsertEventSelector(db, observation, observedAtMs);
        return "ignored_older";
      }
    }

    db.query(
      `INSERT INTO source_events (
         source_key, source_event_id, sport_key, title, status, closes_at_ms, result, starts_at_ms,
         event_type, participant_format, adapter_id, selector_kind,
         selector_scope, selector_parameters_json, source_updated_at_ms,
         first_observed_at_ms, last_observed_at_ms
       ) VALUES (
         $source, $eventId, $sport, $title, $status, $closesAtMs, $result, $startsAtMs,
         $eventType, $participantFormat, $adapter, $selectorKind,
         $selectorScope, $selectorParameters, $sourceUpdatedAtMs,
         $observedAtMs, $observedAtMs
       )
       ON CONFLICT(source_key, source_event_id) DO UPDATE SET
         sport_key = excluded.sport_key,
         title = CASE
           WHEN $partial = 1 AND $hasTitle = 0 THEN source_events.title
           ELSE excluded.title
         END,
         status = CASE
           WHEN $partial = 1 AND $hasStatus = 0 THEN source_events.status
           ELSE excluded.status
         END,
         closes_at_ms = CASE
           WHEN $partial = 1 AND $hasClosesAtMs = 0 THEN source_events.closes_at_ms
           ELSE excluded.closes_at_ms
         END,
         result = CASE
           WHEN $partial = 1 AND $hasResult = 0 THEN source_events.result
           ELSE excluded.result
         END,
         starts_at_ms = CASE
           WHEN $partial = 1 AND $hasStartsAtMs = 0 THEN source_events.starts_at_ms
           ELSE excluded.starts_at_ms
         END,
         event_type = CASE
           WHEN $partial = 1 AND $hasEventType = 0 THEN source_events.event_type
           ELSE excluded.event_type
         END,
         participant_format = CASE
           WHEN $partial = 1 AND $hasParticipantFormat = 0 THEN source_events.participant_format
           ELSE excluded.participant_format
         END,
         adapter_id = excluded.adapter_id,
         selector_kind = excluded.selector_kind,
         selector_scope = excluded.selector_scope,
         selector_parameters_json = excluded.selector_parameters_json,
         source_updated_at_ms = CASE
           WHEN excluded.source_updated_at_ms IS NULL THEN source_events.source_updated_at_ms
           WHEN source_events.source_updated_at_ms IS NULL THEN excluded.source_updated_at_ms
           ELSE MAX(source_events.source_updated_at_ms, excluded.source_updated_at_ms)
         END,
         first_observed_at_ms = MIN(
           source_events.first_observed_at_ms,
           excluded.first_observed_at_ms
         ),
         last_observed_at_ms = excluded.last_observed_at_ms`,
    ).run({
      $source: source,
      $eventId: eventId,
      $sport: unbrand(observation.sport),
      $title: eventTitle,
      $status: observation.status ?? null,
      $closesAtMs: observation.closesAtMs ?? null,
      $result: observation.result ?? null,
      $startsAtMs: observation.startsAtMs ?? null,
      $eventType: observation.eventType ?? null,
      $participantFormat: observation.participantFormat ?? null,
      $adapter: unbrand(observation.provenance.adapter),
      $selectorKind: unbrand(observation.provenance.selector.kind),
      $selectorScope: unbrand(observation.provenance.selector.scope),
      $selectorParameters: JSON.stringify(observation.provenance.selector.parameters),
      $sourceUpdatedAtMs: observation.provenance.sourceUpdatedAtMs ?? null,
      $observedAtMs: observedAtMs,
      $partial: observation.snapshotCompleteness === "partial" ? 1 : 0,
      $hasTitle: hasOwn(observation, "title") ? 1 : 0,
      $hasStatus: hasOwn(observation, "status") ? 1 : 0,
      $hasClosesAtMs: hasOwn(observation, "closesAtMs") ? 1 : 0,
      $hasResult: hasOwn(observation, "result") ? 1 : 0,
      $hasStartsAtMs: hasOwn(observation, "startsAtMs") ? 1 : 0,
      $hasEventType: hasOwn(observation, "eventType") ? 1 : 0,
      $hasParticipantFormat: hasOwn(observation, "participantFormat") ? 1 : 0,
    });

    upsertEventSelector(db, observation, observedAtMs);

    const participantStatement = db.query(
      `INSERT INTO source_event_participants (
         source_key, source_event_id, source_participant_id, ordinal, label,
         active, retired_at_ms, first_observed_at_ms, last_observed_at_ms
       ) VALUES (
         $source, $eventId, $participantId, $ordinal, $label,
         1, NULL, $observedAtMs, $observedAtMs
       )
       ON CONFLICT(source_key, source_event_id, source_participant_id) DO UPDATE SET
         ordinal = excluded.ordinal,
         label = excluded.label,
         active = 1,
         retired_at_ms = NULL,
         first_observed_at_ms = MIN(
           source_event_participants.first_observed_at_ms,
           excluded.first_observed_at_ms
         ),
         last_observed_at_ms = excluded.last_observed_at_ms
       WHERE excluded.last_observed_at_ms >= source_event_participants.last_observed_at_ms`,
    );
    if (observation.snapshotCompleteness === "complete") {
      db.query(
        `UPDATE source_event_participants
         SET active = 0, retired_at_ms = $observedAtMs
         WHERE source_key = $source AND source_event_id = $eventId AND active = 1`,
      ).run({ $source: source, $eventId: eventId, $observedAtMs: observedAtMs });
    }
    for (const participant of participants) {
      participantStatement.run({
        $source: source,
        $eventId: eventId,
        $participantId: unbrand(participant.id),
        $ordinal: participant.ordinal,
        $label: participant.label,
        $observedAtMs: observedAtMs,
      });
    }

    const marketStatement = db.query(
      `INSERT INTO source_markets (
         source_key, source_market_id, source_event_id, source_market_type,
         market_kind, title, status, closes_at_ms, result, source_updated_at_ms,
         subject_participant_id, volume, volume_24h, liquidity, clob_liquidity,
         open_interest, active, retired_at_ms, first_observed_at_ms, last_observed_at_ms
       ) VALUES (
         $source, $marketId, $eventId, $sourceMarketType,
         $marketKind, $title, $status, $closesAtMs, $result, $sourceUpdatedAtMs,
         $subjectParticipantId, $volume, $volume24h, $liquidity, $clobLiquidity,
         $openInterest, 1, NULL, $observedAtMs, $observedAtMs
       )
       ON CONFLICT(source_key, source_market_id) DO UPDATE SET
         source_event_id = excluded.source_event_id,
         source_market_type = CASE
           WHEN $partial = 1 AND $hasSourceMarketType = 0 THEN source_markets.source_market_type
           ELSE excluded.source_market_type
         END,
         market_kind = CASE
           WHEN $partial = 1 AND $hasMarketKind = 0 THEN source_markets.market_kind
           ELSE excluded.market_kind
         END,
         title = CASE
           WHEN $partial = 1 AND $hasTitle = 0 THEN source_markets.title
           ELSE excluded.title
         END,
         status = CASE
           WHEN $partial = 1 AND $hasStatus = 0 THEN source_markets.status
           ELSE excluded.status
         END,
         closes_at_ms = CASE
           WHEN $partial = 1 AND $hasClosesAtMs = 0 THEN source_markets.closes_at_ms
           ELSE excluded.closes_at_ms
         END,
         result = CASE
           WHEN $partial = 1 AND $hasResult = 0 THEN source_markets.result
           ELSE excluded.result
         END,
         source_updated_at_ms = CASE
           WHEN excluded.source_updated_at_ms IS NULL THEN source_markets.source_updated_at_ms
           WHEN source_markets.source_updated_at_ms IS NULL THEN excluded.source_updated_at_ms
           ELSE MAX(source_markets.source_updated_at_ms, excluded.source_updated_at_ms)
         END,
         subject_participant_id = CASE
           WHEN $partial = 1 AND $hasSubjectParticipantId = 0
             THEN source_markets.subject_participant_id
           ELSE excluded.subject_participant_id
         END,
         volume = CASE
           WHEN $partial = 1 AND $hasVolume = 0 THEN source_markets.volume
           ELSE excluded.volume
         END,
         volume_24h = CASE
           WHEN $partial = 1 AND $hasVolume24h = 0 THEN source_markets.volume_24h
           ELSE excluded.volume_24h
         END,
         liquidity = CASE
           WHEN $partial = 1 AND $hasLiquidity = 0 THEN source_markets.liquidity
           ELSE excluded.liquidity
         END,
         clob_liquidity = CASE
           WHEN $partial = 1 AND $hasClobLiquidity = 0 THEN source_markets.clob_liquidity
           ELSE excluded.clob_liquidity
         END,
         open_interest = CASE
           WHEN $partial = 1 AND $hasOpenInterest = 0 THEN source_markets.open_interest
           ELSE excluded.open_interest
         END,
         active = 1,
         retired_at_ms = NULL,
         first_observed_at_ms = MIN(
           source_markets.first_observed_at_ms,
           excluded.first_observed_at_ms
         ),
         last_observed_at_ms = excluded.last_observed_at_ms
       WHERE excluded.last_observed_at_ms >= source_markets.last_observed_at_ms`,
    );
    const outcomeStatement = db.query(
      `INSERT INTO source_market_outcomes (
         source_key, source_market_id, outcome_key, source_event_id,
         source_participant_id, ordinal, label,
         probability, bid, ask, last, last_trade_at_ms,
         active, retired_at_ms, first_observed_at_ms, last_observed_at_ms
       ) VALUES (
         $source, $marketId, $outcome, $eventId,
         $participantId, $ordinal, $label,
         $probability, $bid, $ask, $last, $lastTradeAtMs,
         1, NULL, $observedAtMs, $observedAtMs
       )
       ON CONFLICT(source_key, source_market_id, outcome_key) DO UPDATE SET
         ordinal = CASE
           WHEN $partial = 1 AND $hasOrdinal = 0 THEN source_market_outcomes.ordinal
           ELSE excluded.ordinal
         END,
         label = CASE
           WHEN $partial = 1 AND $hasLabel = 0 THEN source_market_outcomes.label
           ELSE excluded.label
         END,
         source_event_id = excluded.source_event_id,
         source_participant_id = CASE
           WHEN $partial = 1 AND $hasParticipantId = 0
             THEN source_market_outcomes.source_participant_id
           ELSE excluded.source_participant_id
         END,
         probability = CASE
           WHEN $partial = 1 AND $hasProbability = 0 THEN source_market_outcomes.probability
           ELSE excluded.probability
         END,
         bid = CASE
           WHEN $partial = 1 AND $hasBid = 0 THEN source_market_outcomes.bid
           ELSE excluded.bid
         END,
         ask = CASE
           WHEN $partial = 1 AND $hasAsk = 0 THEN source_market_outcomes.ask
           ELSE excluded.ask
         END,
         last = CASE
           WHEN $partial = 1 AND $hasLast = 0 THEN source_market_outcomes.last
           ELSE excluded.last
         END,
         last_trade_at_ms = CASE
           WHEN $partial = 1 AND $hasLastTradeAtMs = 0
             THEN source_market_outcomes.last_trade_at_ms
           ELSE excluded.last_trade_at_ms
         END,
         active = 1,
         retired_at_ms = NULL,
         first_observed_at_ms = MIN(
           source_market_outcomes.first_observed_at_ms,
           excluded.first_observed_at_ms
         ),
         last_observed_at_ms = excluded.last_observed_at_ms
       WHERE excluded.last_observed_at_ms >= source_market_outcomes.last_observed_at_ms`,
    );
    const previouslyActiveMarketIds = new Set<string>();
    const previouslyActiveOutcomes = new Map<string, ActiveOutcomeRow[]>();
    if (observation.snapshotCompleteness === "complete") {
      for (const row of db
        .query(
          `SELECT source_market_id AS marketId
           FROM source_markets
           WHERE source_key = $source AND source_event_id = $eventId AND active = 1`,
        )
        .all({ $source: source, $eventId: eventId }) as Array<{ marketId: string }>) {
        previouslyActiveMarketIds.add(row.marketId);
      }
      for (const row of db
        .query(
          `SELECT source_market_id AS marketId, outcome_key AS outcomeKey,
                  source_participant_id AS participantId
           FROM source_market_outcomes
           WHERE source_key = $source AND source_event_id = $eventId AND active = 1`,
        )
        .all({ $source: source, $eventId: eventId }) as ActiveOutcomeRow[]) {
        const rows = previouslyActiveOutcomes.get(row.marketId) ?? [];
        rows.push(row);
        previouslyActiveOutcomes.set(row.marketId, rows);
      }
      db.query(
        `UPDATE source_market_outcomes
         SET active = 0, retired_at_ms = $observedAtMs
         WHERE source_key = $source AND source_event_id = $eventId AND active = 1`,
      ).run({ $source: source, $eventId: eventId, $observedAtMs: observedAtMs });
      db.query(
        `UPDATE source_markets
         SET active = 0, retired_at_ms = $observedAtMs
         WHERE source_key = $source AND source_event_id = $eventId AND active = 1`,
      ).run({ $source: source, $eventId: eventId, $observedAtMs: observedAtMs });
    }
    for (const market of markets) {
      const marketId = unbrand(market.id);
      const existingMarket = db
        .query(
          `SELECT source_event_id AS eventId, title,
                  source_updated_at_ms AS sourceUpdatedAtMs,
                  last_observed_at_ms AS lastObservedAtMs,
                  subject_participant_id AS subjectParticipantId
           FROM source_markets
           WHERE source_key = $source AND source_market_id = $marketId`,
        )
        .get({ $source: source, $marketId: marketId }) as ExistingMarketRow | null;
      if (existingMarket && existingMarket.eventId !== eventId) {
        throw new Error(`source market event drift: ${source}:${marketId}`);
      }
      const marketTitle = market.title ?? existingMarket?.title;
      if (marketTitle === undefined) {
        throw new Error("partial market insert requires title");
      }
      if (
        existingMarket &&
        isOlderSourceVersion(
          market.sourceUpdatedAtMs,
          existingMarket.sourceUpdatedAtMs,
          observedAtMs,
          existingMarket.lastObservedAtMs,
        )
      ) {
        if (observation.snapshotCompleteness === "complete") {
          const activeOutcomes = previouslyActiveOutcomes.get(marketId) ?? [];
          const referencedParticipants = [
            existingMarket.subjectParticipantId,
            ...activeOutcomes.map((row) => row.participantId),
          ].filter((participantId): participantId is string => participantId !== null);
          const retainsParticipantClosure = referencedParticipants.every((participantId) =>
            participants.some(
              (participant) => unbrand(participant.id) === participantId,
            ),
          );
          if (previouslyActiveMarketIds.has(marketId) && retainsParticipantClosure) {
            db.query(
              `UPDATE source_markets
               SET active = 1, retired_at_ms = NULL
               WHERE source_key = $source AND source_market_id = $marketId`,
            ).run({ $source: source, $marketId: marketId });
            const reactivateOutcome = db.query(
              `UPDATE source_market_outcomes
               SET active = 1, retired_at_ms = NULL
               WHERE source_key = $source AND source_market_id = $marketId
                 AND outcome_key = $outcomeKey`,
            );
            for (const outcome of activeOutcomes) {
              reactivateOutcome.run({
                $source: source,
                $marketId: marketId,
                $outcomeKey: outcome.outcomeKey,
              });
            }
          }
        }
        continue;
      }
      marketStatement.run({
        $source: source,
        $marketId: marketId,
        $eventId: eventId,
        $sourceMarketType: market.sourceMarketType ? unbrand(market.sourceMarketType) : null,
        $marketKind: market.marketKind ? unbrand(market.marketKind) : null,
        $title: marketTitle,
        $status: market.status ?? null,
        $closesAtMs: market.closesAtMs ?? null,
        $result: market.result ?? null,
        $sourceUpdatedAtMs: market.sourceUpdatedAtMs ?? null,
        $subjectParticipantId: market.subjectParticipantId
          ? unbrand(market.subjectParticipantId)
          : null,
        $volume: market.volume ?? null,
        $volume24h: market.volume24h ?? null,
        $liquidity: market.liquidity ?? null,
        $clobLiquidity: market.clobLiquidity ?? null,
        $openInterest: market.openInterest ?? null,
        $observedAtMs: observedAtMs,
        $partial: observation.snapshotCompleteness === "partial" ? 1 : 0,
        $hasTitle: hasOwn(market, "title") ? 1 : 0,
        $hasSourceMarketType: hasOwn(market, "sourceMarketType") ? 1 : 0,
        $hasMarketKind: hasOwn(market, "marketKind") ? 1 : 0,
        $hasStatus: hasOwn(market, "status") ? 1 : 0,
        $hasClosesAtMs: hasOwn(market, "closesAtMs") ? 1 : 0,
        $hasResult: hasOwn(market, "result") ? 1 : 0,
        $hasSubjectParticipantId: hasOwn(market, "subjectParticipantId") ? 1 : 0,
        $hasVolume: hasOwn(market, "volume") ? 1 : 0,
        $hasVolume24h: hasOwn(market, "volume24h") ? 1 : 0,
        $hasLiquidity: hasOwn(market, "liquidity") ? 1 : 0,
        $hasClobLiquidity: hasOwn(market, "clobLiquidity") ? 1 : 0,
        $hasOpenInterest: hasOwn(market, "openInterest") ? 1 : 0,
      });
      for (const outcome of market.outcomes ?? []) {
        const outcomeKey = unbrand(outcome.outcome);
        const existingOutcome = db
          .query(
            `SELECT ordinal, label
             FROM source_market_outcomes
             WHERE source_key = $source
               AND source_market_id = $marketId
               AND outcome_key = $outcome`,
          )
          .get({ $source: source, $marketId: marketId, $outcome: outcomeKey }) as
          | ExistingOutcomeRow
          | null;
        const outcomeOrdinal = outcome.ordinal ?? existingOutcome?.ordinal;
        const outcomeLabel = outcome.label ?? existingOutcome?.label;
        if (outcomeOrdinal === undefined || outcomeLabel === undefined) {
          throw new Error("partial outcome insert requires ordinal and label");
        }
        outcomeStatement.run({
          $source: source,
          $marketId: marketId,
          $outcome: outcomeKey,
          $eventId: eventId,
          $participantId: outcome.participantId ? unbrand(outcome.participantId) : null,
          $ordinal: outcomeOrdinal,
          $label: outcomeLabel,
          $probability: outcome.probability ?? null,
          $bid: outcome.bid ?? null,
          $ask: outcome.ask ?? null,
          $last: outcome.last ?? null,
          $lastTradeAtMs: outcome.lastTradeAtMs ?? null,
          $observedAtMs: observedAtMs,
          $partial: observation.snapshotCompleteness === "partial" ? 1 : 0,
          $hasParticipantId: hasOwn(outcome, "participantId") ? 1 : 0,
          $hasOrdinal: hasOwn(outcome, "ordinal") ? 1 : 0,
          $hasLabel: hasOwn(outcome, "label") ? 1 : 0,
          $hasProbability: hasOwn(outcome, "probability") ? 1 : 0,
          $hasBid: hasOwn(outcome, "bid") ? 1 : 0,
          $hasAsk: hasOwn(outcome, "ask") ? 1 : 0,
          $hasLast: hasOwn(outcome, "last") ? 1 : 0,
          $hasLastTradeAtMs: hasOwn(outcome, "lastTradeAtMs") ? 1 : 0,
        });
      }
    }

    return existing ? "updated" : "inserted";
  });
  return write.immediate();
}

function upsertEventSelector(
  db: Database,
  observation: NormalizedSourceObservation,
  observedAtMs: number,
): void {
  db.query(
    `INSERT INTO source_event_selectors (
       source_key, source_event_id, selector_scope, adapter_id, selector_kind,
       selector_parameters_json, active, retired_at_ms, last_seen_run_id,
       first_observed_at_ms, last_observed_at_ms
     ) VALUES (
       $source, $eventId, $selectorScope, $adapter, $selectorKind,
       $selectorParameters, 1, NULL, $inventoryRunId,
       $observedAtMs, $observedAtMs
     )
     ON CONFLICT(source_key, source_event_id, selector_scope) DO UPDATE SET
       adapter_id = excluded.adapter_id,
       selector_kind = excluded.selector_kind,
       selector_parameters_json = excluded.selector_parameters_json,
       active = 1,
       retired_at_ms = NULL,
       last_seen_run_id = COALESCE(
         excluded.last_seen_run_id,
         source_event_selectors.last_seen_run_id
       ),
       first_observed_at_ms = MIN(
         source_event_selectors.first_observed_at_ms,
         excluded.first_observed_at_ms
       ),
       last_observed_at_ms = MAX(
         source_event_selectors.last_observed_at_ms,
         excluded.last_observed_at_ms
       )`,
  ).run({
    $source: unbrand(observation.source),
    $eventId: unbrand(observation.eventId),
    $selectorScope: unbrand(observation.provenance.selector.scope),
    $adapter: unbrand(observation.provenance.adapter),
    $selectorKind: unbrand(observation.provenance.selector.kind),
    $selectorParameters: JSON.stringify(observation.provenance.selector.parameters),
    $inventoryRunId: observation.provenance.inventoryRunId
      ? unbrand(observation.provenance.inventoryRunId)
      : null,
    $observedAtMs: observedAtMs,
  });
}

function assertObservationInput(
  observation: NormalizedSourceObservation,
  registry: SportsSourceRegistry,
): void {
  assertObservationRegistry(observation, registry);
  assertTimestamp(observation.provenance.observedAtMs, "observedAtMs");
  assertOptionalTimestamp(observation.provenance.sourceUpdatedAtMs, "sourceUpdatedAtMs");
  assertOptionalTimestamp(observation.startsAtMs, "startsAtMs");
  assertOptionalTimestamp(observation.closesAtMs, "closesAtMs");
  const participants = observation.participants ?? [];
  const markets = observation.markets ?? [];
  if (observation.snapshotCompleteness === "partial") {
    assertNoExplicitUndefined(
      observation,
      ["title", "status", "closesAtMs", "result", "startsAtMs", "eventType", "participantFormat"],
      "partial event",
    );
  }
  assertUniqueValues(
    participants.map((participant) => unbrand(participant.id)),
    "participant id",
  );
  const participantIds = new Set(
    participants.map((participant) => unbrand(participant.id)),
  );
  assertUniqueOrdinals(
    participants.map((participant) => participant.ordinal),
    "participant",
  );
  assertUniqueValues(
    markets.map((market) => unbrand(market.id)),
    "market id",
  );
  for (const market of markets) {
    const label = `outcome ${unbrand(market.id)}`;
    if (observation.snapshotCompleteness === "partial") {
      assertNoExplicitUndefined(
        market,
        [
          "sourceMarketType", "marketKind", "title", "status", "closesAtMs", "result",
          "sourceUpdatedAtMs", "subjectParticipantId", "volume", "volume24h", "liquidity",
          "clobLiquidity", "openInterest", "outcomes",
        ],
        `partial market ${unbrand(market.id)}`,
      );
    }
    const outcomes = market.outcomes ?? [];
    assertUniqueValues(
      outcomes.map((outcome) => unbrand(outcome.outcome)),
      `${label} key`,
    );
    assertUniqueOrdinals(
      outcomes.flatMap((outcome) => outcome.ordinal === undefined ? [] : [outcome.ordinal]),
      label,
    );
    for (const [field, value] of [
      ["volume", market.volume],
      ["volume24h", market.volume24h],
      ["liquidity", market.liquidity],
      ["clobLiquidity", market.clobLiquidity],
      ["openInterest", market.openInterest],
    ] as const) {
      assertOptionalFinite(value, `${label} ${field}`);
    }
    assertOptionalTimestamp(market.closesAtMs, `${label} closesAtMs`);
    assertOptionalTimestamp(market.sourceUpdatedAtMs, `${label} sourceUpdatedAtMs`);
    if (
      observation.snapshotCompleteness === "complete" &&
      market.subjectParticipantId &&
      !participantIds.has(unbrand(market.subjectParticipantId))
    ) {
      throw new Error(`${label} subject participant is absent from complete snapshot`);
    }
    for (const outcome of outcomes) {
      if (observation.snapshotCompleteness === "partial") {
        assertNoExplicitUndefined(
          outcome,
          ["ordinal", "label", "participantId", "probability", "bid", "ask", "last", "lastTradeAtMs"],
          `partial ${label}`,
        );
      }
      for (const [field, value] of [
        ["probability", outcome.probability],
        ["bid", outcome.bid],
        ["ask", outcome.ask],
        ["last", outcome.last],
      ] as const) {
        assertOptionalFinite(value, `${label} ${field}`);
      }
      assertOptionalTimestamp(outcome.lastTradeAtMs, `${label} lastTradeAtMs`);
      if (
        observation.snapshotCompleteness === "complete" &&
        outcome.participantId &&
        !participantIds.has(unbrand(outcome.participantId))
      ) {
        throw new Error(`${label} participant is absent from complete snapshot`);
      }
    }
  }
}

function isOlderSourceVersion(
  incomingSourceUpdatedAtMs: number | undefined,
  existingSourceUpdatedAtMs: number | null,
  incomingObservedAtMs: number,
  existingObservedAtMs: number,
): boolean {
  if (existingSourceUpdatedAtMs !== null && incomingSourceUpdatedAtMs !== undefined) {
    return (
      incomingSourceUpdatedAtMs < existingSourceUpdatedAtMs ||
      (incomingSourceUpdatedAtMs === existingSourceUpdatedAtMs &&
        incomingObservedAtMs <= existingObservedAtMs)
    );
  }
  return incomingObservedAtMs <= existingObservedAtMs;
}

function assertObservationRegistry(
  observation: NormalizedSourceObservation,
  registry: SportsSourceRegistry,
): void {
  const selector = observation.provenance.selector;
  if (selector.sport !== observation.sport) {
    throw new Error("selector sport must match observation sport");
  }
  if (!unbrand(selector.scope).startsWith(`${unbrand(observation.source)}:`)) {
    throw new Error("selector scope must match observation source");
  }
  const registration = registrationFor(observation.source, observation.sport, registry);
  if (!registration) throw new Error("source/sport integration is not registered");
  if (registration.adapter !== observation.provenance.adapter) {
    throw new Error("adapter must match registered source/sport integration");
  }
  const adapter = registry.adapters.find(
    (candidate) => candidate.id === observation.provenance.adapter,
  );
  if (!adapter || adapter.source !== observation.source) {
    throw new Error("adapter must belong to observation source");
  }
  if (adapter.idNamespace !== "source_global") {
    throw new Error("source market store requires source-global provider ids");
  }
  if (!adapter.selectorKinds.includes(selector.kind)) {
    throw new Error("selector kind is not supported by adapter");
  }
  const errors = adapter.validateSelector(selector);
  if (errors.length > 0) throw new Error(`invalid source selector: ${errors.join(", ")}`);
  const binding = registration.competitions.find(
    (candidate) => candidate.selector.scope === selector.scope,
  );
  if (!binding) throw new Error("selector scope is not registered for source/sport integration");
  if (
    binding.selector.kind !== selector.kind ||
    binding.selector.sport !== selector.sport ||
    !recordsEqual(binding.selector.parameters, selector.parameters)
  ) {
    throw new Error("selector must exactly match the registered binding");
  }
  for (const market of observation.markets ?? []) {
    if (binding.sourceMarketMappings.length === 0) {
      if (market.marketKind && !binding.marketKinds.includes(market.marketKind)) {
        throw new Error("market kind is not registered for selector");
      }
      continue;
    }
    const mapping = market.sourceMarketType
      ? binding.sourceMarketMappings.find(
          (candidate) => candidate.sourceMarketType === market.sourceMarketType,
        )
      : undefined;
    if (mapping) {
      if (market.marketKind !== mapping.marketKind) {
        throw new Error("source market type must use its registered market kind");
      }
      continue;
    }
    if (binding.unmappedMarketPolicy === "reject" && market.sourceMarketType) {
      throw new Error("source market type is not registered for selector");
    }
    if (market.marketKind) {
      throw new Error("unmapped source market type must remain quarantined");
    }
  }
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

function assertUniqueValues(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertOptionalTimestamp(value: number | null | undefined, label: string): void {
  if (value !== undefined && value !== null) assertTimestamp(value, label);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertOptionalFinite(value: number | null | undefined, label: string): void {
  if (value !== null && value !== undefined && !Number.isFinite(value)) {
    throw new Error(`${label} must be finite or null`);
  }
}

function assertNoExplicitUndefined(
  value: object,
  keys: readonly string[],
  label: string,
): void {
  for (const key of keys) {
    if (hasOwn(value, key) && value[key as keyof typeof value] === undefined) {
      throw new Error(`${label} ${key} cannot be explicitly undefined`);
    }
  }
}

function assertUniqueOrdinals(ordinals: readonly number[], label: string): void {
  const seen = new Set<number>();
  for (const ordinal of ordinals) {
    if (!Number.isInteger(ordinal) || ordinal < 0) {
      throw new Error(`${label} ordinal must be a non-negative integer`);
    }
    if (seen.has(ordinal)) throw new Error(`duplicate ${label} ordinal: ${ordinal}`);
    seen.add(ordinal);
  }
}

/** Keyset page over one provider/sport inventory scope. */
export function listSourceEvents(
  db: Database,
  query: SourceEventInventoryQuery,
): SourceEventInventoryRow[] {
  const requestedLimit = query.limit ?? 100;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
    throw new Error("Source inventory limit must be a positive safe integer");
  }
  const limit = Math.min(500, requestedLimit);
  const baseSql =
    `SELECT source_key, source_event_id, sport_key, title, starts_at_ms, last_observed_at_ms
     FROM source_events
     WHERE source_key = $source AND sport_key = $sport${
       query.includeRetired
         ? ""
         : ` AND EXISTS (
             SELECT 1 FROM source_event_selectors ses
             WHERE ses.source_key = source_events.source_key
               AND ses.source_event_id = source_events.source_event_id
               AND ses.active = 1
           )`
     }`;
  const params = {
    $source: unbrand(query.source),
    $sport: unbrand(query.sport),
    $limit: limit,
  };
  const rows = query.afterEventId
    ? (db
        .query(
          `${baseSql}
           AND source_event_id > $afterEventId
           ORDER BY source_event_id ASC
           LIMIT $limit`,
        )
        .all({ ...params, $afterEventId: unbrand(query.afterEventId) }) as SourceEventWireRow[])
    : (db
        .query(
          `${baseSql}
           ORDER BY source_event_id ASC
           LIMIT $limit`,
        )
        .all(params) as SourceEventWireRow[]);
  return rows.map((row) => ({
    source: asSourceKey(row.source_key),
    eventId: asSourceEventId(row.source_event_id),
    sport: asSportKey(row.sport_key),
    title: row.title,
    startsAtMs: row.starts_at_ms,
    lastObservedAtMs: row.last_observed_at_ms,
  }));
}
