# Direct ReadableStream (type: "direct") — probe-verified

**Source:** [runtime/streams.md](https://bun.com/docs/runtime/streams.md) §Direct
ReadableStream · probe-verified on bun 1.4.0 (34cbb9a40). Legend: ✅ verified ·
⚠️ differs from the source snippet · ❌ not supported / contradicted.

Direct streams are a **Bun-only** optimization: instead of `enqueue()`-ing into a
source-side queue, you `write()` straight to the destination, which owns all
queueing. The verified controller surface: `write`, `flush`, `close`, `end`,
`error` (no `enqueue`/desiredSize).

## 1. Construction and consumption — ✅

```ts
const stream = new ReadableStream({
  type: "direct",
  pull(controller) {
    controller.write("hello");
    controller.write(" world");
    controller.close();
  },
});
```

- ✅ Consumable via `for await` (delivers the concatenation), `getReader()`,
  and `new Response(stream).text()` — all probe-passed.
- ✅ When read from JavaScript, Bun buffers the writes and delivers them as
  `Uint8Array` chunks (strings are UTF-8 encoded) — no source-side queueing.

## 2. Backpressure: number vs Promise<number> — ⚠️ the snippet's premise is wrong

**Verified semantics of `controller.write(chunk)`:**

| Destination state | Return | Evidence |
| --- | --- | --- |
| Draining freely | `number` = bytes written | 1.4.0 probes: `"hello"` → 5, `" world"` → 6, 1 MiB chunk → 1048576 |
| Destination buffer full (e.g. slow HTTP client) | `Promise<number>`, resolves when drained | 100 MiB direct-stream response to a slow client: writes returned 3 numbers then **397 Promises**; all 104 857 600 bytes delivered |
| Read from JavaScript (for-await/getReader/Response) | Always a plain number — Bun buffers without backpressure | 600 × 1 MiB to a 10 ms/read consumer: 600/600 numeric, min 1048576 |
| After `close()` | Silently returns `1`, no throw | probe |

**There is no negative return value.** The snippet's
`if (typeof n === "number" && n < 0) await controller.flush(true);` is dead
code: when backpressure actually occurs, `n` is a `Promise`, not a negative
number, so the branch never fires in either scenario.

**Correct pattern (per the official docs):** `await` the write — it handles both
forms uniformly:

```ts
new ReadableStream({
  type: "direct",
  async pull(controller) {
    for (const chunk of chunks) {
      await controller.write(chunk); // number | Promise<number> — await handles both
    }
    controller.close();
  },
});
```

## 3. flush() — ✅ works, returns undefined

`controller.flush(immediate?)` → `undefined` (not a number/Promise). All three
forms probe-passed: `flush()`, `flush(true)`, `flush(false)` — none break the
stream (`"part1-" → flush(true) → "part2"` still reads back `"part1-part2"`).
Per docs, `await controller.flush(true)` is equivalent to awaiting the write
promise; use it after a write returns a `Promise` to pace a slow destination.

## 4. pull is called once — ✅

Direct streams expect you to write everything inside the single `pull` call
(verified: pull count = 1 when all writes happen there). Writing a little then
`flush(true)` and waiting for another `pull` does **not** work — the stream
hangs. If you need to write more later, keep the loop inside `pull` and pace it
with `await write()` / `await flush(true)`.

## 5. Edge cases

- `write()` argument validation: **zero args → throws** `"Expected text,
  ArrayBuffer or ArrayBufferView"`; **extra args are silently ignored** (probe:
  `write("x", "y")` returns `1` — writes `"x"`). Accepts `string` |
  `ArrayBuffer` | `ArrayBufferView`.
- `controller.end()` / `error()` exist on the controller (not probed in depth).
- `bun-types` 1.4.0 does **not** declare the direct controller — cast the
  config (`as any`) or use Bun's own docs types.

## 6. Summary vs the original snippet

| Snippet claim | Reality on 1.4.0 |
| --- | --- |
| `type: "direct"` with `pull` | ✅ works |
| `controller.write(chunk)` returns a number | ✅ (bytes written) |
| `n < 0` signals backpressure | ❌ never negative; backpressure is a `Promise<number>` |
| `await controller.flush(true)` on backpressure | ⚠️ valid but never reached by the `n < 0` guard; correct trigger is a Promise return |
| `controller.close()` at the end | ✅ |

The snippet produces correct output as written (`"chunk-1-chunk-2-chunk-3-chunk-4"`
verified end-to-end) — its only flaw is the dead backpressure branch. Use
`await controller.write(chunk)` instead.

**Docs:** https://bun.com/docs/runtime/streams.md · https://bun.com/docs/api/streams
