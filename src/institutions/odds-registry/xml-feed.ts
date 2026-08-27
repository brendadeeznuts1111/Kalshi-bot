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
  commenceTime?: number;
}

/**
 * Parse odds-heat XML into OddsEvent[] (one event per cluster; prints become
 * h2h outcomes with decimal prices, american kept as the source value).
 */
export function parseOddsXmlEvents(input: string | Blob, opts: OddsXmlParseOptions = {}): OddsEvent[] {
  const doc = Bun.XML.parse(input) as Record<string, XmlValue | XmlValue[] | undefined>;
  const root = doc["odds-heat"];
  if (!isElement(root)) return [];
  const sportKey = opts.sportKey ?? "unknown";
  const market = opts.market ?? "h2h";
  const commenceTime = opts.commenceTime ?? 0;
  return asArray<XmlValue>(root["cluster"])
    .flatMap((c): OddsEvent[] => {
      if (!isElement(c)) return [];
      const venue = typeof c["@venue"] === "string" ? (c["@venue"] as string) : "Cluster";
      const prints = asArray<XmlValue>(c["print"]).flatMap((p): { name: string; american: number }[] => {
        if (!isElement(p)) return [];
        const raw = typeof p["@american"] === "string" ? (p["@american"] as string) : "";
        const american = Number(raw);
        if (!Number.isFinite(american)) return [];
        return [{ name: p["@name"] && typeof p["@name"] === "string" ? (p["@name"] as string) : "", american }];
      });
      if (prints.length === 0) return [];
      const id = venue.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || "event";
      const side = (p: { name: string; american: number } | undefined, i: number) => ({
        name: p ? p.name || (i === 0 ? "Home" : "Away") : (i === 0 ? "Home" : "Away"),
        price: p ? (americanToDecimal(p.american) ?? 0) : 0,
      });
      const home = side(prints[0], 0);
      const away = side(prints[1], 1);
      return [{
        id: asFeedEventId(id),
        sportKey,
        commenceTime: String(commenceTime),
        homeTeam: home.name,
        awayTeam: away.name,
        bookmakers: [{
          key: id,
          title: venue,
          lastUpdate: "",
          markets: [{
            key: market,
            outcomes: [home, away].filter((s) => s.price > 0).map((s) => ({ name: s.name, price: s.price })),
          }],
        }],
      }];
    });
}

