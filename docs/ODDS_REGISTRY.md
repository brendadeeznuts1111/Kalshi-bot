# Odds registry (N-bookmaker capacity floor)

The odds registry is the Bun-native, N-generic acquisition surface for multi-bookmaker,
per-sport × per-market odds. It complements the sports/source registry (Kalshi +
Polymarket venues) with the bookmaker plane, and satisfies the declared capacity floor
of ≥34 bookmakers in [`config/odds-registry.xml`](../config/odds-registry.xml).

## Contract

| Layer | File | Responsibility |
|---|---|---|
| Config | [`config/odds-registry.xml`](../config/odds-registry.xml) | 38 bookmaker declarations, feeds, sports, markets; parsed with `Bun.XML.parse` (no hand-rolled XML) |
| Types | [`odds-registry/types.ts`](../src/institutions/odds-registry/types.ts) | `OddsRegistryConfig`, `OddsRegistryBookmaker`, feed-type union |
| Load | [`odds-registry/load.ts`](../src/institutions/odds-registry/load.ts) | `loadOddsRegistryConfig()`; normalizes Bun.XML singleton collapse |
| Gate | [`odds-registry/validate.ts`](../src/institutions/odds-registry/validate.ts) | ≥34 capacity floor, unique keys, known feeds, endpoint requirement for `bun-xml` |
| XML feed | [`odds-registry/xml-feed.ts`](../src/institutions/odds-registry/xml-feed.ts) | `<odds-heat>` cluster → `OddsEvent` (h2h from `<print american>`); match-derived event ids; `venue="lat,long"` location; decimal conversion |
| v3 JSON feed | [`odds-registry/odds-api-v3.ts`](../src/institutions/odds-registry/odds-api-v3.ts) | Odds API v3 name-based adapter: `/bookmakers` + `/odds` → `OddsEvent`, SQLite WAL cache, sport-slug map |
| Feed client | [`odds-registry/feed-client.ts`](../src/institutions/odds-registry/feed-client.ts) | Per-bookmaker connections driven by the `<meta>` blob (`connectBookmaker` / `connectAllBookmakers` fan-out) |
| Bookmaker store | [`odds-registry/bookmakers.ts`](../src/institutions/odds-registry/bookmakers.ts) | Venue → `BookmakerProfile` (name/feed/region, book `url` + `logo` from `<meta>`); `booksQuoting()` in wire order; undeclared venues resolve `registered:false` |
| Venue store | [`odds-registry/venue-store.ts`](../src/institutions/odds-registry/venue-store.ts) | Coordinates → identity: canonical `venueKey` (4dp), name/city/timezone, alias canonicalization, collision counts; [`config/odds-venues.json`](../config/odds-venues.json) |
| Weather | [`odds-registry/weather.ts`](../src/institutions/odds-registry/weather.ts) | `(venue coords, commence)` → `EventWeather` (Open-Meteo, no key); WMO code mapping; 10-min/negative cache; timeout-bounded |
| Report | [`odds-registry/report.ts`](../src/institutions/odds-registry/report.ts) | `OddsEvent[]` → Markdown (Matches/Consensus/Books/Value patterns/Convergence); `escapeMarkdownCell` on every feed-derived string |
| Data source | [`odds-registry/data-source.ts`](../src/institutions/odds-registry/data-source.ts) | Event-source ladder: live bookmaker feeds (`ODDS_LIVE_FEED=1`) merged by match identity → reference feed → `declarations_only` |
| Consensus history | [`odds-registry/consensus-history.ts`](../src/institutions/odds-registry/consensus-history.ts) | Per (event, side) snapshot store feeding `classifyConvergence` (movement verdicts between report builds) |
| Chips | [`odds-registry/chips.ts`](../src/institutions/odds-registry/chips.ts) | ANSI chip line per event (provenance, weather gradient, venue pin, venue-local kickoff, collision + movement badges) |
| Book logos | [`odds-registry/book-logos.ts`](../src/institutions/odds-registry/book-logos.ts) | Deterministic branded logo PNGs per book (`bun run book:logos` → `public/assets/books/`) |
| Display | [`odds-registry/display.ts`](../src/institutions/odds-registry/display.ts) | Token status card SVG + WebView-rasterized PNG (`statusCardPng`) + health summary |

