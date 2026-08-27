# Blob (Web API) — verified on Bun 1.4.0

**Status:** probe-verified against **Bun 1.4.0** (repo baseline). Legend: ✅ as
claimed · ⚠️ works with different semantics · ❌ not supported.

`Blob` is a Web API, not a Bun invention — but Bun adds runtime-specific
behavior (charset normalization, lax parts) that this deep dive pins down.
BunFile (Bun's lazy file-backed Blob) lives in [`BUN_FILE.md`](BUN_FILE.md);
here we cover the cross-runtime Blob core.

---

## 1. Constructor — `new Blob(parts, options?)`

```ts
const blob = new Blob(["hello", " ", "world"], { type: "text/html" });
```

- **parts**: array of `string`, `ArrayBuffer`, `TypedArray`, `DataView`, or nested
  `Blob` — concatenated in order. ✅ verified (all five kinds probe-pass on 1.4.0).
- **`options.type`**: MIME type; empty string by default. ✅
- ⚠️ **Lax parts:** non-conforming values are *stringified*, not rejected:
  `new Blob([{ a: 1 }])` → `"[object Object]"`, `123` → `"123"` (probe). Browsers
  throw `TypeError` here — Bun silently accepts. Watch for accidental `"[object Object]"`
  in blobs built from mis-typed data.
- ⚠️ **Snapshot at construction:** part bytes are copied when the blob is created;
  mutating the source `Uint8Array` afterwards does not change the blob (probe:
  mutate-after → blob still holds the original bytes).
- ⚠️ **Type inheritance:** when `options.type` is omitted and the *first* part is a
  Blob, the outer blob inherits that part's type (spec behavior; probe-verified).

## 2. Properties

| Property | Verdict | Notes |
| --- | --- | --- |
| `blob.type` | ⚠️ | Lowercased per spec, but **Bun appends `;charset=utf-8` to well-known types**: `{ type: "text/html" }` → `"text/html;charset=utf-8"` (probe). Exotic types pass through verbatim (`text/custom` stays `text/custom`). Node/browsers store the lowercased type without the charset suffix. |
| `blob.size` | ✅ | Total byte length (UTF-8-aware: `new Blob(["héllo"]).size === 6`, emoji `"😀"` → 4). |

## 3. Reading contents

```ts
await blob.text();        // string, UTF-8 decoded
await blob.bytes();       // Uint8Array — verified COPY
await blob.arrayBuffer(); // ArrayBuffer — verified COPY
blob.stream();            // ReadableStream, synchronous (no await)
```

- ✅ All four verified on 1.4.0. `bytes()` and `arrayBuffer()` return fresh copies —
  mutating the returned buffer does not affect the blob (probe: mutate → re-read → original bytes).
- ✅ `stream()` is sync and yields the blob's bytes as `Uint8Array` chunks.
- ✅ **`slice(start, end)`** (omitted by the original guide) returns a new Blob:
  `new Blob(["hello world"]).slice(0, 5)` → `"hello"` (probe).

## 4. Converting other types to Blob

```ts
new Blob([buf], { type: "text/plain" }); // buf: ArrayBuffer | TypedArray | DataView | Buffer
```

✅ Same pattern for all four; `Buffer` (a `Uint8Array` subclass) works.

## 5. File — the Blob subclass with metadata

```ts
const file = new File(["abc"], "name.html", { type: "text/html", lastModified: 12345 });
```

- ✅ `name`, `type`, `size`, `lastModified` all verified; `file instanceof Blob === true`.
- ✅ `lastModified` defaults to `Date.now()` when omitted; explicitly passing `0` is honored.
- ✅ Accepts a Blob as a part: `new File([blob], "b.bin")`.

## 6. BunFile — lazy file-backed Blob (cross-link)

✅ `Bun.file(path) instanceof Blob === true`, `size`/`type`/`name`/`lastModified` are
sync properties, and nothing reads disk until you call a reader. Missing-file reads
**throw `ENOENT`** (they do not return empty content). Full contract — size caching
contradiction, `s3://` mode, `{ type }` charset nuances, deletion API — is in
[`BUN_FILE.md`](BUN_FILE.md); do not duplicate it here.

## 7. Cross-runtime consistency — the honest table

| Surface | Bun 1.4.0 | Node | Browsers |
| --- | --- | --- | --- |
| Constructor, `size`, `type`, `text()`, `arrayBuffer()`, `stream()`, `slice()`, `File` | ✅ | ✅ (Blob/File globals since Node 18/20) | ✅ |
| `bytes()` | ✅ | ✅ only **Node ≥ 22.3.0** (v22.3.0 release notes) | ✅ newer (Chromium landed it in 2024) |
| Type charset suffix | ⚠️ appends `;charset=utf-8` | ❌ verbatim lowercased | ❌ verbatim lowercased |
| Junk parts | ⚠️ stringified | (implementation-dependent) | ❌ `TypeError` |

So "implemented consistently" holds for the core; `bytes()` and type normalization
are where runtimes diverge. For maximum portability use `arrayBuffer()` and read
`type` defensively.

## 8. Corrections vs the original guide

| Original claim | Reality on 1.4.0 |
| --- | --- |
| `options.type` sets the MIME type | ⚠️ yes, but Bun appends `;charset=utf-8` to well-known types |
| "Bun, browsers, Node implement it consistently" | ⚠️ core yes; `bytes()` is Node ≥ 22.3 / recent browsers only |
| `blob.bytes()` returns a copy | ✅ verified |
| `blob.arrayBuffer()` returns a copy | ✅ verified |
| `BunFile` doesn't load into memory upfront | ✅ verified (sync `size`/`type`; reads hit disk) |
| (omitted) `blob.slice()` | ✅ exists and is part of the core API |
| (omitted) junk parts | ⚠️ stringified silently (browsers throw) |

**Docs:** https://bun.com/docs/runtime/binary-data#blob ·
https://bun.com/docs/runtime/binary-data#bunfile ·
MDN https://developer.mozilla.org/en-US/docs/Web/API/Blob ·
Node https://nodejs.org/api/buffer.html#class-blob
