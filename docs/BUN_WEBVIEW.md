# Bun.WebView screenshot encodings — probe-verified (Bun 1.4.0)

**Source:** [runtime/webview.md](https://bun.com/docs/runtime/webview) §Return type ·
`bun-types` 1.4.0 WebView namespace · probe-verified live on macOS arm64 (WebKit
backend). Legend: ✅ verified · ⚠️ nuance · 📋 docs-sourced (not triggerable here).

WebView screenshots open a real window — verified in a one-off probe and
**deliberately not committed as `bun:test` cases** (GUI during test runs).

## 1. Screenshot surface — ✅ all four encodings verified

```ts
type ScreenshotOptions = {
  encoding?: "blob" | "buffer" | "base64" | "shmem";
  format?: "png" | "jpeg" | "webp";
  quality?: number; // 0-100, default 80, ignored for PNG
};
view.screenshot(options);
```

| Encoding | Returns | Probe result |
| --- | --- | --- |
| `"blob"` (default) | `Blob` | `image/png`, 3793 B, valid PNG magic |
| `"buffer"` | `Buffer` | 3793 B, valid PNG |
| `"base64"` | `string` | 5060 chars → decodes to the same 3793 B PNG (Kitty `t=d` path) |
| `"shmem"` | `{ name, size }` | `{ name: "/bun-webview-…", size: 3793 }` — size **matches the blob exactly** |

`format`: `"png"` (default) / `"jpeg"` / `"webp"`; `quality` 0–100, default
80, ignored for PNG (types). Verified: `format: "jpeg"` → `image/jpeg`; and
**`format: "webp"` throws `format: "webp" requires backend: "chrome"`** on the
WebKit backend (matches the types docstring exactly).

## 2. shmem — verified end-to-end (segment → read → unlink)

The returned `name` is a POSIX shared-memory segment. Verified by opening it
from a separate process (python `shm_open`/libc):

- **Name format:** `/bun-webview-<N>-<seq>` on WebKit. ⚠️ **`N` is `process.pid + 1`**
  in all four probes (42947→42948, 43014→43015, …), **not** the bun process pid;
  `seq` is a per-screenshot counter (increments per call: `-1`, `-2`).
- **Segment vs image size:** `size` is the image byte length (3135 B); the
  actual segment is page-rounded (16 384 B via `fstat`). Kitty reads exactly
  `size` bytes.
- **Content:** `mmap` → first `size` bytes → **valid PNG magic**, written to
  disk and decoded by `Bun.Image` to the exact viewport dimensions (200×100).
  The segment holds the raw encoded image, zero-copy from the renderer.
- **Caller owns cleanup — verified:** `shm_unlink(name)` succeeds and a
  subsequent `shm_open` returns `-1` (segment gone). If nothing unlinks, the
  segment leaks until process exit.
- **macOS shm caveat:** `read(2)` on the `shm_open` fd fails with `EINVAL` —
  shared memory must be `mmap`'d (standard POSIX behavior, not a Bun bug).

## 3. Kitty graphics protocol usage — ✅ shape confirmed

The escape shape in the docs and the claim block is byte-identical to the
`bun-types` docstring:

```ts
const { name, size } = await view.screenshot({ encoding: "shmem" });
process.stdout.write(`\x1b_Gf=100,t=s,a=T,S=${size};${btoa(name)}\x1b\\`);
// Kitty shm_open's the name, reads ${size} PNG bytes, unlinks.
```

`t=s` (shared memory) is the zero-pipe-copy path vs `t=d` (direct base64 data).

## 4. Platform notes

- **Windows: not supported** (docs/types) — 📋 not triggerable on macOS.
- **Chrome backend** (`/bun-chrome-<N>-<seq>` name, `webp` support, CDP-base64
  `t=d` fast path) — declared in types, not probed (no Chrome backend run) 📋.
- The repo has **no Kitty/tile-preview code** (grep: zero hits for
  kitty/ESC_G/t=d/shmem in src/tools/scripts/docs) — the "tile pipeline"
  framing in the source claim is illustrative, not repo reality.

## 5. Summary

| Claim | Verdict |
| --- | --- |
| `screenshot({ encoding: "shmem" })` → `{ name, size }` | ✅ |
| name `/bun-webview-<N>-<seq>` | ✅ (⚠️ N = pid+1, seq per call) |
| `size` = image byte length | ✅ (matches blob exactly) |
| Segment holds the raw image | ✅ (extracted + decoded to viewport dims) |
| Caller owns `shm_unlink` | ✅ (unlink → reopen fails) |
| blob / buffer / base64 encodings | ✅ |
| `webp` requires Chrome backend | ✅ (verified throw on WebKit) |
| Kitty `t=s` escape shape | ✅ (matches bun-types docstring) |
| Not on Windows | 📋 |

**Docs:** https://bun.com/docs/runtime/webview · https://bun.com/docs/runtime/webview#return-type