The model (`OddsEvent` → `OddsBookmaker` → `OddsMarket` → `OddsOutcome`) already carries
sport × market × bookmaker × outcome, so any future acquire adapter (Odds API v3 JSON,
Fonbet WS, another XML feed) plugs into the same downstream normalize/compare pipeline.

## Why Bun-native

| Need | Bun primitive | Verified |
|---|---|---|
| Parse | `Bun.XML.parse` (string/Blob/Buffer/Uint8Array) | acceptance probes + tests |
| Rasterize | `Bun.WebView` screenshot | PNG IHDR 1200×630 verified; `Bun.Image` cannot decode SVG on 1.4.0 (probed) |
| Fetch | global `fetch` | odds-api v3 `/bookmakers` probe (no auth) |

## Surfaces

| Surface | Contract |
|---|---|
| `public/registry/odds-bookmakers.json` | Declared artifact (`odds-bookmakers/v1`), baked by `bun run odds-registry:artifact` |
| `GET /api/odds-registry` | Config + health (`ok/bookmakerCount/capacityFloor/feeds/sports`), 5s cache |
| `GET /api/odds-vs-venues` | Per-sport consensus table: bookmaker capacity vs Kalshi/Polymarket declared coverage (`odds-vs-venues/v1`) |
| `GET /api/odds-value-patterns` | Value-pattern detector surface (`odds-value-patterns/v1`); `declarations_only` until a live adapter feeds `OddsEvent[]` |
| `GET /api/odds-report` | Odds Heat report — `text/markdown` (default) or `?format=html` (widget page); wired to the reference feed via `Bun.XML.parse`; sha-256 ETag/304; 5s cache |
| `bun run odds:report <feed> [--plain]` | ANSI chip line per event (provenance / weather / venue / kickoff / movement); `--plain` strips ANSI |
| `bun run book:logos [--force]` | Bake branded book logo PNGs for every registry book (idempotent) |
| `GET /status.svg` | Token status card (green/red + counts) for OG scrapers and embeds |
| `bun run odds-registry:status --json` | CLI health/JSON view |
| `bun run odds:sync --sport=X [--db=...] [--local] [--dry-run]` | Fan out to every book's feed (registry meta), cache WAL, run value + convergence on cached events; `--local` substitutes the reference feed for offline runs |
| `bun run odds-registry:status --out=FILE` | CLI status-card PNG (WebView) |

## Operate

```bash
bun run odds-registry:artifact   # bake + gate public/registry/odds-bookmakers.json
bun run odds-registry:status     # render public/registry/status.png (WebView)
bun run odds-registry:status --json
bun test tests/institutions/odds-registry/
```

## Add a bookmaker

1. Pick a feed (`odds-api-v3`, `fonbet-ws`, or `bun-xml`); the feed is the adapter contract.
2. Add one `<bookmaker key name feed region markets>` element with its `<sport key/>` children.
3. For `bun-xml`, declare the XML `endpoint` — the feed adapter parses `<odds-heat>` clusters.
4. Re-run `odds-registry:artifact` (gate asserts the ≥34 floor) and the test suite.

The floor is a minimum, not a ceiling: the config already declares 38 bookmakers and the
pipeline is N-generic, so scaling past 34 is additive, not structural.

## Per-bookmaker meta blob

The registry XML is the SSOT for *how to reach each book*. Every `<bookmaker>`
may carry a `<meta>` block — feed-specific connection details, normalized by
`Bun.XML.parse` into a `Record<string, string>` (each child element → key/`#text`;
`@key`/`@value` attributes override the tag name):

```xml
<bookmaker key="bet365" name="Bet365" feed="odds-api-v3">
  <sport key="soccer_epl"/>
  <meta>
    <v3-name>Bet365</v3-name>        <!-- wire name for the v3 /odds query -->
    <api-key-ref>ODDS_API_KEY</api-key-ref>  <!-- env var holding the key -->
    <url>https://www.bet365.com</url>  <!-- book homepage (bookmaker store / report) -->
    <logo>/assets/books/bet365.png</logo>  <!-- logo asset (bookmaker store / report) -->
  </meta>
</bookmaker>
```

