/** Bounded-concurrency worker pool (~15 lines, no p-limit). See docs/BUN_NATIVE.md. */
import { awaitSettled } from "./bun-settle.ts";

export type MapPoolOptions = {
  /** When a worker throws and this returns true, stop scheduling further items. */
  failFast?: (err: unknown) => boolean;
};

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  options?: MapPoolOptions,
): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  let stop = false;
  let failFastError: unknown = null;

  async function runWorker(): Promise<void> {
    while (!stop) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await awaitSettled(worker(items[index]!, index));
      } catch (err) {
        if (options?.failFast?.(err)) {
          stop = true;
          failFastError ??= err;
        }
        throw err;
      }
    }
  }

  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  if (failFastError) throw failFastError;

  const rejected = outcomes.find((o) => o.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;

  return results;
}
