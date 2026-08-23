/**
 * In-memory Pandora eventCoefficients book.
 * Full snapshots replace; diffs patch the last snapshot then re-extract lines.
 */
import type { PartnerLimits, PartnerMarket, SurfaceAdapterId } from '../types.ts';
import {
  applyCoefficientDiff,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  type CoefficientEnvelope,
  type CoefficientLine,
} from './coefficients.ts';

export type CoefficientIngest = {
  room: string;
  eventId: number | null;
  envelope: CoefficientEnvelope;
  lines: CoefficientLine[];
};

type EventBook = {
  snapshot: Record<string, unknown> | null;
  lines: CoefficientLine[];
  updatedAt: number;
};

const DEFAULT_LIMITS: PartnerLimits = {
  maxStake: 0,
  maxWin: 0,
  currency: 'USD',
  note: 'fantasy402: limits not mapped',
};

export class CoefficientStore {
  private readonly byEvent = new Map<number, EventBook>();

  /**
   * Compact print: console.log / Bun.inspect shows coverage, not the full
   * event-book dump.
   * @see https://bun.com/docs/runtime/utils#bun-inspect-custom
   */
  [Bun.inspect.custom](_depth: number, _options: unknown, _inspect: typeof Bun.inspect): string {
    return `CoefficientStore(${this.byEvent.size} event${this.byEvent.size === 1 ? "" : "s"})`;
  }

  clear(): void {
    this.byEvent.clear();
  }

  ingest(info: CoefficientIngest): CoefficientLine[] {
    const id =
      info.eventId ?? eventIdFromCoefficientRoom(info.room);
    if (id == null) return [];

    if (info.envelope.isDiff) {
      const cur = this.byEvent.get(id);
      if (!cur?.snapshot) return [];
      const ops = Array.isArray(info.envelope.payload)
        ? info.envelope.payload
        : [];
      const next = applyCoefficientDiff(cur.snapshot, ops);
      const lines = extractCoefficientLines(id, next);
      this.byEvent.set(id, {
        snapshot: next,
        lines,
        updatedAt: Date.now(),
      });
      return lines;
    }

    const payload = info.envelope.payload;
    const snapshot =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const lines =
      info.lines.length > 0
        ? info.lines
        : extractCoefficientLines(id, payload);
    this.byEvent.set(id, {
      snapshot,
      lines,
      updatedAt: Date.now(),
    });
    return lines;
  }

  getLines(eventId: number): CoefficientLine[] {
    return this.byEvent.get(eventId)?.lines ?? [];
  }

  listPricedEventIds(): number[] {
    return [...this.byEvent.entries()]
      .filter(([, b]) => b.lines.length > 0)
      .map(([id]) => id)
      .sort((a, b) => a - b);
  }

  pricedEventCount(): number {
    return this.listPricedEventIds().length;
  }

  lineCount(): number {
    let n = 0;
    for (const b of this.byEvent.values()) n += b.lines.length;
    return n;
  }

  /**
   * Match moneyline (`marketType` 3, period `m`) → PartnerMarket rows.
   */
  toPartnerMarkets(
    partner: SurfaceAdapterId = 'fantasy402',
    limits: PartnerLimits = DEFAULT_LIMITS,
  ): PartnerMarket[] {
    const out: PartnerMarket[] = [];
    for (const eventId of this.listPricedEventIds()) {
      const lines = this.getLines(eventId);
      const ml = lines.filter(
        (l) => l.period === 'm' && l.marketType === '3',
      );
      if (ml.length === 0) continue;
      const home = ml.find((l) => l.selection === '1');
      const away = ml.find((l) => l.selection === '2');
      out.push({
        partner,
        ticker: `f402:${eventId}:m:3`,
        name: `Fantasy402 event ${eventId} ML`,
        oddsEventId: String(eventId),
        marketId: `${eventId}:m:3`,
        homePrice: home?.american ?? null,
        awayPrice: away?.american ?? null,
        label: 'moneyline',
        limits,
        source: 'pandora.eventCoefficients',
      });
    }
    return out;
  }

  marketsForEvent(
    eventId: number | string,
    partner: SurfaceAdapterId = 'fantasy402',
    limits: PartnerLimits = DEFAULT_LIMITS,
  ): PartnerMarket[] {
    const id = typeof eventId === 'string' ? Number(eventId) : eventId;
    if (!Number.isFinite(id)) return [];
    return this.toPartnerMarkets(partner, limits).filter(
      (m) => m.oddsEventId === String(id),
    );
  }
}

/** Process-wide store for sync/probe when not using an adapter instance. */
export const sharedCoefficientStore = new CoefficientStore();