`connectBookmaker(cfg, key, sport, opts)` reads **only** that blob and fetches
that one book's feed through its own adapter (xml via `parseOddsXmlEvents`,
json via `fetchV3Odds`, ws validated against `ws-url`/`auth-key-ref`) — one
book, one feed, one connection. `connectAllBookmakers` fans out N-generic with
per-book failure isolation (one dead feed never suppresses the rest). The v3
names are pinned live against `/bookmakers`: all 36 registry names resolve to
active books.

## Odds-heat wire contract (event / venue / book domains)

```xml
<odds-heat>
  <cluster venue="51.5074,-0.1278" book="bet365" commence="2026-09-01T19:00:00Z">
    <home team="Alpha FC"/><away team="Beta FC"/>
    <print name="Alpha FC" american="-200"/><print name="Beta FC" american="+150"/>
  </cluster>
</odds-heat>
```

Three domains, never conflated:

| Domain | Identity | Where it lives |
|---|---|---|
| **Event** | The match: teams + commence date → `alpha-fc-vs-beta-fc-2026-09-01` | `OddsEvent.id` (branded `FeedEventId`) |
| **Venue** | `venue="lat,long"` — where the match is played (range-guarded ±90/±180) | `OddsEvent.location` + the venue store |
| **Book** | `book="key"` — the bookmaker quoting the print | `bookmakers[]` key/title + the bookmaker profile store |

Rules the parser enforces (`xml-feed.ts`):

- Clusters sharing match identity (commence + named teams) merge into ONE event with one
  bookmaker entry per `book` — multi-book consensus forms from a single feed.
- Identity-less clusters (placeholder `Home`/`Away`, time 0) stay standalone `event` placeholders.
- A cluster `@commence` wins over the parse option; the option is the fallback for feeds
  without `@commence` attributes.
- Legacy feeds that put the book in `venue` (non-numeric) still parse: venue falls back to
  the book and no location attaches. Prefer the explicit `book` attribute.
- Malformed/out-of-range `venue` coordinates attach no location — the row degrades to a
  dash in reports, never a dropped event.

## Venue store

[`config/odds-venues.json`](../config/odds-venues.json) gives coordinates a human identity
(`venue-store.ts`):

```json
{
  "venueKey": "v:51.5074:-0.1278",
  "name": "Alpha Park",
  "city": "London",
  "timezone": "Europe/London",
  "aliases": ["The Alpha Ground", "AP"]
}
```

- `venueKey` = coords rounded to 4dp (~11 m) — the canonical grouping/collision key.
- `aliases` canonicalize alternate names (`"MSG"` → `"Madison Square Garden"`);
  unknown names pass through unchanged.
- `timezone` drives venue-local kickoff rendering (`Intl`; UTC fallback, invalid-tz safe).
- Undeclared coordinates resolve to no profile — reports fall back to raw coordinates,
  never a guess.

## Weather

`fetchEventWeather(location, commence)` (Open-Meteo, no key) returns the optional
`EventWeather` (temperature/condition/wind/precipitation) for exactly
**(venue coords, commence hour)** — weather is a property of the event in time, never of
the venue. WMO weather codes map to report conditions; results cache 10 min (failures
60 s); every failure mode degrades to no weather, never a thrown error.

## Odds Heat report

`buildOddsReportMarkdown({ events, patterns, books, venueStore, convergence })`
([`report.ts`](../src/institutions/odds-registry/report.ts)) renders sections in order:
**Matches** (event, provenance, matchup, venue name/city or coords, map link, venue-local
kickoff, weather, collision badge) → **Consensus** → **Books quoting** → **Value patterns** →
**Convergence**. Untrusted-wire contract: every feed-derived cell goes through
`escapeMarkdownCell` before assembly, and HTML rendering uses the `strict` preset
(`tagFilter` + `noHtmlBlocks` + `noHtmlSpans`) — a hostile venue name renders inert.

## Event source ladder

[`data-source.ts`](../src/institutions/odds-registry/data-source.ts) resolves the report's
events with a degrade-down ladder:

