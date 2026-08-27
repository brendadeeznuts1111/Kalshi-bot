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
import { asFeedEventId, type OddsEvent } from "../../alpha/odds-types.ts";

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
 * Parse odds-heat XML into OddsEvent[]: clusters (venues) quoting the same
 * match — same commence + same home/away teams — merge into ONE event with
 * one bookmaker entry per venue, so multi-bookmaker consensus forms from a
 * single feed. Clusters without a match twin stay standalone events.
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
    const venue = typeof c["@venue"] === "string" ? (c["@venue"] as string) : "Cluster";
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
        key: venue.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || venue,
        title: venue,
        lastUpdate: "",
        markets: [{ key: market, outcomes: [home, away].filter((s) => s.price !== 0).map((s) => ({ name: s.name, price: s.price })) }],
      });
      continue;
    }
    // Event identity is the MATCH (teams + commence date), never the venue:
    // venues are bookmakers and belong in the bookmaker profile store — an
    // event named after a book conflates the two domains.
    const commenceDate = commence === 0
      ? ""
      : typeof commence === "number"
        ? new Date(commence).toISOString().slice(0, 10)
        : commence.slice(0, 10);
    const venueKey = venue.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || venue;
    const id = hasIdentity
      ? [`${home.name}-vs-${away.name}`.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase(), commenceDate].filter(Boolean).join("-")
      : "event";
    const ev: OddsEvent = {
      id: asFeedEventId(id),
      sportKey,
      commenceTime: String(commence),
      homeTeam: home.name,
      awayTeam: away.name,
      bookmakers: [{
        key: venueKey,
        title: venue,
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

