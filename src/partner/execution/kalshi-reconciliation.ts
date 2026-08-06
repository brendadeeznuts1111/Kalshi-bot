import type {
  KalshiEnvironment,
  KalshiOrderLookupRecord,
  KalshiOrderLookupResult,
  KalshiOrderSide,
} from "../../bot/kalshi-client.ts";

export interface KalshiExpectedOrder {
  environment: KalshiEnvironment;
  /** Local execution account authority used to resolve the signed client. */
  outId: string;
  ticker: string;
  clientOrderId: string;
  outcome: KalshiOrderSide;
  bookSide: "bid" | "ask";
  count: number;
  /** Kalshi's canonical single-book YES price. */
  yesPriceCents: number;
}

export type KalshiOrderEvidence =
  | { kind: "confirmed"; source: "active" | "historical"; order: KalshiOrderLookupRecord }
  | { kind: "not_found"; pagesScanned: number }
  | { kind: "incomplete"; source: "active" | "historical"; pagesScanned: number }
  | { kind: "malformed"; source: "active" | "historical"; reason: string }
  | { kind: "provider_error"; source: "active" | "historical"; reason: string }
  | {
      kind: "conflict";
      source: "active" | "historical";
      mismatches: Array<"environment" | "account" | "ticker" | "client_order_id" | "outcome" | "book_side" | "count" | "price">;
    };

/** Bind provider evidence to every immutable term sent during placement. */
export function verifyKalshiOrderEvidence(
  expected: KalshiExpectedOrder,
  actualEnvironment: KalshiEnvironment,
  actualOutId: string,
  lookup: KalshiOrderLookupResult,
): KalshiOrderEvidence {
  if (lookup.kind !== "found") return lookup;
  const mismatches: Extract<KalshiOrderEvidence, { kind: "conflict" }>["mismatches"] = [];
  if (actualEnvironment !== expected.environment) mismatches.push("environment");
  if (actualOutId !== expected.outId) mismatches.push("account");
  if (lookup.order.ticker !== expected.ticker) mismatches.push("ticker");
  if (lookup.order.clientOrderId !== expected.clientOrderId) mismatches.push("client_order_id");
  if (lookup.order.outcome !== expected.outcome) mismatches.push("outcome");
  if (lookup.order.bookSide !== expected.bookSide) mismatches.push("book_side");
  if (lookup.order.initialCount !== expected.count) mismatches.push("count");
  if (lookup.order.yesPriceCents !== expected.yesPriceCents) mismatches.push("price");
  return mismatches.length > 0
    ? { kind: "conflict", source: lookup.source, mismatches }
    : { kind: "confirmed", source: lookup.source, order: lookup.order };
}
