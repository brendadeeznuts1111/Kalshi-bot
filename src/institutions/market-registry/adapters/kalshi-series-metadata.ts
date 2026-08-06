import {
  fetchKalshiSeriesWire,
  parseKalshiSeriesWire,
  type FetchKalshiSeriesOptions,
  type KalshiSeriesMetadata,
} from "../../../bot/kalshi-series-api.ts";
import { unbrand as unbrandEventStore } from "../../event-store/brands.ts";
import {
  asSourceMetadataId,
  ADAPTER,
  SELECTOR,
  SOURCE,
} from "../brands.ts";
import { ADAPTERS } from "../registry.ts";
import type {
  AdapterDefinition,
  MetadataFetchRequest,
  MetadataPage,
  MetadataSourceAdapter,
  NormalizedSourceMetadata,
} from "../types.ts";
import { SourceAdapterHealthState } from "./health.ts";

type MetadataEnvelope = { payload: unknown; observedAtMs: number };

export type KalshiSeriesMetadataAdapterOptions = Omit<
  FetchKalshiSeriesOptions,
  "category" | "includeProductMetadata"
> & {
  now?: () => number;
};

export function createKalshiSeriesMetadataAdapter(
  options: KalshiSeriesMetadataAdapterOptions = {},
): MetadataSourceAdapter<KalshiSeriesMetadata> {
  const definition = metadataDefinition();
  const now = options.now ?? Date.now;
  const policy = definition.metadataCachePolicy!;
  const health = new SourceAdapterHealthState("Kalshi metadata", definition, now, policy);
  return {
    definition,
    async fetchPage(request) {
      health.beforeRequest();
      assertRequest(request, definition);
      try {
        const { now: _, ...fetchOptions } = options;
        const payload = await fetchKalshiSeriesWire({
          ...fetchOptions,
          category: request.selector.parameters.category!,
          includeProductMetadata:
            request.selector.parameters.includeProductMetadata === "true",
        });
        return { payload, observedAtMs: health.observedAtMs() } satisfies MetadataEnvelope;
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    parsePage(wire, request) {
      try {
        assertRequest(request, definition);
        const envelope = parseEnvelope(wire, "Kalshi metadata");
        return {
          request,
          observedAtMs: envelope.observedAtMs,
          records: parseKalshiSeriesWire(envelope.payload),
          completeness: "complete",
          exhausted: true,
        };
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    project(page) {
      try {
        assertRequest(page.request, definition);
        const records = page.records.map(projectSeries);
        health.succeed(page.observedAtMs);
        return records;
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    health: () => health.read(),
  };
}

function projectSeries(row: KalshiSeriesMetadata): NormalizedSourceMetadata {
  return {
    source: SOURCE.kalshi,
    metadataId: asSourceMetadataId(unbrandEventStore(row.ticker)),
    metadataKind: SELECTOR.kalshiSeriesMetadata,
    label: row.title,
    attributes: {
      category: row.category,
      frequency: row.frequency,
      fee_type: row.feeType,
      fee_multiplier: String(row.feeMultiplier),
      contract_url: row.contractUrl,
      contract_terms_url: row.contractTermsUrl,
    },
    facets: {
      tags: row.tags,
      additional_prohibitions: unique(row.additionalProhibitions),
      settlement_source_urls: unique(
        row.settlementSources.flatMap((source) => source.url === null ? [] : [source.url]),
      ),
    },
    ...(row.sourceUpdatedAtMs === undefined
      ? {}
      : { sourceUpdatedAtMs: row.sourceUpdatedAtMs }),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertRequest(request: MetadataFetchRequest, definition: AdapterDefinition): void {
  const expected = definition.metadataDiscovery;
  if (!expected) throw new Error("Kalshi metadata discovery is not configured");
  if (
    request.pageIndex !== 0 ||
    request.cursor !== undefined ||
    request.selector.kind !== expected.kind ||
    request.selector.scope !== expected.scope ||
    request.selector.sport !== expected.sport ||
    !recordsEqual(request.selector.parameters, expected.parameters)
  ) {
    throw new Error("Kalshi metadata request must match the atomic discovery selector");
  }
}

function metadataDefinition(): AdapterDefinition {
  const definition = ADAPTERS.find((row) => row.id === ADAPTER.kalshiEvents);
  if (!definition?.metadataDiscovery || !definition.metadataCachePolicy) {
    throw new Error("Kalshi metadata adapter definition missing");
  }
  return definition;
}

function parseEnvelope(raw: unknown, label: string): MetadataEnvelope {
  if (
    !isRecord(raw) ||
    !("payload" in raw) ||
    typeof raw.observedAtMs !== "number" ||
    !Number.isSafeInteger(raw.observedAtMs) ||
    raw.observedAtMs < 0
  ) {
    throw new Error(`${label} envelope is invalid`);
  }
  return { payload: raw.payload, observedAtMs: raw.observedAtMs };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}
