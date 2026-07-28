/**
 * MarketDataAgent — Polymarket ingestion, tick storage, and line-move detection.
 *
 * Polls Gamma API, writes to polymarket_ticks / polymarket_line_moves,
 * and emits LINE_MOVE_EVAL tasks for the compliance agent when steam is detected.
 */

import { Database } from "bun:sqlite";
import { AGENT_ROLE, TABLE, POLYMARKET, SQL_UNIXEPOCH } from "../constants";
import type { Agent, AgentContext, AgentResult, AgentTask } from "./orchestrator.ts";
import {
  fetchPolymarketMarkets,
  marketToTick,
  PolymarketLineTracker,
  type PolymarketClientOptions,
  type PolymarketLineMove,
  type PolymarketMarket,
  type PolymarketTick,
} from "../integrations/polymarket.ts";

export class MarketDataAgent implements Agent {
  readonly role = AGENT_ROLE.MARKET_DATA;
  private tracker: PolymarketLineTracker;
  private fetchOptions: PolymarketClientOptions;

  constructor(
    private db: Database,
    options?: {
      tracker?: PolymarketLineTracker;
      fetchOptions?: PolymarketClientOptions;
    },
  ) {
    this.tracker = options?.tracker ?? new PolymarketLineTracker();
    this.fetchOptions = options?.fetchOptions ?? {};
  }

  async run(task: AgentTask, _ctx: AgentContext): Promise<AgentResult> {
    const start = performance.now();

    switch (task.type) {
      case "MARKET_INGEST": {
        const p = task.payload;
        const result = await this.ingest(p.slugs, p.fetchLimit);
        return {
          role: this.role,
          ok: true,
          data: result,
          latencyMs: Math.round(performance.now() - start),
        };
      }

      default:
        return {
          role: this.role,
          ok: false,
          error: `Unsupported task type: ${task.type}`,
          latencyMs: Math.round(performance.now() - start),
        };
    }
  }

  // ── Core ingestion pipeline ──

