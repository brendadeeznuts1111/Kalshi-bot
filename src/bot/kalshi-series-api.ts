import { asSeriesTicker, unbrand, type SeriesTicker } from "../institutions/event-store/brands.ts";
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
import { fetchWithRetry, type RetryOptions } from "../institutions/resilient-fetch.ts";

export type KalshiSettlementSource = { name: string | null; url: string | null };

export type KalshiSeriesMetadata = {
  ticker: SeriesTicker;
  title: string;
  category: string;
  frequency: string;
  tags: readonly string[];
  contractUrl: string;
  contractTermsUrl: string;
  feeType: "flat" | "quadratic" | "quadratic_with_maker_fees";
  feeMultiplier: number;
  additionalProhibitions: readonly string[];
  settlementSources: readonly KalshiSettlementSource[];
  sourceUpdatedAtMs?: number;
};

export type FetchKalshiSeriesOptions = Omit<RetryOptions, "fetchImpl"> & {
  category: string;
  includeProductMetadata: boolean;
  baseUrl?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

export async function fetchKalshiSeriesWire(options: FetchKalshiSeriesOptions): Promise<unknown> {
  const base = (
    options.baseUrl ?? Bun.env.KALSHI_API_BASE?.trim() ?? OFFICIAL_URLS.kalshi.tradeApiV2Base
  ).replace(/\/$/, "");
  const {
    category: _,
    includeProductMetadata: __,
    baseUrl: ___,
    fetchImpl = fetch,
    ...retryOptions
  } = options;
  const params = new URLSearchParams({
    category: options.category,
    include_product_metadata: String(options.includeProductMetadata),
  });
  const response = await fetchWithRetry(
    `${base}/series?${params}`,
    { headers: { Accept: "application/json" } },
    { ...retryOptions, fetchImpl },
  );
  if (!response.ok) throw new Error(`Kalshi series: ${response.status} ${response.statusText}`);
  return response.json() as Promise<unknown>;
}

/** Strict all-or-nothing boundary for the unpaginated Kalshi series snapshot. */
export function parseKalshiSeriesWire(raw: unknown): KalshiSeriesMetadata[] {
  if (!isRecord(raw) || !Array.isArray(raw.series)) {
    throw new Error("Kalshi series snapshot: series array required");
  }
  if (raw.series.length === 0) {
    throw new Error("Kalshi series snapshot: must not be empty");
  }
  const seen = new Set<string>();
  return raw.series.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Kalshi series[${index}]: object required`);
    const ticker = requiredString(value.ticker, `series[${index}].ticker`);
    if (seen.has(ticker)) throw new Error(`Kalshi series snapshot: duplicate ticker ${ticker}`);
    seen.add(ticker);
    const tags = nullableStringArray(value.tags, `series[${index}].tags`);
    assertUnique(tags, `series[${index}].tags`);
    const additionalProhibitions = nullableStringArray(
      value.additional_prohibitions,
      `series[${index}].additional_prohibitions`,
    );
    assertUnique(additionalProhibitions, `series[${index}].additional_prohibitions`);
    const feeType = requiredString(value.fee_type, `series[${index}].fee_type`);
    if (
      feeType !== "flat" &&
      feeType !== "quadratic" &&
      feeType !== "quadratic_with_maker_fees"
    ) {
      throw new Error(`Kalshi series[${index}].fee_type unsupported: ${feeType}`);
    }
    const feeMultiplier = finiteNonnegative(value.fee_multiplier, `series[${index}].fee_multiplier`);
    const sourceUpdatedAtMs = optionalTimestamp(value.last_updated_ts, `series[${index}].last_updated_ts`);
    return {
      ticker: asSeriesTicker(ticker),
      title: requiredString(value.title, `series[${index}].title`),
      category: requiredString(value.category, `series[${index}].category`),
      frequency: requiredString(value.frequency, `series[${index}].frequency`),
      tags,
      contractUrl: httpUrl(value.contract_url, `series[${index}].contract_url`),
      contractTermsUrl: httpUrl(value.contract_terms_url, `series[${index}].contract_terms_url`),
      feeType,
      feeMultiplier,
      additionalProhibitions,
      settlementSources: settlementSources(value.settlement_sources, index),
      ...(sourceUpdatedAtMs === undefined ? {} : { sourceUpdatedAtMs }),
    } satisfies KalshiSeriesMetadata;
  });
}

function settlementSources(raw: unknown, seriesIndex: number): KalshiSettlementSource[] {
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`Kalshi series[${seriesIndex}].settlement_sources: array or null required`);
  }
  return raw.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Kalshi series[${seriesIndex}].settlement_sources[${index}]: object required`);
    }
    const name = nullableSettlementName(
      value.name,
      `series[${seriesIndex}].settlement_sources[${index}].name`,
    );
    return {
      name,
      url: nullableHttpUrl(
        value.url,
        `series[${seriesIndex}].settlement_sources[${index}].url`,
      ),
    };
  });
}

function nullableSettlementName(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return null;
  return requiredString(raw, label);
}

function nullableStringArray(raw: unknown, label: string): string[] {
  if (raw === null) return [];
  return stringArray(raw, label);
}

function stringArray(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw)) throw new Error(`Kalshi ${label}: array required`);
  return raw.map((value, index) => requiredString(value, `${label}[${index}]`));
}

function requiredString(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`Kalshi ${label}: string required`);
  return raw.trim();
}

function finiteNonnegative(raw: unknown, label: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`Kalshi ${label}: non-negative number required`);
  }
  return raw;
}

function optionalTimestamp(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Error(`Kalshi ${label}: timestamp string required`);
  const value = Date.parse(raw);
  if (!Number.isFinite(value)) throw new Error(`Kalshi ${label}: valid timestamp required`);
  return value;
}

function httpUrl(raw: unknown, label: string): string {
  const value = requiredString(raw, label);
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Kalshi ${label}: HTTP(S) URL required`);
  }
  return url.toString();
}

function nullableHttpUrl(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  return httpUrl(raw, label);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Kalshi ${label}: duplicate value`);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

export function kalshiSeriesTicker(row: KalshiSeriesMetadata): string {
  return unbrand(row.ticker);
}
