// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { awaitSettled, promiseStatus } from "../src/research/bun-settle.ts";

describe("awaitSettled (Bun.peek)", () => {
  test("returns sync values without awaiting", async () => {
    expect(await awaitSettled(42)).toBe(42);
    expect(promiseStatus(42)).toBe("sync");
  });

  test("reads fulfilled promises without extra await tick", async () => {
    const promise = Promise.resolve("hi");
    expect(promiseStatus(promise)).toBe("fulfilled");
    expect(await awaitSettled(promise)).toBe("hi");
  });

  test("propagates rejected promises", async () => {
    const promise = new Promise<string>((_, reject) => {
      reject(new Error("peek-reject"));
    });
    promise.catch(() => {});
    expect(promiseStatus(promise)).toBe("rejected");
    await expect(awaitSettled(promise)).rejects.toThrow("peek-reject");
  });

  test("rejected peek fast path attaches handler without external catch", async () => {
    const promise = Promise.reject(new Error("peek-reject-no-catch"));
    expect(promiseStatus(promise)).toBe("rejected");
    await expect(awaitSettled(promise)).rejects.toThrow("peek-reject-no-catch");
  });

  test("awaits pending promises", async () => {
    let resolve!: (value: number) => void;
    const pending = new Promise<number>((r) => {
      resolve = r;
    });
    expect(promiseStatus(pending)).toBe("pending");
    resolve(7);
    expect(await awaitSettled(pending)).toBe(7);
  });
});
