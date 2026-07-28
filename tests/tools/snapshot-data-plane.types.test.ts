// @see https://bun.com/docs/test/writing-tests#type-testing
import { expectTypeOf } from "bun:test";
import type { DataPlaneSnapshot, SnapshotIndex } from "../../tools/snapshot-data-plane.ts";
import {
  captureSnapshot,
  captureDataPlane,
  computeFingerprint,
  compressBuffer,
  decompressBuffer,
  findSnapshots,
  listSnapshots,
  pruneSnapshots,
  readRegistry,
  validateRegistry,
} from "../../tools/snapshot-data-plane.ts";

// ── DataPlaneSnapshot shape ──

expectTypeOf<DataPlaneSnapshot>().toMatchObjectType<{
  v: 1;
  ts: string;
  tsUnix: number;
  run: string;
  fingerprint: string;
}>();

expectTypeOf<DataPlaneSnapshot["rows"]>().toMatchObjectType<{
  events: number;
  markets: number;
  resolutions: number;
  book_ticks: number;
  book_ticks_by_source: Record<string, number>;
}>();

expectTypeOf<DataPlaneSnapshot["blockers"]>().toMatchObjectType<{
  gh_auth: boolean;
  protonpass_session: boolean;
  kalshi_ws: boolean;
  odds_api: boolean;
}>();

expectTypeOf<DataPlaneSnapshot["canary"]["liveMatches"]>().items.toMatchObjectType<{
  ticker: string;
  summary: string;
}>();

// ── Function signatures ──

expectTypeOf(captureSnapshot).toBeFunction();
expectTypeOf(captureSnapshot).returns.toEqualTypeOf<Promise<DataPlaneSnapshot>>();

expectTypeOf(captureDataPlane).toBeFunction();
expectTypeOf(captureDataPlane).returns.toEqualTypeOf<Promise<DataPlaneSnapshot>>();

expectTypeOf(computeFingerprint).toBeFunction();
expectTypeOf(computeFingerprint).parameters.toEqualTypeOf<[DataPlaneSnapshot]>();
expectTypeOf(computeFingerprint).returns.toBeString();

expectTypeOf(compressBuffer).toBeFunction();
expectTypeOf(compressBuffer).parameters.toEqualTypeOf<[Buffer]>();
expectTypeOf(compressBuffer).returns.toEqualTypeOf<Buffer>();

expectTypeOf(decompressBuffer).toBeFunction();
expectTypeOf(decompressBuffer).parameters.toEqualTypeOf<[Buffer]>();
expectTypeOf(decompressBuffer).returns.toEqualTypeOf<Buffer>();

expectTypeOf(findSnapshots).toBeFunction();
expectTypeOf(findSnapshots).returns.toEqualTypeOf<Promise<DataPlaneSnapshot[]>>();

expectTypeOf(listSnapshots).toBeFunction();
expectTypeOf(listSnapshots).returns.toEqualTypeOf<Promise<DataPlaneSnapshot[]>>();

expectTypeOf(pruneSnapshots).toBeFunction();
expectTypeOf(pruneSnapshots).returns.toEqualTypeOf<Promise<{ compressed: number; deleted: number; bytesSaved: number }>>();

expectTypeOf(readRegistry).toBeFunction();
expectTypeOf(readRegistry).returns.toEqualTypeOf<Promise<DataPlaneSnapshot[]>>();

expectTypeOf(validateRegistry).toBeFunction();
expectTypeOf(validateRegistry).returns.toEqualTypeOf<Promise<{ ok: boolean; errors: string[] }>>();

