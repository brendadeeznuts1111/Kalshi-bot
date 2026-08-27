# Binary media + metadata integration (Bun) — verified reference

**Status:** probe-verified on bun 1.4.0, cross-checked against EVERY authoritative
source (see §8): runtime probes · `bun-types` 1.4.0 (the API reference) · docs
guides (runtime/image.md, runtime/webview.md) · the bun repo's own test suite
(`test/js/bun/image/*`, `test/js/bun/webview/*`) · the bun repo's benchmarks
(`bench/image/bench-resize.mjs`, `visual-compare.mjs`). Legend: ✅ verified ·
❌ wrong · ⚠️ works but needs nuance · 📋 repo-aspirational.

## 1. Bun.concatArrayBuffers — ✅ verified

Named export from `"bun"` and `Bun.concatArrayBuffers` (same function).
Signature (`bun-types` 1.4.0):

```ts
function concatArrayBuffers(
  buffers: Array<ArrayBufferView | ArrayBufferLike>,
  maxLength?: number, // not in the docs summary — caps output length
): ArrayBuffer;
```

Probe evidence:

| Input | Result |
| --- | --- |
| `[3-byte, 2-byte]` | 5 bytes, order preserved `[1,2,3,4,5]` |
| single buffer / empty array | 3 / 0 bytes |
| `Uint8Array` / `Buffer` views | accepted (inputs may be views, not just `ArrayBuffer`) |
| `maxLength: 5` | **truncates** to first 5 bytes; `maxLength: 0` → 0 bytes |

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
| Bun repo tests (`test/js/bun/image/*`, 2943 lines; `test/js/bun/webview/*`) | filters, quality, Response(img), maxPixels, headless:false throws, navigate, shmem via FFI | ✅ |
| Bun repo benchmarks (`bench/image/bench-resize.mjs`, `visual-compare.mjs`) | API surface: metadata/resize/fit/jpeg/webp | ✅ |

The discrepancies in this session were never local-staleness — they were in the
**claim blocks**: phantom APIs (`BUN_CONSOLE_DEPTH`, `isTerminal`,
`Database.reserve`, `Bun.spawn` dispose, `view.goto`) are absent from every
source; verified APIs match everywhere.

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

**Docs:** https://bun.com/docs/api/utils#concatarraybuffers · https://bun.com/docs/runtime/image · https://bun.com/docs/runtime/webview
