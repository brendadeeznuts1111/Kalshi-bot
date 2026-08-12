/**
 * ID mint helpers — prefer UUID v7 for store / order / journal keys.
 *
 * @see https://bun.com/docs/runtime/utils#bun-randomuuidv7
 * @see https://bun.com/reference/bun/randomUUIDv7
 * @see docs/BUN_NATIVE.md § Utils · randomUUIDv7
 */
// @see https://bun.com/docs/runtime/utils#bun-randomuuidv7
import { randomUUIDv7 } from 'bun';

/**
 * Monotonic UUID v7 (hex). Sortable by mint time; safe for SQLite PKs,
 * client_order_id, journal txnId, experiment ids, lease owners, idempotency.
 *
 * For pure entropy (temp file names, nonces where order must not leak time),
 * keep `crypto.randomUUID()` (v4).
 */
export function mintSortableId(timestampMs?: number): string {
  // bun-types require encoding before timestamp (docs allow timestamp-only).
  return timestampMs === undefined ? randomUUIDv7() : randomUUIDv7('hex', timestampMs);
}

/** 16-byte UUID v7 buffer (avoids string conversion when hashing). */
export function mintSortableIdBuffer(timestampMs?: number): Buffer {
  return timestampMs === undefined
    ? randomUUIDv7('buffer')
    : randomUUIDv7('buffer', timestampMs);
}

/** True if string looks like a UUID with version nibble 7. */
export function isUuidV7(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}
