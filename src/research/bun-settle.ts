// @see https://bun.com/docs/runtime/utils#bun-peek
import { peek } from "bun";

/**
 * Await a promise, but read fulfilled/rejected results synchronously via Bun.peek
 * (skips an extra microtick when the promise is already settled — e.g. inspect cache hits).
 */
export async function awaitSettled<T>(input: Promise<T> | T): Promise<T> {
  if (!(input instanceof Promise)) return input;
  const status = peek.status(input);
  if (status === "pending") return await input;
  if (status === "rejected") throw peek(input);
  return peek(input) as T;
}

/** Non-throwing status probe for pool telemetry. */
export function promiseStatus(input: Promise<unknown> | unknown): "fulfilled" | "rejected" | "pending" | "sync" {
  if (!(input instanceof Promise)) return "sync";
  return peek.status(input);
}
