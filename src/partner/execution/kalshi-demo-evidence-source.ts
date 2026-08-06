import type { KalshiClient } from "../../bot/kalshi-client.ts";
import { loadKalshiLifecycleBatch } from "./kalshi-lifecycle-loader.ts";
import type { DemoProviderEvidenceSource } from "./demo-evidence-collector.ts";
import type { ExposureReservationId } from "./domain.ts";

export function createKalshiDemoEvidenceSource(
  client: Pick<KalshiClient, "environment" | "getLifecyclePage" | "getBalance" | "getPositionsPage">,
  options: {
    outId: string;
    reservationForClientOrderId?: (clientOrderId: string) => ExposureReservationId | null;
    now?: () => number;
  },
): DemoProviderEvidenceSource {
  return {
    capture: async () => {
      if (client.environment !== "demo") throw new Error("Demo evidence source refuses production Kalshi client");
      const capturedAtMs = options.now?.() ?? Date.now();
      const [lifecycle, balance, positionWire] = await Promise.all([
        loadKalshiLifecycleBatch(client, {
          outId: options.outId,
          observedAtMs: capturedAtMs,
          reservationForClientOrderId: options.reservationForClientOrderId,
        }),
        client.getBalance(),
        loadAllPositionPages(client),
      ]);
      if (!lifecycle.ok) throw new Error(`Kalshi lifecycle capture failed closed: ${lifecycle.kind}`);
      if (balance.balanceCents === null) throw new Error("Kalshi demo balance is unavailable");
      return {
        environment: "demo",
        capturedAtMs,
        lifecycle: lifecycle.batch,
        balanceCents: balance.balanceCents,
        positions: positionWire.map(normalizePosition),
      };
    },
  };
}

async function loadAllPositionPages(
  client: Pick<KalshiClient, "getPositionsPage">,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const result = await client.getPositionsPage(cursor, 1_000);
    rows.push(...result.items);
    cursor = result.cursor;
    if (!cursor) return rows;
  }
  throw new Error("Kalshi position capture remained incomplete after bounded cursor pagination");
}

function normalizePosition(wire: Record<string, unknown>): { ticker: string; position: number } {
  const ticker = wire.ticker ?? wire.market_ticker;
  const raw = wire.position_fp ?? wire.position;
  if (typeof ticker !== "string" || !ticker.trim()) throw new Error("Kalshi position ticker is malformed");
  const position = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(position)) throw new Error("Kalshi position quantity is malformed");
  return { ticker: ticker.trim(), position };
}