  async ingest(
    slugs?: string[],
    fetchLimit?: number,
  ): Promise<{
    marketsFetched: number;
    ticksStored: number;
    lineMovesDetected: number;
    lineMoves: PolymarketLineMove[];
    errors: string[];
  }> {
    const errors: string[] = [];
    let markets: PolymarketMarket[] = [];

    try {
      if (slugs && slugs.length > 0) {
        // Fetch individual markets by slug — Gamma API doesn't have a slug lookup,
        // so we fetch the list and filter client-side.
        const all = await fetchPolymarketMarkets({
          limit: 200,
          active: true,
          ...this.fetchOptions,
        });
        const set = new Set(slugs);
        markets = all.filter((m) => set.has(m.slug));
      } else {
        markets = await fetchPolymarketMarkets({
          limit: fetchLimit ?? POLYMARKET.DEFAULT_FETCH_LIMIT,
          active: true,
          ...this.fetchOptions,
        });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return { marketsFetched: 0, ticksStored: 0, lineMovesDetected: 0, lineMoves: [], errors };
    }

    let ticksStored = 0;
    const lineMoves: PolymarketLineMove[] = [];

    for (const market of markets) {
      try {
        this.upsertMarket(market);
        const tick = marketToTick(market);
        this.storeTick(tick);
        ticksStored++;

        const moves = this.tracker.ingest(tick);
        for (const move of moves) {
          this.storeLineMove(move);
          lineMoves.push(move);
        }
      } catch (err) {
        errors.push(`[${market.slug}] ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      marketsFetched: markets.length,
      ticksStored,
      lineMovesDetected: lineMoves.length,
      lineMoves,
      errors,
    };
  }

  // ── DB persistence ──

  private upsertMarket(market: PolymarketMarket): void {
    this.db.run(
      `INSERT INTO ${TABLE.POLYMARKET_MARKETS}
       (slug, question, description, condition_id, resolution_source, outcomes,
        outcome_prices, volume, volume_24hr, liquidity, active, closed, end_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH})
       ON CONFLICT(slug) DO UPDATE SET
         question = excluded.question,
         description = excluded.description,
         resolution_source = excluded.resolution_source,
         outcomes = excluded.outcomes,
         outcome_prices = excluded.outcome_prices,
         volume = excluded.volume,
         volume_24hr = excluded.volume_24hr,
         liquidity = excluded.liquidity,
         active = excluded.active,
         closed = excluded.closed,
         end_date = excluded.end_date,
         updated_at = ${SQL_UNIXEPOCH}`,
      [
        market.slug,
        market.question,
        market.description ?? null,
        market.conditionId,
        market.resolutionSource ?? null,
        JSON.stringify(market.outcomes),
        JSON.stringify(market.outcomePrices),
        market.volume,
        market.volume24hr,
        market.liquidityClob ?? market.liquidity,
        market.active ? 1 : 0,
        market.closed ? 1 : 0,
        market.endDate ?? null,
      ],
    );
  }

  private storeTick(tick: PolymarketTick): void {
    this.db.run(
      `INSERT INTO ${TABLE.POLYMARKET_TICKS}
       (slug, yes_price, no_price, best_bid, best_ask, spread, volume_24hr, volume_total, liquidity, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tick.slug,
        tick.yesPrice,
        tick.noPrice,
        tick.bestBid,
        tick.bestAsk,
        tick.spread,
        tick.volume24hr,
        tick.volumeTotal,
        tick.liquidity,
        tick.timestamp,
      ],
    );
  }

  private storeLineMove(move: PolymarketLineMove): void {
    this.db.run(
      `INSERT INTO ${TABLE.POLYMARKET_LINE_MOVES}
       (slug, direction, old_price, new_price, delta_bp, delta_abs, volume_at_move, detected_at, window_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        move.slug,
        move.direction,
        move.oldPrice,
        move.newPrice,
        move.deltaBp,
        move.deltaAbs,
        move.volumeAtMove,
        move.detectedAt,
        move.windowSeconds,
      ],
    );
  }

  // ── Utilities ──

  /** Latest stored tick per slug. */
  latestTicks(limit = 20): PolymarketTick[] {
    const rows = this.db
      .query<
        {
          slug: string;
          yes_price: number;
          no_price: number;
          best_bid: number;
          best_ask: number;
          spread: number;
          volume_24hr: number;
          volume_total: number;
          liquidity: number;
          timestamp: number;
        },
        []
      >(
        `SELECT slug, yes_price, no_price, best_bid, best_ask, spread,
                volume_24hr, volume_total, liquidity, timestamp
         FROM ${TABLE.POLYMARKET_TICKS}
         WHERE (slug, timestamp) IN (
           SELECT slug, MAX(timestamp) FROM ${TABLE.POLYMARKET_TICKS} GROUP BY slug
         )
         ORDER BY timestamp DESC
         LIMIT ${limit}`,
      )
      .all();

    return rows.map((r) => ({
      slug: r.slug,
      yesPrice: r.yes_price,
      noPrice: r.no_price,
      bestBid: r.best_bid,
      bestAsk: r.best_ask,
      spread: r.spread,
      volume24hr: r.volume_24hr,
      volumeTotal: r.volume_total,
      liquidity: r.liquidity,
      timestamp: r.timestamp,
    }));
  }

  /** Recent line moves from the DB. */
  recentLineMoves(limit = 20): PolymarketLineMove[] {
    const rows = this.db
      .query<
        {
          slug: string;
          direction: string;
          old_price: number;
          new_price: number;
          delta_bp: number;
          delta_abs: number;
          volume_at_move: number;
          detected_at: number;
          window_seconds: number;
        },
        []
      >(
        `SELECT slug, direction, old_price, new_price, delta_bp, delta_abs,
                volume_at_move, detected_at, window_seconds
         FROM ${TABLE.POLYMARKET_LINE_MOVES}
         ORDER BY detected_at DESC
         LIMIT ${limit}`,
      )
      .all();

    return rows.map((r) => ({
      slug: r.slug,
      direction: r.direction as "up" | "down" | "flat",
      oldPrice: r.old_price,
      newPrice: r.new_price,
      deltaBp: r.delta_bp,
      deltaAbs: r.delta_abs,
      volumeAtMove: r.volume_at_move,
      detectedAt: r.detected_at,
      windowSeconds: r.window_seconds,
    }));
  }
}
