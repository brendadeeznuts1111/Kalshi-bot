One parser, every source. Wire feeds, the 38-book registry config, and reference fixtures all parse through `Bun.XML.parse` — string, Blob, Buffer, or Uint8Array. SIMD-backed, zero hand-rolled XML in the repo.

Probed: a bare `BunFile` is rejected — ingest wraps bytes in a `Blob` first (`xml-feed.test`: Blob input parses identically to string).

## Compact shape → domain split

Attributes surface as `@keys`, repeated children as arrays, singleton collapse guarded by `asArray`. The wire split:

- `venue="lat,long"` → the event's location (range-guarded ±90/±180)
- `book="key"` → the bookmaker quoting the print
- teams + commence → the match-derived event id (`alpha-fc-vs-beta-fc-2026-09-01`)

## Failure surface

Unparseable prints drop; malformed/out-of-range coordinates attach no location; identity-less clusters stay standalone `event` placeholders. The report degrades per row — never a 500.

Escape contract: every feed-derived cell goes through `escapeMarkdownCell` before markdown assembly, and HTML rendering uses the `strict` preset (`tagFilter` + `noHtmlBlocks` + `noHtmlSpans`) — hostile wire input renders inert.
