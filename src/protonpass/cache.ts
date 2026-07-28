/**
 * Bun-native secret cache — TTL via Bun.file + Bun.write.
 * Secrets cached in a gitignored JSON file with expiration timestamps.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type CacheEntry = {
  value: string;
  expiresAt: number; // epoch ms
};

export type SecretCache = {
  [key: string]: CacheEntry;
};

export type CacheOptions = {
  path?: string;
  defaultTtlMs?: number;
};

const DEFAULT_PATH = ".protonpass-cache.json";
const DEFAULT_TTL_MS = 15 * 60_000; // 15 minutes

export class SecretCacheManager {
  private path: string;
  private defaultTtlMs: number;

  constructor(opts: CacheOptions = {}) {
    this.path = opts.path ?? DEFAULT_PATH;
    this.defaultTtlMs = opts.defaultTtlMs ?? DEFAULT_TTL_MS;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
  }

  private async load(): Promise<SecretCache> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return {};
    try {
      return (await file.json()) as SecretCache;
    } catch {
      return {};
    }
  }

  private async save(cache: SecretCache): Promise<void> {
    await this.ensureDir();
    await Bun.write(this.path, JSON.stringify(cache, null, 2));
  }

  /** Get a cached value if it exists and hasn't expired. */
  async get(key: string): Promise<string | null> {
    const cache = await this.load();
    const entry = cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      // Expired — clean up
      delete cache[key];
      await this.save(cache);
      return null;
    }
    return entry.value;
  }

  /** Store a value with optional TTL override. */
  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const cache = await this.load();
    cache[key] = {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    };
    await this.save(cache);
  }

  /** Delete a key from cache. */
  async delete(key: string): Promise<void> {
    const cache = await this.load();
    delete cache[key];
    await this.save(cache);
  }

  /** Purge all expired entries and return stats. */
  async purgeExpired(): Promise<{ purged: number; remaining: number }> {
    const cache = await this.load();
    const now = Date.now();
    let purged = 0;
    for (const key of Object.keys(cache)) {
      if (now > cache[key]!.expiresAt) {
        delete cache[key];
        purged++;
      }
    }
    await this.save(cache);
    return { purged, remaining: Object.keys(cache).length };
  }

  /** Wipe the entire cache. */
  async clear(): Promise<void> {
    await Bun.write(this.path, "{}");
  }
}
