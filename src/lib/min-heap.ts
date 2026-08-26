/**
 * min-heap.ts — generic binary min-heap used by the clusterer's Prim MST
 * (heap-based hierarchical clustering; docs/AGENT-PITFALLS §193).
 *
 * Deterministic: push/pop order is stable; no map-order dependence.
 */
export class MinHeap<T> {
  private items: T[] = [];
  private readonly less: (a: T, b: T) => boolean;

  constructor(less: (a: T, b: T) => boolean, seed: T[] = []) {
    this.less = less;
    for (const x of seed) this.push(x);
  }

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    this.items.push(value);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(this.items[i]!, this.items[parent]!)) {
        [this.items[i], this.items[parent]] = [this.items[parent]!, this.items[i]!];
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < this.items.length && this.less(this.items[left]!, this.items[smallest]!)) smallest = left;
      if (right < this.items.length && this.less(this.items[right]!, this.items[smallest]!)) smallest = right;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest]!, this.items[i]!];
      i = smallest;
    }
  }
}