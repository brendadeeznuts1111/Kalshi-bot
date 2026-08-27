# Binary media + metadata integration (Bun) — verified reference

**Status:** probe-verified on bun 1.4.0, cross-checked against EVERY authoritative
source (see §8): runtime probes · `bun-types` 1.4.0 (the API reference) · docs
guides (runtime/image.md, runtime/webview.md) · the bun repo's own test suite
(`test/js/bun/image/*`, `test/js/bun/webview/*`) · the bun repo's benchmarks
(`bench/image/bench-resize.mjs`, `visual-compare.mjs`). Legend: ✅ verified ·
❌ wrong · ⚠️ works but needs nuance · 📋 repo-aspirational.

## 1. Bun.concatArrayBuffers — ✅ verified

Named export from `"bun"` and `Bun.concatArrayBuffers` (same function).
Signature (`bun-types` 1.4.0) — three overloads:

```ts
function concatArrayBuffers(
  buffers: Array<ArrayBufferView | ArrayBufferLike>,
  maxLength?: number,
  asUint8Array?: false,
): ArrayBuffer;
function concatArrayBuffers(
  buffers: Array<ArrayBufferView | ArrayBufferLike>,
  maxLength: number,
  asUint8Array: true,
): Uint8Array;
```

Probe evidence:

| Input | Result |
| --- | --- |
| `[3-byte, 2-byte]` | 5 bytes, order preserved `[1,2,3,4,5]` |
| single buffer / empty array | 3 / 0 bytes |
| `Uint8Array` / `Buffer` views | accepted (inputs may be views, not just `ArrayBuffer`) |
| `maxLength: 5` | **truncates** to first 5 bytes; `maxLength: 0` → 0 bytes |
| `asUint8Array: true` | ✅ returns a **`Uint8Array`** (verified `[1,2,3,4,5]`) |
| `maxLength + asUint8Array: true` | ✅ truncates AND returns Uint8Array (`[1,2,3,4]`) |

⚠️ The 3-arg overload declares `maxLength: number` — the common example
`concatArrayBuffers(chunks, undefined, true)` runs but is a **type error**
(needs a number; use the 2-arg form or pass a real limit).

### Performance (100 x 1 MB = 100 MB, measured)

| Approach | ms | vs concatArrayBuffers |
| --- | --- | --- |
| `concatArrayBuffers(chunks, undefined, true)` | 11.3 | 1.0× |
| `Buffer.concat` | 22.5 | **0.5×** (cab ~2× faster — the "~30%" claim is conservative) |
| manual single-pass loop (`new Uint8Array(total)` + `set()`) | 3.9 | **2.9× faster than cab** |
| `Blob` → `arrayBuffer()` | 46.0 | 0.25× |

- ❌ "~30% faster than **manual loops**" — measured **slower**: a hand-rolled
  single-pass loop is ~3× faster on 100 MB. `concatArrayBuffers` beats
  `Buffer.concat` (≈2×) but is not the fastest primitive.
- ⚠️ "zero-copy / no intermediate copies" — it is **one-copy** (each chunk
  copied into the result, same as a manual loop); nothing is zero-copy.
- ❌ **`Bun.terminal` does not exist on 1.4.0** — the example's
  `Bun.terminal.write(payload)` would throw; use `process.stdout.write()`
  or `Bun.stdout.write()`.
- "The Odds Heat pipeline uses it for MP4/terminal" — 📋 no `concatArrayBuffers`
  usage exists in the repo (grep: zero hits); aspirational.

## 2. Named `Image` / `WebView` imports — ✅ real

`import { Image, WebView, concatArrayBuffers } from "bun"` resolves and is
**identical** to `Bun.Image` / `Bun.WebView` (probe: `Image === Bun.Image` →
`true`). (Contrast: the phantom `isTerminal` export does not exist anywhere.)

## 3. WebView text-overlay pattern — ⚠️ one API name is wrong

The headless-render-text-then-Bun.Image pattern is valid, with one correction
confirmed by **every** source (docs ×8+ uses, types, bun repo
`webview.test.ts`, runtime):

