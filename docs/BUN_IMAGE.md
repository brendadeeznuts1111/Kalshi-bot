# Bun.Image — verified reference (Bun 1.4.0)

**Source:** [runtime/image.md](https://bun.com/docs/runtime/image) ·
probe-verified on bun 1.4.0 (macOS arm64). Legend: ✅ verified · ⚠️ nuance ·
📋 docs-sourced (not triggerable on this machine).

Chainable decode → transform → encode pipeline (Sharp-shaped). Nothing runs
until a terminal (`bytes`/`buffer`/`blob`/`toBase64`/`dataurl`/`write`) is
awaited; work runs off the JS thread.

## 1. Input & metadata — ✅

`new Bun.Image(path | bytes | Blob | BunFile | S3File)`, plus shorthands
`Bun.file(p).image()` and `Blob#image()` — all probe-passed. Format is sniffed
from bytes (extension/Content-Type ignored).

```ts
const { width, height, format } = await new Bun.Image(input).metadata();
// verified: 200x100 png → { width: 200, height: 100, format: "png" }
```

## 2. Resize — ✅ all variants verified

| Call | Result (200x100 source) |
| --- | --- |
| `resize(800)` | 800x400 (width, aspect kept) |
| `resize(800, 600)` | 800x600 (stretch) |
| `resize(800, 600, { fit: "inside" })` | 800x400 (inside box) |
| `resize(800, 600, { withoutEnlargement: true })` | 200x100 (never upscaled) |
| `resize(800, 600, { filter: "mitchell" })` | 800x600 |

All nine filter names accepted: `lanczos3` (default), `lanczos2`, `mitchell`,
`cubic`, `mks2013`, `mks2021`, `bilinear`/`linear`, `box`, `nearest`.
The JPEG IDCT-skip behavior (≤half-size thumbnails never decode full
resolution) is 📋 docs-sourced — internals not observable from the API.

## 3. Rotate / flip / flop / modulate — ✅

- `rotate(90)` swaps dimensions (verified 200x100 → 100x200); `rotate(180)`
  keeps them. **Only multiples of 90** — `rotate(45)` throws
  `"rotate: only multiples of 90 are supported"` (probe).
- `flip()` (vertical) / `flop()` (horizontal) — no-throw, dims unchanged.
- `modulate({ brightness, saturation })` — verified (0 saturation = greyscale).

## 4. Output formats — ✅ all six verified on macOS

`jpeg({ quality })`, `png({ compressionLevel })`,
`png({ palette: true, colors: 64, dither: true })` (indexed — verified, ~3-5×
smaller output), `webp({ quality })` / `webp({ lossless: true })`,
`heic({ quality })`, `avif({ quality })` — all encoded and re-decoded with
correct `format` on this arm64 macOS (AVIF encode requires an OS AV1 encoder —
M3+ per docs; Intel/M1/M2 rejects). `jpeg({ progressive: true })` accepted.

**HEIC/AVIF are macOS/Windows-only.** On unsupported systems the terminal
rejects with `error.code === "ERR_IMAGE_FORMAT_UNSUPPORTED"` — 📋 docs-sourced
(not triggerable on macOS); branch on it to fall back to WebP/JPEG.

## 5. Terminals — ✅ verified

| Terminal | Result |
| --- | --- |
| `bytes()` | `Uint8Array` |
| `buffer()` | `Buffer` |
| `blob()` | `Blob` with correct MIME (verified `image/webp` for webp output) |
| `toBase64()` | base64 string (no header) |
| `dataurl()` | `data:image/webp;base64,…` (verified prefix) |
| `write(path)` | number = bytes written (verified: file size matches `blob().size`) |
| `write(Bun.s3.file(...))` | S3 destination (not probed — no S3 creds) 📋 |

After a terminal, `img.width`/`img.height` reflect the **output** dimensions
(verified 400x200 after `resize(400)`); they are `-1` before.

## 6. Placeholders — ✅

`Bun.file("hero.jpg").image().placeholder()` → a `data:image/png;base64,…`
URL (ThumbHash ≤32px blur). Verified: 1342 chars on the 200x100 source — the
"~400–700 bytes" figure is approximate and source-dependent.

## 7. Bun.serve routes — ✅ verified

`routes: { "/avatar/:id": async req => … }` works on 1.4.0: `req.params.id`
extracts the segment (probe: `/avatar/abc123` → `"abc123"`), and a
`Response(await img…blob())` sets `Content-Type` from the blob (`image/webp`).
Await the terminal first to keep the encode off the JS thread.

## 8. Clipboard — ✅

`Bun.Image.fromClipboard()` → `Image | null`. Verified `null` with an empty
clipboard; always `null` on Linux per docs (use `wl-paste`/`xclip`).

## 9. Backends — ✅

`Bun.Image.backend` defaults to `"system"` on macOS; assigning `"bun"` (the
portable Highway path — for golden-image tests) works and the pipeline still
runs (verified); restore `"system"` after.

## 10. Verification summary

| Claim | Verdict |
| --- | --- |
| metadata() width/height/format | ✅ |
| resize single-arg / stretch / inside / withoutEnlargement / filter | ✅ |
| All 9+2 filter names | ✅ |
| rotate 90° swaps dims; multiples of 90 only | ✅ |
| flip / flop / modulate | ✅ |
| jpeg / png / indexed png / webp / heic / avif / progressive jpeg | ✅ (macOS) |
| Terminals: bytes/buffer/blob/toBase64/dataurl/write | ✅ |
| write() returns bytes written | ✅ |
| width/height post-terminal | ✅ |
| placeholder() data URL | ✅ |
| serve routes ":id" param + auto Content-Type | ✅ |
| fromClipboard() null when empty | ✅ |
| backend = "bun" toggle | ✅ |
| ERR_IMAGE_FORMAT_UNSUPPORTED fallback | 📋 (macOS: everything works) |
| JPEG IDCT-skip decode | 📋 |

## 11. Deeper verification (probe-locked beyond the docs)

### Guards & errors

- **Decompression bomb:** `{ maxPixels: 100 }` on a 20 000-pixel input →
  rejects with `ERR_IMAGE_TOO_MANY_PIXELS` ("input exceeds maxPixels limit").
  Default limit is ~268 MP per docs.
- **Garbage input:** non-image bytes → `ERR_IMAGE_UNKNOWN_FORMAT`
  (distinct from `ERR_IMAGE_FORMAT_UNSUPPORTED`, which is for unsupported
  *system* formats).
- **Invalid `filter`** throws at **chain time** (before any terminal):
  `"filter must be one of 'box', 'bilinear', 'linear', 'lanczos3', …"`.
- **`quality` is not range-validated** — `0` and `101` are silently
  accepted (libjpeg clamps). ⚠️
- **`SharedArrayBuffer` / resizable `ArrayBuffer` input is refused**:
  `"resizable / shared ArrayBuffer is not supported"` — pass `buf.slice()`.

### EXIF auto-orient (crafted Orientation=6 JPEG, verified)

- `metadata()` reflects EXIF orientation **by default** (a 200x100 JPEG with
  Orientation=6 reports 100x200).
- `autoOrient: true` (the default): `resize(800)` → 800x1600 (rotate first).
- `autoOrient: false`: `resize(800)` → 800x400 (raw geometry).

### Lazy / reuse semantics

- `width`/`height` are `-1` until a terminal runs; then they reflect output
  dims.
- **Concurrent terminals** on one pipeline both work (`Promise.all` of
  `.png().bytes()` + `.webp().bytes()` on the same image).
- **Chains are independent**: `img.resize(100)` then `img.resize(200)` from
  the same base produce 100x50 and 200x100 — `resize` does not mutate the base.
- **`new Response(img)` directly** works — sets `Content-Type` from the
  pipeline's output format (verified `image/webp`).
- **`write(fd)`** works (node fd accepted).

### Binary-level format checks

- `jpeg({ progressive: true })` output contains the **SOF2 (0xC2)** marker;
  baseline `jpeg()` contains SOF0 (0xC0) and no SOF2.
- `png({ palette: true })` emits **color-type 3 (indexed)**, bit depth 8;
  plain `png()` emits **color-type 6 (RGBA)** — verified by parsing IHDR.

### Clipboard full path

- `clipboardChangeCount()` is a live counter (moves when the pasteboard
  changes: 5763 → 5764 after a copy).
- `hasClipboardImage()` / `fromClipboard()` return false/null when the
  pasteboard holds no image type (**`pbcopy` stores text, not an image**).
- With a real image on the pasteboard (`osascript` PNG class): `hasClipboardImage()
  ` → true, `fromClipboard()` → Image with correct metadata (200x100 png).

### Performance (200x100 source, 50 ops)

| Pipeline | ms/op |
| --- | --- |
| `metadata()` (header only) | 0.022 |
| decode + `resize(800)` + `jpeg` | 0.67 |
| decode + `resize(800)` + `webp` | 8.0 |
| decode + `resize(800)` + `png` | 13.5 (PNG encode dominates) |
| `placeholder()` | 0.42 |

PNG encode is the expensive terminal on this fixture; JPEG is the cheap one.

**Docs:** https://bun.com/docs/runtime/image · ThumbHash https://evanw.github.io/thumbhash/
