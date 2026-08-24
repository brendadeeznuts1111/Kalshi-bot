# public/videos — served with Range/seek support

Drop video files here (e.g. `brand-card.mp4`, `demo.webm`) and they are
served at `/videos/<name>` by the Bun.serve dir route:

- **Range requests** → `206 Partial Content` + `Content-Range`/`Content-Length`
  automatically (bun-v1.4 range-and-conditional-requests) — `<video>` seeking
  and scrubbing work out of the box.
- **Zero-copy streaming** via `sendfile(2)` — no manual buffering.
- **Content-Type** set from the extension (`video/mp4`, `video/webm`, …).
- Conditional requests (`If-None-Match`/`If-Modified-Since`) → `304` handled.

The `/videos` page lists and plays them (branded shell).

⚠️ Never reference these with a relative `<video src="./demo.mp4">` inside an
HTML-import page (e.g. hq-app/index.html) — Bun's bundler inlines small
assets as `data:` URLs. Always use the route path `/videos/<name>`.