- ✅ `new WebView({ headless: true, width, height })` — valid; `headless: false`
  **throws not-implemented** (bun repo test: "headless: false throws
  NOT_IMPLEMENTED"; types: "Only `true` (headless) is implemented. @default true").
- ❌ **`view.goto(url)` does not exist in any source** — the method is
  **`view.navigate(url)`** (docs, types, bun tests; zero `goto` references).
  The claim's code as written throws `view.goto is not a function`.
- ✅ `view.screenshot()`, `view.close()`, `new Image(blob)`,
  `img.webp({ quality }).blob()` — probe-verified (see BUN_WEBVIEW.md,
  BUN_IMAGE.md). Screenshots open windows — probe-only, not committed tests.

```ts
const view = new WebView({ headless: true, width: 256, height: 256, url });
await view.navigate(`data:text/html,${encodeURIComponent(html)}`); // not goto
const png = await view.screenshot();
await view.close();
const out = await new Image(png).webp({ quality: 80 }).blob();
```

## 4. MP4 custom-atom embedding — ⚠️ the primitive is right, the box isn't

`concatArrayBuffers` is the right primitive for assembling bytes, but the
example's `concatArrayBuffers([videoBuffer, atom])` **appends a `meta` box
after the end of the MP4** — a compliant ISO BMFF parser reads boxes from the
top-level box structure; a trailing orphan box is not parsed as file metadata.
A real embed needs the box inside the structure (e.g. inside `moov`) with
correct sizes. Treat the example as illustrative byte-assembly, not a working
metadata embed.

## 5. EXIF/XMP into PNG/WebP — ⚠️ "append" is imprecise

✅ "Bun.Image doesn't support writing EXIF" — true (verified: read-side
`autoOrient` only, no EXIF writer). Manually: for PNG the EXIF chunk
(`eXIf`) must be inserted **before the `IEND` chunk** (IEND is last by
spec); for WebP it's an `EXIF` chunk in the RIFF structure. Appending bytes
at EOF works for neither format.

## 6. Bun.Image capability ground-truth

No text rendering, no EXIF writing, **no raw-pixel constructor**
(`new Bun.Image(bytes, { width, height })` builds an invalid image — the
repo's `src/lib/odds-tile.ts` documents this and hand-encodes PNGs via
zlib+CRC32). The bun repo's own tests never construct from raw pixels, and the
benchmarks use exactly the verified surface
(`new Bun.Image(buf).resize(...).jpeg({ quality }).bytes()`).

## 7. Repo reality — the visual pipeline is partially real

| Claim block output | In this repo? |
| --- | --- |
| Heatmap tile with WebView text overlay | ❌ — `src/lib/odds-tile.ts` exists but renders a **solid color tile** (consensus → color → hand-encoded PNG, `renderTile`/`rgbaPng`); zero WebView/text usage (grep-verified) |
| OG image (1200×630) | ❌ no og-image code |
| Leadership / arbitrage / time-lapse MP4 | ❌ no ffmpeg/mp4 code |
| HTTP `X-*` metadata headers on `Response` | ✅ trivially works (standard Response headers) |

The metadata tables in the source are accurate for the **data layer** (the
repo's SQLite schema) but the **visual** half is aspirational beyond the
existing odds-tile.

## 8. Cross-source audit — the local repo is NOT stale

"Maybe the local repo is wrong" — checked. Every claim was reconciled against
ALL of these and they agree with each other and the runtime:

| Source | Checked | Agrees? |
| --- | --- | --- |
| Runtime probes (bun 1.4.0 installed) | this session's probes | ✅ |
| `bun-types` 1.4.0 (= bun.com/reference source) | screenshot/Image/WebView/concatArrayBuffers decls | ✅ |
| Docs guides (`runtime/image.md`, `runtime/webview.md`) | navigate/headless/EXIF/constructor inputs | ✅ |
| Bun repo tests (ran `test/js/bun/image/*` 195/195 + `webview.test.ts` 59/60 pass on installed 1.4.0; grepped the contested tokens) | filters, quality, Response(img), maxPixels, headless:false throws, navigate, shmem via FFI | ✅ (ran + token-grepped, not a line-by-line read) |
| Bun repo benchmarks (`bench/image/bench-resize.mjs`, `visual-compare.mjs`) | API surface: metadata/resize/fit/jpeg/webp | ✅ |

The discrepancies in this session were never local-staleness — they were in the
**claim blocks**: phantom APIs (`BUN_CONSOLE_DEPTH`, `isTerminal`,
`Database.reserve`, `Bun.spawn` dispose, `view.goto`) are absent from every
source; verified APIs match everywhere.

### Ran the bun repo (main, sparse clone, installed bun 1.4.0)

Per the audit request, the bun repo's own code was pulled and executed:

- **`test/js/bun/image/*` — 195/195 tests pass** on installed 1.4.0 (97
  `image.test.ts` + 98 adversarial/kernels): clipboard statics, backend parity,
  the HEIC gap, filters, quality, `Response(img)` Content-Type, maxPixels.
- **`test/js/bun/webview/webview.test.ts` — 59 pass / 1 todo / 0 fail**:
  `navigate` (zero `goto` anywhere), `headless: false` throws NOT_IMPLEMENTED,
  screenshot `shmem` read via FFI — all matching this doc's verdicts.
- **`bench/image/bench-resize.mjs --sharp` (sharp 0.35.4)**: Bun.Image beats
  sharp on every op — metadata 0.01×, PNG→jpeg 0.66–0.84×, PNG→webp 0.79×,
  JPEG→jpeg 0.49–0.92×, 4K→1920 0.49×, webp encodes 0.89–0.96× (ΔRSS ≈).
- **Runtime probe**: `view.goto === undefined`; `view.navigate` is the method.

## 9. Summary

| Claim | Verdict |
| --- | --- |
| `Bun.concatArrayBuffers` combines binary chunks | ✅ (+`maxLength` truncation) |
| `import { Image, WebView } from "bun"` | ✅ identical to `Bun.*` |
| `new WebView({ headless: true })` | ✅ valid; `headless: false` throws |
| `view.goto(url)` | ❌ **use `view.navigate(url)`** |
| screenshot → new Image → webp().blob() | ✅ |
| Bun.Image text rendering / EXIF write / raw-pixel ctor | ✅ absent (no such API in any source) |
| MP4 custom atom via concatArrayBuffers | ⚠️ primitive OK; trailing box not valid BMFF |
| EXIF "append" to PNG | ⚠️ must be a chunk before IEND |
| Repo has WebView-text heatmaps / videos | 📋 aspirational (only odds-tile exists) |

## 10. MP4 serving (Range/206), markdown & YAML — verified

### Serving video with Range / 304

- **Range/206 is AUTOMATIC** for any `BunFile` body — zero manual code. Verified
  on a 200 KB MP4: `Range: bytes=0-99` → `206`, `Content-Range: bytes
  0-99/204800`, exactly 100 bytes. The repo's `/videos` route
  (`src/research/video-page.ts`) relies on this.
- ⚠️ **304 is NOT automatic** — Bun emits no `ETag` for file responses
  (verified: `etag: null`), so `If-None-Match` → 304 requires you to set the
  `ETag` and check the header yourself. The repo's content pipeline does
  exactly that (`hashing-page.ts`: "ETag = quoted hash; `If-None-Match` ->
  304 (notModified helper)"). Verified: manual ETag + `If-None-Match` match →
  `304`.
- ⚠️ `Accept-Ranges` is not set automatically (verified `null` on the 200
  response) — browsers still send `Range`, but set it explicitly if you want
  the advertised header.

### Markdown & YAML parsing — ✅ both native on 1.4.0

- **`Bun.markdown`**: methods `html`, `ansi`, `render`, `react` (verified).
  `Bun.markdown.html("# Hello **world**")` → `<h1>Hello <strong>world</strong></h1>`;
  `render` returns plain text; `react` returns a component (function). The
  repo already uses it: `src/lib/markdown-images.ts` (render + html),
  `markdown-headings.ts` (`{ headings: { ids: true } }`), `assets-audit.ts`
  (image callback).
- **`Bun.YAML`**: `import { YAML } from "bun"` and `Bun.YAML` — `parse` and
  `stringify` verified (round-trip `a: 1, b: [1,2]`). The repo does not use
  `Bun.YAML` yet (frontmatter is hand-rolled in `content-pipeline.ts`).

### Repo reality: "Odds Heat" is not an MP4 pipeline

`"odds-heat"` is the **XML root element** of the odds feed parsed by
`src/lib/odds-tile.ts` (`root = "odds-heat"`) — it powers the **tile**
pipeline (consensus → color → PNG), not an MP4 pipeline. The repo has **no MP4
generation code** (no ffmpeg). Video in the repo is a static-serving route
(`/videos`, `video-page.ts`) that leans on Bun's automatic Range/206. The
i18n metadata layer in the claim (lang, YAML frontmatter, `X-Language`) is
**aspirational**: one `lang: 'en'` field exists (`booked-catalog.ts`), no
`X-Language` headers, no YAML frontmatter — frontmatter is hand-rolled and
markdown is parsed with `Bun.markdown`.

**Docs:** https://bun.com/docs/api/utils#concatarraybuffers · https://bun.com/docs/runtime/image · https://bun.com/docs/runtime/webview
