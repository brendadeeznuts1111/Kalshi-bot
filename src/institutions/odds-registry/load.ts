/**
 * load.ts — parse config/odds-registry.xml with Bun.XML.parse (native).
 *
 * Bun.XML compact-shape gotchas (probe-verified): attributes are "@key" names;
 * a repeated child with ONE occurrence collapses to an object (not an array) —
 * always normalize with asArray. Text values are strings; nothing is coerced.
 */
import type { OddsFeedType, OddsRegistryBookmaker, OddsRegistryConfig } from "./types.ts";

/** Singleton-collapse guard: Bun.XML turns a repeated child with ONE occurrence into an object. */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

const CONFIG_PATH = "config/odds-registry.xml";

type XmlValue = string | { [key: string]: XmlValue | XmlValue[] };

const isElement = (v: XmlValue | XmlValue[] | undefined): v is { [key: string]: XmlValue | XmlValue[] } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse the registry XML from a string or Blob (Bun.XML). */
export function parseOddsRegistryXml(input: string | Blob): OddsRegistryConfig {
  const doc = Bun.XML.parse(input) as Record<string, XmlValue | XmlValue[] | undefined>;
  const root = doc["odds-registry"];
  if (!isElement(root)) throw new Error("odds-registry: root <odds-registry> missing");
  const version = typeof root["@version"] === "string" ? (root["@version"] as string) : "1";
  const capacityFloor = typeof root["@capacity-floor"] === "string" ? Number(root["@capacity-floor"]) : 34;
  const bookmakers = asArray<XmlValue>(root["bookmaker"])
    .flatMap((b): OddsRegistryBookmaker[] => {
      if (!isElement(b)) return [];
      const key = typeof b["@key"] === "string" ? (b["@key"] as string) : "";
      const name = typeof b["@name"] === "string" ? (b["@name"] as string) : key;
      const feed = (typeof b["@feed"] === "string" ? (b["@feed"] as string) : "odds-api-v3") as OddsFeedType;
      if (!key) return [];
      const sports = asArray<XmlValue>(b["sport"])
        .flatMap((s) => (isElement(s) && typeof s["@key"] === "string" ? [s["@key"] as string] : []));
      return [{
        key,
        name,
        feed,
        ...(typeof b["@region"] === "string" ? { region: b["@region"] as string } : {}),
        ...(typeof b["@markets"] === "string" ? { markets: b["@markets"] as string } : {}),
        ...(typeof b["@endpoint"] === "string" ? { endpoint: b["@endpoint"] as string } : {}),
        sports,
      }];
    });
  return { version, capacityFloor, bookmakers };
}

/** Load the committed registry config (relative to the repo root). */
export async function loadOddsRegistryConfig(root = ".."): Promise<OddsRegistryConfig> {
  const text = await Bun.file(root + "/" + CONFIG_PATH).text();
  return parseOddsRegistryXml(text);
}

