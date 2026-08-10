/**
 * File cache for Statscore booked catalog (TTL). Fallback when live fetch fails.
 */
// @see https://bun.com/docs/runtime/file-io
import { join } from 'node:path';
import { CACHE_DIR } from '../research/paths.ts';
import type { BookedCatalogEntry } from './booked-catalog.ts';

export type BookedCatalogCachePayload = {
  savedAtMs: number;
  expiresAtMs: number;
  source: string;
  pages: number;
  totalItemsHint: number | null;
  entries: BookedCatalogEntry[];
};

export function defaultBookedCatalogCachePath(): string {
  const override = Bun.env.INVENTORY_BOOKED_CATALOG_CACHE?.trim();
  if (override) return override;
  return join(CACHE_DIR, 'booked-catalog-cache.json');
}

export async function loadBookedCatalogCache(
  path: string,
  options: { nowMs?: number; allowStale?: boolean } = {}
): Promise<BookedCatalogCachePayload | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const raw = (await file.json()) as Partial<BookedCatalogCachePayload>;
    if (!Array.isArray(raw.entries) || raw.entries.length === 0) return null;
    const nowMs = options.nowMs ?? Date.now();
    const expiresAtMs = Number(raw.expiresAtMs) || 0;
    if (!options.allowStale && expiresAtMs > 0 && expiresAtMs < nowMs) return null;
    return {
      savedAtMs: Number(raw.savedAtMs) || 0,
      expiresAtMs,
      source: String(raw.source ?? 'cache'),
      pages: Number(raw.pages) || 0,
      totalItemsHint:
        raw.totalItemsHint == null ? null : Number(raw.totalItemsHint) || null,
      entries: raw.entries as BookedCatalogEntry[],
    };
  } catch {
    return null;
  }
}

export async function saveBookedCatalogCache(
  path: string,
  payload: BookedCatalogCachePayload
): Promise<void> {
  await Bun.write(path, JSON.stringify(payload, null, 2) + '\n');
}
