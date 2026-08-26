// MinHeap invariants + determinism (clusterer Prim MST dependency, §193).
import { describe, expect, test } from "bun:test";
import { MinHeap } from "../../src/lib/min-heap.ts";

describe("MinHeap", () => {
  test("pops in ascending comparator order", () => {
    const h = new MinHeap<number>((a, b) => a < b, [5, 3, 8, 1, 9, 2]);
    expect([...Array(6)].map(() => h.pop())).toEqual([1, 2, 3, 5, 8, 9]);
    expect(h.size).toBe(0);
  });

  test("peek returns the min without removing", () => {
    const h = new MinHeap<number>((a, b) => a < b, [4, 1, 7]);
    expect(h.peek()).toBe(1);
    expect(h.size).toBe(3);
  });

  test("empty heap pops undefined", () => {
    const h = new MinHeap<number>((a, b) => a < b);
    expect(h.pop()).toBeUndefined();
    expect(h.peek()).toBeUndefined();
  });

  test("duplicates are handled stably", () => {
    const h = new MinHeap<number>((a, b) => a < b, [2, 2, 1]);
    expect([...Array(3)].map(() => h.pop())).toEqual([1, 2, 2]);
  });

  test("push after pops keeps heap order", () => {
    const h = new MinHeap<number>((a, b) => a < b, [10, 20]);
    h.pop();
    h.push(5);
    expect(h.pop()).toBe(5);
    expect(h.pop()).toBe(20);
  });
});