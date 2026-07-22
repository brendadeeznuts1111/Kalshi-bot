// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { ensureGh } from "../src/research/preflight.ts";

describe("ensureGh", () => {
  test("returns path when gh is installed", () => {
    const path = ensureGh();
    expect(path.length).toBeGreaterThan(0);
  });
});
