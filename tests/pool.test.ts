// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { mapPool } from "../src/research/pool.ts";
import { GitHubRateLimitError } from "../src/research/github-errors.ts";

describe("mapPool fail-fast", () => {
  test("stops scheduling when failFast triggers", async () => {
    let started = 0;
    const err = new GitHubRateLimitError("tripped", { source: "test" });

    await expect(
      mapPool(
        [1, 2, 3, 4, 5, 6],
        3,
        async (item) => {
          started++;
          await Bun.sleep(5);
          if (item === 2) throw err;
          return item;
        },
        { failFast: () => true },
      ),
    ).rejects.toThrow("tripped");

    expect(started).toBeLessThan(6);
  });

  test("runs all items when no failFast", async () => {
    const out = await mapPool([1, 2, 3], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6]);
  });

  test("awaitSettled reads already-fulfilled worker promises (inspect cache hits)", async () => {
    const out = await mapPool(["a", "b", "c"], 2, (item) => Promise.resolve(item.toUpperCase()));
    expect(out).toEqual(["A", "B", "C"]);
  });
});
