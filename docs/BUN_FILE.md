# BunFile — verified reference (Bun 1.4.0)

Deep-dive companion to the File I/O row in [`BUN_NATIVE.md`](BUN_NATIVE.md). The
**official bun.com guide and API reference are the primary source of truth**; every
fact below was read from those pages (live-fetched, pinned to the Bun v1.4.0 docs)
and cross-checked against the installed runtime (bun 1.4.0, 34cbb9a40) and
`bun-types@1.4.0`. Local probes only corroborate — they never override the docs.

**Web Blob core (`new Blob`, `File`, readers):** [`BLOB.md`](BLOB.md) — the
cross-runtime Blob surface; this file is BunFile-specific.

Legend: **[official]** bun.com guide/reference · **[probe]** runtime-verified on
bun@1.4.0 in this repo · **[repo]** pinned by `tools/fs-probe.ts` (P#) /
AGENT-PITFALLS · **[types]** `bun-types@1.4.0`.

## TL;DR

- `BunFile` is a **lazy `Blob` subclass** for files — nothing touches disk until you read.
- `BunFile` and `FileBlob` are the **same interface under two names** in the reference; the
  runtime class name is literally `Blob`. Neither `BunFile` nor `FileBlob` is a global on 1.4.0.
- **Deletion IS part of the API**: `file.delete()` / `file.unlink()` ([official] guide section
  "Deleting files (file.delete())"). The old "use node:fs to delete" guidance is stale.
- `Bun.file(bytes)` means **bytes-as-path**, not file contents ([official] + [probe]).
- `Bun.write(dest, data)` returns the number of bytes written and has 5 documented overloads
  (dest: `BunFile | PathLike | S3File`; `createPath`/`mode` options).

## Construction — `Bun.file()` ([official] /reference/bun/file)

```ts
function file(path: string | URL, options?: BlobPropertyBag): BunFile;
function file(path: ArrayBufferLike | Uint8Array, options?: BlobPropertyBag): BunFile;
function file(fileDescriptor: number, options?: BlobPropertyBag): BunFile;
```

1. **Path** — `Bun.file("foo.txt")` or `Bun.file(new URL(import.meta.url))` (file:// URL).
   Lazy; relative to cwd. **If the path starts with `s3://`, the object behaves like
   `S3File`** ([official]; [probe]: `name === "bucket/key"`, `bucket`/`presign` present,
   `size` NaN, `type` ""; writes → `ERR_S3_MISSING_CREDENTIALS` without credentials).
2. **Byte buffer = the path, not the contents** ([official] + [probe]): the buffer is copied
   and decoded as the path. `Bun.file(new TextEncoder().encode("./hello.json"))` opens
   `./hello.json`. Passing arbitrary bytes therefore opens a garbage path — my earlier
   `[1,2,3]` probe hit `ENOENT: open '\x01\x02\x03'`, which is the *documented* behavior,
   not a runtime bug.
3. **File descriptor** — `Bun.file(fd)` wraps an open fd ([probe]: reads work;
   `name` is `undefined` — the fd has no path).

`options` is `BlobPropertyBag` (`{ type?, endings? }`). The reference docstring says
`type` is "Not yet implemented", **but the guide and the 1.4.0 runtime agree it works**:
[probe] `Bun.file(p, { type: "application/json" }).type` → `application/json;charset=utf-8`;
`{ type: "text/custom" }` → `text/custom` (charset suffix behavior varies by value — see
gotcha #7). Flagged as a docs-internal contradiction (reference stale vs guide).

## Properties

| Property | Type | Notes (official unless tagged) |
| --- | --- | --- |
| `size` | `number` | [CONTRADICTION] [official] "not valid until the contents of the file are read at
  least once"; [probe] 1.4.0 returns the CORRECT size eagerly (stat on first access) then
  CACHES it — stale after external changes. Missing file → `0`. |
| `type` | `string` | MIME auto-set from extension when possible; see table below. |
| `name` | `string \| undefined` | Path as given to the constructor; `undefined` for fd
  ([probe]). |
| `lastModified` | `number` | UNIX ms timestamp; stat-derived per instance (recreate for fresh). Missing file → `4503599627370495` (2^52−1). |

### MIME inference ([probe], 1.4.0)

Verified table (research-agent empirical run, [probe]; the current docs removed the old table):

| MIME (1.4.0) | Extensions |
| --- | --- |
| `application/json;charset=utf-8` | json, map |
| `text/plain;charset=utf-8` | txt, log, conf, ini |
| `text/html;charset=utf-8` | html, htm |
| `text/css;charset=utf-8` | css |
| `text/javascript;charset=utf-8` | js, mjs, cjs, ts, tsx, jsx, mts, cts |
| `text/markdown` · `text/csv` · `text/yaml` | md · csv · yaml, yml |
| `text/x-sass` / `text/x-scss` / `text/less` | sass / scss / less |
| `text/x-c` | c, h |
| `image/png` · `image/jpeg` | png · jpg, jpeg |
| `image/gif` / `image/webp` / `image/avif` / `image/apng` | gif / webp / avif / apng |
| `image/svg+xml` · `image/x-icon` · `image/x-ms-bmp` · `image/tiff` | svg · ico · bmp · tif, tiff |
| `image/heic` / `image/heif` · `image/vnd.adobe.photoshop` | heic / heif · psd |
| `audio/mpeg` · `audio/ogg` · `audio/x-wav` · `audio/x-flac` · `audio/x-aac` · `audio/x-m4a` | mp3 · ogg · wav · flac · aac · m4a |
| `video/mp4` · `video/webm` · `video/mpeg` · `video/quicktime` | mp4 · webm · mpg, mpeg · mov |
| `video/x-msvideo` / `video/x-flv` / `video/x-matroska` | avi / flv / mkv |
| `font/woff` · `font/woff2` · `font/ttf` · `font/otf` | woff · woff2 · ttf · otf |
| `application/pdf` · `application/wasm` · `application/toml` | pdf · wasm · toml |
| `application/zip` / `application/gzip` / `application/x-tar` / `application/x-7z-compressed` / `application/x-bzip2` / `application/x-xz` / `application/x-rar-compressed` | zip / gz / tar / 7z / bz2 / xz / rar |
| `application/x-sh` · `application/x-sql` · `application/xml` | sh · sql · xml |
| `application/msword` / `application/vnd.ms-excel` / `application/vnd.ms-powerpoint`; `…openxmlformats-officedocument…` | doc / xls / ppt; docx, xlsx, pptx |
| `application/vnd.ms-fontobject` · `application/epub+zip` · `application/postscript` · `application/x-shockwave-flash` · `application/vnd.apple.mpegurl` | eot · epub · eps, ai · swf · m3u8 |
| `model/gltf+json` / `model/gltf-binary` | gltf / glb |
| `application/octet-stream` | bin, py, rb, go, svelte, vue, lock, env, cfg, jsonl, ndjson, ipynb, extensionless |
| `application/rls-services+xml` | **rs** (!!) — bogus legacy mapping |

Quirks: (a) `.rs` → `application/rls-services+xml`, almost certainly a bug; (b) `.py`/`.go`/`.rb`/`.jsonl`/`.ipynb` → `application/octet-stream`; (c) JSON gets `;charset=utf-8`, SVG does not; (d) inference applies **even for nonexistent files** (`Bun.file("nope.xyz").type` → `chemical/x-xyz`), and unknown-but-known extensions get `chemical/x-<ext>`; (e) the docs' "default MIME type is `text/plain;charset=utf-8`" is misleading — the real fallback is `application/octet-stream`; (f) stdio handles: `type` `application/octet-stream`, `size` `Infinity`.

Text-ish types carry `;charset=utf-8`; a missing file still reports a default type and
`size === 0` ([official] guide + [repo] P4). Quirks [probe]: `.rs` →
`application/rls-services+xml` (likely a bug); `.py`/`.go`/`.rb`/`.jsonl`/`.ipynb` →
`application/octet-stream`; unknown-but-known extensions (`.xyz`) → `chemical/x-xyz`;
`Bun.stdin/stdout/stderr.type` → `application/octet-stream` and their `size` is
`Infinity`.

## Reading

`text()`, `json()`, `arrayBuffer()`, `bytes()` (→ `Uint8Array`), `stream()` (→
`ReadableStream<Uint8Array>`) — all [official] + [probe]. `json()` on invalid JSON rejects
with `SyntaxError: Failed to parse JSON` ([probe]). Reading a missing file rejects
`ENOENT` for every read method (incl. `stream()`'s first read), `stat()`, `delete()`/
`unlink()`; deleting a directory → `EPERM`; invalid fd reads → `EBADF` ([probe]).

- `formData()` — parses the blob as `multipart/form-data` **or**
  `application/x-www-form-urlencoded` depending on `blob.type` ([official]); non-parseable
  content throws `Invalid encoding` ([probe] with a `text/plain` file).
- `image(options?)` — wrap in a `Bun.Image` pipeline; equivalent to
  `new Bun.Image(this, options)`; the read happens lazily at the terminal
  ([official] example: `Bun.file("photo.jpg").image().resize(400).webp().write("thumb.webp")`;
  [probe]: `Bun.file("x.png").image().metadata()` → `{width, height, format}`).

## exists()

`Promise<boolean>`. **true for regular files and FIFOs, false for directories**; for an
empty `Blob` always true ([official]). Does a syscall — prefer serving
`new Response(Bun.file(path))` and handling the error instead of pre-checking ([official]).
[probe]: dir → `size 512, exists() false`; missing → `size 0, exists() false`.

## Writing — `Bun.write()` and `file.write()`

### `Bun.write(destination, input, options?)` → `Promise<number>` (bytes written)

Five documented overloads ([official] /reference/bun/write):

```text
write(dest: BunFile | PathLike | S3File, input: string | ArrayBufferLike | TypedArray
      | Blob | ReadableStream | Archive | BlobPart[], options?: { createPath?: boolean; mode?: number }): Promise<number>;
write(dest: BunFile | PathLike, input: Request | Response, options?: { createPath?: boolean }): Promise<number>;
write(dest: BunFile | PathLike, input: BunFile, options?: { createPath?: boolean; mode?: number }): Promise<number>;
```

- **`createPath` defaults to `true`** — parent directories are created; pass
  `{ createPath: false }` for strict no-create (ENOENT) ([probe] + [official]).
- Overwrite + **truncate**: writing `"xy"` over `"abcdef"` leaves `"xy"` ([repo] P7).
- Response/Request bodies are **streamed** into the file as they arrive ([official]).
- Fast-path syscalls ([official] table): `copy_file_range` / `sendfile` / `splice` on
  Linux; `clonefile` → `fcopyfile` fallback on macOS for file copies.
- [probe] verified matrix — destinations: path, `file://` URL, `BunFile`, numeric fd,
  `S3File` (routes to S3; `ERR_S3_MISSING_CREDENTIALS` without creds). Sources: string,
  `Blob`, `BunFile`, `ArrayBuffer`/`SharedArrayBuffer`, any `TypedArray` (raw LE bytes),
  `Response`, `Request`, `BlobPart[]` (concatenated), `Archive` (tar with padding).
  Return = bytes written for every combination. **Bare `ReadableStream` is NOT a source**
  on 1.4.0 — stringified to `"[object ReadableStream]"` (Response/Request bodies stream
  fine because their overloads stream internally).

### `file.write(data, options?)` → `Promise<number>`

Equivalent to `Bun.write(file, data)` ([official]); `data` accepts `string | ArrayBuffer |
SharedArrayBuffer | BunFile | Request | Response | ReadableStream | ArrayBufferView`,
`options.highWaterMark` ([official]). [probe]: creates and overwrites files; after
`file.delete()` a subsequent `file.write()` targets the removed inode (writes vanish) —
reopen a fresh `BunFile` instead.

## Deletion — the corrected stale pointer

**`file.delete()` and `file.unlink()` are aliases** ([official] reference: "Deletes the
file (same as unlink)"; guide section "Deleting files (file.delete())"). [probe]: after
`await file.delete()`, `exists()` → `false`. Use `node:fs` for what BunFile still does not
cover: `mkdir`, `readdir`, directory operations ([official] guide).

## slice()

```text
slice(begin?: number, end?: number, contentType?: string): BunFile; // end is absolute
slice(begin?: number, contentType?: string): BunFile;
slice(contentType?: string): BunFile;
```

Lazy subarray view — does not copy, open, or modify the file ([official]). Returns a
`BunFile` ([probe]: runtime object is a `Blob` instance — consistent, `BunFile extends
Blob`). **`Bun.write` into a sliced file is slower on macOS when `begin > 0`** ([official]).
[repo] P5: `.slice(6, 9).text()` reads the offset range.

## FileSink / writer()

`file.writer(options?: { highWaterMark })` → `FileSink` — incremental writer for files
and pipes, same interface as `ArrayBufferSink` ([official] guide + reference):

```ts
interface FileSink {
  write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number;
  flush(): number | Promise<number>;
  end(error?: Error): number | Promise<number>;   // flush + close fd
  start(options?: { highWaterMark }): void;
  ref(): void;   unref(): void;
}
```

- `write(chunk)` returns the byte count **synchronously**, but NOTHING is on disk
  synchronously — data lands on the next event-loop tick (auto-flush) or immediately on
  `flush()`/`end()` ([probe]; don't stat right after `write()`). `flush()` returns the
  flushed byte count; `end()` flushes + closes. `highWaterMark` is accepted and changes
  buffering (small HWM → per-tick flushes) but the flush is still deferred to the loop
  ([probe] + [official] guide; no numeric default documented).
- **Process-alive CONTRADICTION:** the guide says the process stays alive until
  `end()`, but on 1.4.0 an open FileSink does **not** keep the process alive
  (verified: a subprocess with an open writer exits 0). The FileSink reference is more
  precise: `ref()`/`unref()` only matter "For FIFOs & pipes"; for regular files they do
  nothing. [probe]
- [probe]: `write`/`flush`/`end` verified; data is on disk after `flush()`.

## stat()

`stat(): Promise<Stats>` — `node:fs.Stats` ([official] + [types]). [probe]:
`isFile()` true, `size` correct; rejects `ENOENT` for a missing file.

## Serving and bodies

- `new Response(BunFile)` — `content-type` comes from `file.type` ([probe]). On 1.4.0
  **no `ETag` / `Last-Modified` headers are emitted** and **no conditional-request
  support is documented** ([probe] + [official] absence). Through `Bun.serve` the
  server adds `Content-Length` and answers **Range requests (206 + content-range)** —
  undocumented; a SLICED BunFile body is served as 206 PARTIAL CONTENT (surprising if
  you expected 200). Missing file → ENOENT when the body is consumed, async from the
  handler. [probe]
- `FormData.append("f", BunFile)` — part arrives as a `Blob` with `size` ([probe]).
- `new Request(url, { body: BunFile })` — `content-type` from the file's MIME ([probe]).

## Standard streams

`Bun.stdin`, `Bun.stdout`, `Bun.stderr` are `BunFile` instances ([official] guide +
[repo] P17: `instanceof Blob`). The 3-line Linux `cat` from the guide:
`await Bun.write(Bun.stdout, Bun.file(path))`.

## Naming: BunFile vs FileBlob

- `bun-types` since 1.1.0 declares **`interface FileBlob extends BunFile {}`** — an
  EMPTY marker/alias, not a duplicate (bun.d.ts:2368 in 1.4.0; verified against the
  bun-types 1.0→1.4 history). The reference mirrors both pages with identical member
  lists because FileBlob inherits everything.
- On the 1.4.0 runtime the object's prototype constructor name is `Blob`; neither
  `BunFile` nor `FileBlob` is a global ([probe]). `BunFile` is canonical — the Bun
  1.4 blog never mentions FileBlob — and BunFile is a Blob, NOT a Web `File`
  (open issue oven-sh/bun#16850).

## Gotchas (numbered, runtime-verified on 1.4.0)

1. **`Bun.write(dest, slicedFile)` IGNORES THE SLICE** — the whole file is written
   (docs imply sliced writes work; the macOS "slower" note is moot). Slices ARE honored
   for reads and `Response` bodies. For a partial write: `await slice.arrayBuffer()` and
   write that. [probe]
2. **`size` is eager-but-CACHED/STALE** — correct before the first read (contradicting
   the docs' "not valid until read"), never refreshed after external changes; recreate
   the BunFile or `stat()`. [probe]
3. **`Bun.write` `mode` applies ONLY to file→file copies** (0o600 honored); string/
   bytes/Blob writes ignore it (0644 under umask 022). [probe]
4. **A bare `ReadableStream` is NOT a `Bun.write` source** — stringified to
   `"[object ReadableStream]"` despite the reference listing it; wrap in
   Response/Request or pipe to a writer(). [probe]
5. `Bun.file(bytes)` is **bytes-as-path**, not contents ([official] + [probe]); NUL
   bytes → TypeError. No in-memory BunFile exists — use `new Blob()`/`new File()`.
6. `exists()` is false for **directories** (means "regular file or FIFO", not "path
   exists") and does a syscall; `delete()` on a directory → EPERM ([official] + [probe]).
7. Missing files: `size 0`, MIME still inferred from extension, `exists()` false; every
   read/stat/delete/unlink rejects `ENOENT` (incl. `stream()`'s first read) ([probe]).
8. `Response(BunFile)` on 1.4.0 emits **no ETag/Last-Modified**; served through
   `Bun.serve` it adds Content-Length and answers **Range (206)** — a SLICED body is
   served as 206 PARTIAL CONTENT ([probe]).
9. `formData()` needs `multipart/form-data` or `application/x-www-form-urlencoded`
   type; otherwise throws `Invalid encoding` ([official] + [probe]).
10. `type` override works but charset-suffix behavior varies by value:
    `application/json` → `application/json;charset=utf-8`; `text/custom` → `text/custom`
    ([probe]) — the reference docstring "Not yet implemented" is stale.
11. fd-constructed BunFiles have `name === undefined` ([probe]).
12. `BunFile` has **no `.blob()` method on 1.4.0** — MIME lives on `.type`; wrap
    `file.bytes()` in `new Blob([...])` when a Blob is required (e.g. `Bun.XML.parse`)
    ([probe]; see `src/lib/odds-tile.ts`).
13. `Bun.Archive` archives a **BunFile value as a 0-byte entry** — silent data loss; use
    string/Buffer content ([repo] P19, pinned in AGENT-PITFALLS).
14. `slice()` with **negative begin returns ""** — no Blob-style negative indexing;
    validate offsets ([probe]).
15. `Bun.stdin/stdout/stderr`: `size === Infinity`, `type` `application/octet-stream`,
    `name` undefined — don't branch on their `size` ([probe]).
16. `file.write()` after `file.delete()` writes to the removed inode and vanishes
    ([probe]) — reopen the file.
17. MIME inference quirks: `.rs` → `application/rls-services+xml` (bug); `.py`/`.go`/
    `.rb`/`.jsonl`/`.ipynb` → `application/octet-stream`; `chemical/x-<ext>` for
    unknown-but-known extensions; pass an explicit `type` when serving code files
    ([probe], full table above).
18. `Bun.write` **`createPath` defaults to `true`** (parent dirs created); pass
    `{ createPath: false }` for strict no-create ([probe] + [official]).
19. FileSink: `write()` returns a sync byte count but **nothing is on disk until the
    next tick or `flush()`/`end()`**; an open sink does **NOT keep the process alive**
    on 1.4.0 (guide's claim is wrong; `ref()`/`unref()` only matter for FIFOs & pipes)
    ([probe]).
20. `FileBlob` does **not exist at runtime** — types-only marker; use `BunFile` (see
    naming section) ([probe] + [types]).

## Official references (fixed URLs)

- Guide (canonical): <https://bun.com/docs/runtime/file-io> — anchors:
  `#reading-files-bun-file` · `#writing-files-bun-write` · `#deleting-files-file-delete` ·
  `#incremental-writing-with-filesink` (verified live, HTTP 200).
- API reference: <https://bun.com/reference/bun/file> · <https://bun.com/reference/bun/write> ·
  <https://bun.com/reference/bun/BunFile> (methods: write, slice, writer, exists, unlink,
  delete, stat, text, json, bytes, arrayBuffer, stream, formData, image) ·
  <https://bun.com/reference/bun/FileBlob> (identical interface).
- Guides: <https://bun.com/docs/guides/http/stream-file> · docs index
  <https://bun.com/docs/llms.txt>.
- **Dead/stale URLs:** `bun.com/docs/runtime/api` and `bun.com/docs/runtime/bun-write`
  are 404; the old `/docs/api/*` scheme 308-redirects or 404s (now gated by
  `ground:check`). `bun.com/docs/runtime/binary-data` is still LIVE (200) but the File
  I/O content lives on the file-io page. Reference paths are FLAT:
  `/reference/bun/BunFile`, never `/reference/bun/Bun.*`.

## Repo usage map

- `src/lib/odds-tile.ts` — `loadOddsInput` (path → `file.bytes()` → `new Blob([...])` for
  `Bun.XML.parse`); `writeTile` (png → `Bun.write`, webp/jpeg → `new Bun.Image(png)`);
  `writeTilePyramid` (`mkdirSync` + `writeTile` per format under `root/<z>/<x>/<y>.`<ext>,
  default png + webp) + `tilePath` — powers `bun run tile <z> <x> <y> --feed=…`
  (default both formats; `--png`/`--webp`/`--format=` pick one).
- `src/lib/brand-image.ts` — `readImageMeta` / `decodeImage` / `convertImageFile`;
  `brandSwatchPng` (solid-color PNG encoder).
- `tools/fs-probe.ts` — P1–P19 pinned facts (MIME, missing-file, truncation, delete, mmap,
  Archive 0-byte).
- `src/research/serve.ts` & routes — `Response(BunFile)` bodies for reports/evidence.

## Verification log

- All [probe] facts: run in this session against `bun --version` = 1.4.0 (34cbb9a40),
  macOS arm64; scratch probes in `/tmp` (not committed).
- [official] facts: pages fetched live (HTTP 200) and read in full — guide, `/reference/bun/`
  `file`, `write`, `BunFile`, `FileBlob`, `BunFile/writer`.
- [repo] facts: `tools/fs-probe.ts` P# and `docs/AGENT-PITFALLS.md` sections (pinned on
  1.4.0).

> Research-agent pass: **merged**. A subagent independently read the bun.com reference
> + guides (15 URLs, incl. the live binary-data page, the FileSink reference page and
> the bun source at tag bun-v1.4.0 = the installed revision) and cross-checked every
> claim on the runtime. Its four high-impact findings — `Bun.write(dest, slicedFile)`
> ignores the slice, `size` is cached/stale, a bare `ReadableStream` is stringified,
> and an open FileSink does NOT keep the process alive — were independently
> re-verified in this session and are folded into the gotchas below.
