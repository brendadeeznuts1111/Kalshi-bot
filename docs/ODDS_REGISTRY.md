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
| XML feed | [`odds-registry/xml-feed.ts`](../src/institutions/odds-registry/xml-feed.ts) | `<odds-heat>` cluster → `OddsEvent` (h2h from `<print american>`); decimal conversion |
| v3 JSON feed | [`odds-registry/odds-api-v3.ts`](../src/institutions/odds-registry/odds-api-v3.ts) | Odds API v3 name-based adapter: `/bookmakers` + `/odds` → `OddsEvent`, SQLite WAL cache, sport-slug map |
| Feed client | [`odds-registry/feed-client.ts`](../src/institutions/odds-registry/feed-client.ts) | Per-bookmaker connections driven by the `<meta>` blob (`connectBookmaker` / `connectAllBookmakers` fan-out) |
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