1. **Live** — `ODDS_LIVE_FEED=1` (or `opts.live`) fans out `connectAllBookmakers`
   per registry book; per-book results are merged by match identity into shared
   events (`mergeFeedEvents`), so consensus forms across separate feeds.
   Provenance is stamped `source: "live"`.
2. **Reference feed** — `public/registry/odds-reference.xml` (three matches across
   two venues: Alpha + Gamma share Alpha Park → collision badge; Epsilon plays
   Gamma Fields). Provenance `simulated`.
3. **`declarations_only`** — no feed available; the report renders capacity +
   structure with empty tables.

Every rung absorbs its own failures (dead books are isolated by the feed client; a
missing file degrades silently) — the route never 5xx on a feed.

## Bookmaker logos

`bun run book:logos` bakes a 128×128 branded PNG per registry book to
`public/assets/books/<key>.png` (`book-logos.ts`, WebView-rasterized; deterministic
per-key hue + initials). The bookmaker store resolves logos by **convention**:
`bookmakerProfile` falls back to `/assets/books/<key>.png` when the `<meta>` blob has
no `<logo>` and the key has a baked asset — new books get logos by running the CLI,
no config edit. Explicit `<logo>` in the meta blob always wins.

## Consensus history + movement

[`consensus-history.ts`](../src/institutions/odds-registry/consensus-history.ts) persists
per (event, side) consensus snapshots to gitignored
`research/cache/odds-consensus.json`. Each report build classifies the current
consensus against the prior via `classifyConvergence` (Convergence section), then
records itself — build N+1's prior is build N. 24h retention, 12 records/key, dedupe;
every IO failure degrades to "no prior". The ANSI surface renders verdicts as movement
chips (`▲ converging` / `▼ diverging`, `movementChip`).

## ANSI chips

[`chips.ts`](../src/institutions/odds-registry/chips.ts) is the terminal complement of the
Matches table (`renderOddsReportAnsi`, or `bun run odds:report`): provenance chip
(`● live` / `○ sim`), weather chip with a
continuous cold→hot truecolor gradient (`tempToRGB` via `Bun.color` RGB tuples — probed:
`styleText` has no RGB format, and `FORCE_COLOR=1` downgrades to 16-color), venue pin
(`Bun.sliceAnsi` truncation), venue-local kickoff, a collision badge (silent ≤1,
yellow ≤2, orange ≤5, red past 5). Missing segments collapse — no dash rows. Color env is
bootstrap-read: set `NO_COLOR` / `FORCE_COLOR` before launch (see [`env.template`](../env.template)).

## Value patterns

[`value-patterns.ts`](../src/institutions/odds-registry/value-patterns.ts) is the consensus vs venue detector: given `OddsEvent[]` (any adapter) and venue implied references (Kalshi cents → `kalshiCentsToImplied`, Polymarket fraction), it emits per event × side:

| Kind | Meaning |
|---|---|
| `venue_undervalued` | Venue implied below consensus by ≥ gap threshold → value on the venue side |
| `venue_overvalued` | Venue implied above consensus → avoid / fade |
| `thin_consensus` | Fewer bookmakers than `minBookmakers` — gap not actionable |
| `wide_spread` | Bookmaker disagreement above `spreadThreshold` — consensus weak |

Convergence (the second P5 half): `consensusSnapshot(events, id, side)` builds a
per-side snapshot (mean/spread/count/ts); `classifyConvergence` compares two
snapshots and emits `converging` (spread tightened ≥ threshold — the field is
lining up on a price), `diverging` (spread widened — disagreement growing), or
`stale` (quote older than `maxAgeMs`).

Price semantics matter: `OddsEvent.price` is American odds (alpha pipeline contract), so `eventsToOddsPrints` normalizes with `americanToImplied` before consensus forms.

## Sport-key join

Sport keys differ between planes: the odds registry speaks the odds-api vocabulary
(`tennis_atp`, `soccer_epl`) while the venue registry uses its own (`tennis`).
[`venues.ts`](../src/institutions/odds-registry/venues.ts) carries the `VENUE_SPORT_MAP`
join key — sports without a venue counterpart read `declared:false`.

