One parser, every source. Wire feeds, the 38-book registry config, and reference fixtures all parse through `Bun.XML.parse` — string, Blob, Buffer, or Uint8Array. SIMD-backed, zero hand-rolled XML in the repo.

Probed: a bare `BunFile` is rejected — ingest wraps bytes in a `Blob` first (`xml-feed.test`: Blob input parses identically to string).

## The source ladder (numbered)

1. **Live** — `connectAllBookmakers` fans out per registry book; per-book results merge by match identity; provenance stamped `live`.
2. **Reference feed** — `public/registry/odds-reference.xml` (three matches, two venues); provenance `simulated`.
3. **`declarations_only`** — capacity + structure render with empty tables.

## Compact shape → domain split

Attributes surface as `@keys`, repeated children as arrays, singleton collapse guarded by `asArray`. The wire split:

- `venue="lat,long"` → the event's location (range-guarded ±90/±180)
- `book="key"` → the bookmaker quoting the print
- teams + commence → the match-derived event id (`alpha-fc-vs-beta-fc-2026-09-01`)

## Failure surface

Unparseable prints drop; malformed/out-of-range coordinates attach no location; identity-less clusters stay standalone `event` placeholders. The report degrades per row — never a 500.

Escape contract: every feed-derived cell goes through `escapeMarkdownCell` before markdown assembly, and HTML rendering uses the `strict` preset (`tagFilter` + `noHtmlBlocks` + `noHtmlSpans`) — hostile wire input renders inert.

```bash
# the whole wire contract, as one query against the parser
bun -e 'console.log(Bun.XML.parse(`<odds-heat cluster venue="51.5074,-0.1278" book="bet365"><print american="-110"/></odds-heat>`))'
```
