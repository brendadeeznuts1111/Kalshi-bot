import { OFFICIAL_URLS } from "../../official-urls.ts";
import { fetchWithRetry, type RetryOptions } from "../../resilient-fetch.ts";
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

export type PolymarketSportMetadata = {
  sportCode: string;
  imageUrl: string;
  resolutionUrl: string;
  ordering: string;
  tagIds: readonly string[];
  seriesId: string;
  rowId?: number;
  createdAtMs?: number;
};

export type PolymarketSportsMetadataAdapterOptions = Omit<RetryOptions, "fetchImpl"> & {
  baseUrl?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now?: () => number;
};

export function createPolymarketSportsMetadataAdapter(
  options: PolymarketSportsMetadataAdapterOptions = {},
): MetadataSourceAdapter<PolymarketSportMetadata> {
  const definition = metadataDefinition();
  const now = options.now ?? Date.now;
  const health = new SourceAdapterHealthState(
    "Polymarket metadata",
    definition,
    now,
    definition.metadataCachePolicy!,
  );
  return {
    definition,
    async fetchPage(request) {
      health.beforeRequest();
      assertRequest(request, definition);
      try {
        const payload = await fetchPolymarketSportsWire(options);
        return { payload, observedAtMs: health.observedAtMs() } satisfies MetadataEnvelope;
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    parsePage(wire, request) {
      try {
        assertRequest(request, definition);
        const envelope = parseEnvelope(wire);
        return {
          request,
          observedAtMs: envelope.observedAtMs,
          records: parsePolymarketSportsWire(envelope.payload),
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
        const records = page.records.map(projectSport);
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

export async function fetchPolymarketSportsWire(
  options: PolymarketSportsMetadataAdapterOptions = {},
): Promise<unknown> {
  const base = (options.baseUrl ?? OFFICIAL_URLS.polymarket.gammaApiBase).replace(/\/$/, "");
  const { baseUrl: _, fetchImpl = fetch, now: __, ...retryOptions } = options;
  const response = await fetchWithRetry(
    `${base}/sports`,
    { headers: { Accept: "application/json" } },
    { ...retryOptions, fetchImpl },
  );
  if (!response.ok) {
    throw new Error(`Polymarket sports: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

/** Strict all-or-nothing boundary for the unpaginated Polymarket sports snapshot. */
export function parsePolymarketSportsWire(raw: unknown): PolymarketSportMetadata[] {
  if (!Array.isArray(raw)) throw new Error("Polymarket sports snapshot: array required");
  if (raw.length === 0) throw new Error("Polymarket sports snapshot: must not be empty");
  const seen = new Set<string>();
  const seenRowIds = new Set<number>();
  return raw.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Polymarket sports[${index}]: object required`);
    const sportCode = requiredString(value.sport, `sports[${index}].sport`);
    if (seen.has(sportCode)) {
      throw new Error(`Polymarket sports snapshot: duplicate sport ${sportCode}`);
    }
    seen.add(sportCode);
    const tagIds = parseTagIds(value.tags, index);
    const rowId = optionalPositiveInteger(value.id, `sports[${index}].id`);
    if (rowId !== undefined) {
      if (seenRowIds.has(rowId)) {
        throw new Error(`Polymarket sports snapshot: duplicate row id ${rowId}`);
      }
      seenRowIds.add(rowId);
    }
    const createdAtMs = optionalTimestamp(value.createdAt, `sports[${index}].createdAt`);
    return {
      sportCode,
      imageUrl: httpUrl(value.image, `sports[${index}].image`),
      resolutionUrl: httpUrl(value.resolution, `sports[${index}].resolution`),
      ordering: requiredString(value.ordering, `sports[${index}].ordering`),
      tagIds,
      seriesId: numericString(value.series, `sports[${index}].series`),
      ...(rowId === undefined ? {} : { rowId }),
      ...(createdAtMs === undefined ? {} : { createdAtMs }),
    };
  });
}

function projectSport(row: PolymarketSportMetadata): NormalizedSourceMetadata {
  return {
    source: SOURCE.polymarket,
    metadataId: asSourceMetadataId(row.sportCode),
    metadataKind: SELECTOR.polymarketSportsMetadata,
    label: row.sportCode,
    attributes: {
      image_url: row.imageUrl,
      resolution_url: row.resolutionUrl,
      ordering: row.ordering,
      series_id: row.seriesId,
      ...(row.rowId === undefined ? {} : { row_id: String(row.rowId) }),
      ...(row.createdAtMs === undefined ? {} : { created_at_ms: String(row.createdAtMs) }),
    },
    facets: { tag_ids: row.tagIds },
  };
}

function assertRequest(request: MetadataFetchRequest, definition: AdapterDefinition): void {
  const expected = definition.metadataDiscovery;
  if (!expected) throw new Error("Polymarket metadata discovery is not configured");
  if (
    request.pageIndex !== 0 ||
    request.cursor !== undefined ||
    request.selector.kind !== expected.kind ||
    request.selector.scope !== expected.scope ||
    request.selector.sport !== expected.sport ||
    !recordsEqual(request.selector.parameters, expected.parameters)
  ) {
    throw new Error("Polymarket metadata request must match the atomic discovery selector");
  }
}

function metadataDefinition(): AdapterDefinition {
  const definition = ADAPTERS.find((row) => row.id === ADAPTER.polymarketGamma);
  if (!definition?.metadataDiscovery || !definition.metadataCachePolicy) {
    throw new Error("Polymarket metadata adapter definition missing");
  }
  return definition;
}

function parseTagIds(raw: unknown, index: number): string[] {
  const value = requiredString(raw, `sports[${index}].tags`);
  const tags = value.split(",").map((tag) => numericString(tag.trim(), `sports[${index}].tags`));
  if (new Set(tags).size !== tags.length) {
    throw new Error(`Polymarket sports[${index}].tags: duplicate tag id`);
  }
  return tags;
}

function numericString(raw: unknown, label: string): string {
  const value = requiredString(raw, label);
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`Polymarket ${label}: positive numeric string required`);
  return value;
}

function optionalPositiveInteger(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Number.isSafeInteger(raw) || (raw as number) < 1) {
    throw new Error(`Polymarket ${label}: positive integer required`);
  }
  return raw as number;
}

function optionalTimestamp(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Error(`Polymarket ${label}: timestamp required`);
  const value = Date.parse(raw);
  if (!Number.isFinite(value)) throw new Error(`Polymarket ${label}: valid timestamp required`);
  return value;
}

function httpUrl(raw: unknown, label: string): string {
  const value = requiredString(raw, label);
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Polymarket ${label}: HTTP(S) URL required`);
  }
  return url.toString();
}

function requiredString(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`Polymarket ${label}: string required`);
  }
  return raw.trim();
}

function parseEnvelope(raw: unknown): MetadataEnvelope {
  if (
    !isRecord(raw) ||
    !("payload" in raw) ||
    typeof raw.observedAtMs !== "number" ||
    !Number.isSafeInteger(raw.observedAtMs) ||
    raw.observedAtMs < 0
  ) {
    throw new Error("Polymarket metadata envelope is invalid");
  }
  return { payload: raw.payload, observedAtMs: raw.observedAtMs };
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
