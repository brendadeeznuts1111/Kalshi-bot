/**
 * xml-feed.ts — Bun.XML odds feed adapter (reference contract).
 *
 * Parses the odds-heat XML shape into the existing OddsEvent model so the
 * alpha pipeline consumes it unchanged:
 *
 *   <odds-heat>
 *     <cluster venue="Center Court">
 *       <print american="-150"/><print american="+120"/>
 *     </cluster>
 *   </odds-heat>
 *
 * Bun.XML compact-shape notes (probe-verified): attributes are "@key"; a
 * repeated child with ONE occurrence collapses to an object (not an array) —
 * always normalize with asArray. American odds are strings; convert with
 * americanToDecimal before storing (the OddsEvent price field is decimal).
 */
import { asFeedEventId, type EventLocation, type OddsEvent } from "../../alpha/odds-types.ts";

type XmlValue = string | { [key: string]: XmlValue | XmlValue[] };

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

const isElement = (v: XmlValue | XmlValue[] | undefined): v is { [key: string]: XmlValue | XmlValue[] } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** American odds ("-150") -> decimal price (1.67). Guarded: NaN/0 -> null. */
export function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export interface OddsXmlParseOptions {
  sportKey?: string;
  /** Market key for the prints (default "h2h"). */
  market?: string;
  /** Commence time for the printed event (epoch ms or ISO string). */
  commenceTime?: number | string;
}

/**
 * Parse "lat,long" into an EventLocation; null unless both parts are finite
 * floats inside the geographic ranges (lat [-90,90], long [-180,180]).
 */
export function parseEventLocation(raw: string): EventLocation | null {
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 2) return null;
  const lat = parts[0];
  const long = parts[1];
  if (lat === undefined || long === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;
  if (lat < -90 || lat > 90 || long < -180 || long > 180) return null;
  return { lat, long };
}

const slugKey = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || s;

/**
 * Resolve the BOOKMAKER for a cluster. The wire contract is `book="key"`
 * with `venue="lat,long"` carrying the match location. Legacy feeds that
 * put the book in `venue` (non-numeric) still parse: the venue falls back
 * to the book and no location attaches.
 */
function resolveBookAndLocation(c: { [key: string]: XmlValue | XmlValue[] }): { key: string; title: string; location: EventLocation | null } {
  const bookAttr = typeof c["@book"] === "string" ? (c["@book"] as string) : "";
  const venueAttr = typeof c["@venue"] === "string" ? (c["@venue"] as string) : "";
  const location = parseEventLocation(venueAttr);
  const bookRaw = bookAttr || (location ? "unknown" : venueAttr) || "unknown";
  return { key: slugKey(bookRaw), title: bookRaw, location };
}

/**
 * Parse odds-heat XML into OddsEvent[]: clusters quoting the same
 * match — same commence + same home/away teams — merge into ONE event with
 * one bookmaker entry per book (cluster `book` attr), so multi-bookmaker
 * consensus forms from a single feed. `venue="lat,long"` is the match
 * location and attaches to the EVENT, not the book. Clusters without a
 * match twin stay standalone events.
 */
export function parseOddsXmlEvents(input: string | Blob, opts: OddsXmlParseOptions = {}): OddsEvent[] {
  const doc = Bun.XML.parse(input) as Record<string, XmlValue | XmlValue[] | undefined>;
  const root = doc["odds-heat"];
  if (!isElement(root)) return [];
  const sportKey = opts.sportKey ?? "unknown";
  const market = opts.market ?? "h2h";
  const commenceTime = opts.commenceTime ?? 0;
  const clusters = asArray<XmlValue>(root["cluster"]);
  const events: OddsEvent[] = [];
  const byMatch = new Map<string, number>(); // `${commence}|${home}|${away}` -> index in events
  for (const c of clusters) {
    if (!isElement(c)) continue;
    const { key: bookKey, title: bookTitle, location } = resolveBookAndLocation(c);
    // Per-cluster commence wins over the parse option (the option stays the
    // fallback for feeds without @commence attributes).
    const commence = typeof c["@commence"] === "string" ? (c["@commence"] as string) : commenceTime;
    const prints = asArray<XmlValue>(c["print"]).flatMap((p): { name: string; american: number }[] => {
      if (!isElement(p)) return [];
      const raw = typeof p["@american"] === "string" ? (p["@american"] as string) : "";
      const american = Number(raw);
      if (!Number.isFinite(american)) return [];
      return [{ name: p["@name"] && typeof p["@name"] === "string" ? (p["@name"] as string) : "", american }];
    });
    if (prints.length === 0) continue;
    // OddsEvent.price is AMERICAN odds (alpha pipeline contract — see
    // consensus-signal.test.ts fixtures). americanToDecimal stays display-only.
    const side = (p: { name: string; american: number } | undefined, i: number) => ({
      name: p ? p.name || (i === 0 ? "Home" : "Away") : (i === 0 ? "Home" : "Away"),
      price: p ? p.american : 0,
    });
    const home = side(prints[0], 0);
    const away = side(prints[1], 1);
    // Merge only when match identity is explicit (real commence and/or named
    // prints); default placeholders (time 0, "Home"/"Away") are standalone.
    const hasIdentity = commence !== 0 || home.name !== "Home" || away.name !== "Away";
    const matchKey = `${commence}|${home.name}|${away.name}`;
    const existingIdx = hasIdentity ? byMatch.get(matchKey) : undefined;
    if (existingIdx !== undefined) {
      const ev = events[existingIdx]!;
      ev.bookmakers.push({
        key: bookKey,
        title: bookTitle,
        lastUpdate: "",
        markets: [{ key: market, outcomes: [home, away].filter((s) => s.price !== 0).map((s) => ({ name: s.name, price: s.price })) }],
      });
      continue;
    }
    // Event identity is the MATCH (teams + commence date). The venue is the
    // match's lat/long location; the book is the bookmaker — neither names
    // the event.
    const commenceDate = commence === 0
      ? ""
      : typeof commence === "number"
        ? new Date(commence).toISOString().slice(0, 10)
        : commence.slice(0, 10);
    const id = hasIdentity
      ? [`${home.name}-vs-${away.name}`.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase(), commenceDate].filter(Boolean).join("-")
      : "event";
    const ev: OddsEvent = {
      id: asFeedEventId(id),
      sportKey,
      commenceTime: String(commence),
      homeTeam: home.name,
      awayTeam: away.name,
      ...(location ? { location } : {}),
      bookmakers: [{
        key: bookKey,
        title: bookTitle,
        lastUpdate: "",
        markets: [{
          key: market,
          outcomes: [home, away].filter((s) => s.price !== 0).map((s) => ({ name: s.name, price: s.price })),
        }],
      }],
    };
    byMatch.set(matchKey, events.length);
    events.push(ev);
  }
  return events;
}

