/**
 * odds-tile.ts — feed → blob → XML → consensus → color → tile.
 *
 * The blob-driven pipeline, verified on Bun 1.4.0 (macOS arm64, probed
 * in-session against the installed runtime):
 *
 *  - `Bun.XML.parse` accepts `string | Blob | Buffer | Uint8Array` (a bare
 *    `BunFile` is rejected by parse — and on 1.4.0 `BunFile` has no `.blob()`
 *    method at all; its MIME lives on `.type` — so wrap `file.bytes()` in a
 *    `new Blob([...])` as {@link loadOddsInput} does). Compact shape: attributes are
 *    `"@name"` keys, repeated child names become arrays, and a SINGLETON
 *    child collapses to a plain object — normalise with {@link asArray}
 *    before indexing `[0]` or calling `.reduce()`.
 *  - `Bun.Image` on 1.4.0 has NO raw-pixel constructor:
 *    `new Bun.Image(bytes, { width, height, channels })` silently builds an
 *    invalid image (width -1, no format) and the terminal write fails with
 *    `unrecognised format`. The constructor only decodes ENCODED images
 *    (+`{ maxPixels, autoOrient }`). From-scratch pixels must therefore be
 *    hand-encoded — this module's {@link rgbaPng} (zlib + CRC32, zero deps)
 *    — and optionally re-encoded to webp/jpeg via
 *    `new Bun.Image(png).webp({ quality }).write(path)`.
 *  - `img.width/height` are `-1` until an awaited terminal populates them;
 *    read ground truth with `await img.metadata()`.
 *
 * Consensus → color mapping keeps the reference semantics:
 * `v = clamp((american + 200) / 400, 0, 1)` → red at +200, blue at −200.
 */
import { deflateSync } from "node:zlib";

// ── XML compact-shape types (Bun.XML.parse) ────────────────────────────────

export type XmlValue = string | XmlElement;
export interface XmlElement {
  [key: string]: XmlValue | XmlValue[];
}
export type XmlDoc = { [root: string]: XmlValue };

/** Singleton-collapse guard: XML compact shape turns a repeated child name
 * with one occurrence into an object instead of an array. */
export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

const isElement = (v: XmlValue | undefined): v is XmlElement =>
  typeof v === "object" && v !== null;

// ── odds feed model ─────────────────────────────────────────────────────────

export interface OddsPrint {
  american: number;
  /** The wire string, e.g. "-150" (kept for provenance). */
  raw: string;
}
export interface OddsCluster {
  venue: string;
  prints: OddsPrint[];
}

/** Parse an odds XML document into clusters; unparseable prints are dropped. */
export function parseOddsClusters(
  input: Parameters<typeof Bun.XML.parse>[0],
  root = "odds-heat",
): OddsCluster[] {
  const doc = Bun.XML.parse(input) as XmlDoc;
  const rootValue = doc[root];
  if (!isElement(rootValue)) return [];
  const clusters = asArray(rootValue["cluster"] as XmlValue | XmlValue[] | undefined);
  return clusters.flatMap((c): OddsCluster[] => {
    if (!isElement(c)) return [];
    const venue = typeof c["@venue"] === "string" ? (c["@venue"] as string) : "";
    const prints = asArray(c["print"] as XmlValue | XmlValue[] | undefined)
      .map((p): OddsPrint | null => {
        if (!isElement(p)) return null;
        const raw = typeof p["@american"] === "string" ? (p["@american"] as string) : "";
        const american = Number(raw);
        if (!Number.isFinite(american)) return null;
        return { american, raw };
      })
      .filter((p): p is OddsPrint => p !== null);
    return [{ venue, prints }];
  });
}

/** Mean of the cluster's American odds; null when there are no prints. */
export function consensus(prints: OddsPrint[]): number | null {
  if (prints.length === 0) return null;
  return prints.reduce((s, p) => s + p.american, 0) / prints.length;
}

// ── consensus → color ───────────────────────────────────────────────────────

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface OddsColorOptions {
  /** Consensus bound mapped to v=0. @default -200 */
  min?: number;
  /** Consensus bound mapped to v=1. @default 200 */
  max?: number;
}

/** Normalised heat value in [0, 1]: (c − min) / (max − min), clamped. */
export function colorV(consensus: number, opts: OddsColorOptions = {}): number {
  const min = opts.min ?? -200;
  const max = opts.max ?? 200;
  return Math.min(Math.max((consensus - min) / (max - min || 1), 0), 1);
}

/** Reference mapping: v=0 → (0,128,255) blue … v=1 → (255,0,0) red. */
export function consensusColor(consensus: number, opts: OddsColorOptions = {}): RgbaColor {
  const v = colorV(consensus, opts);
  return {
    r: Math.round(v * 255),
    g: Math.round((1 - v) * 128),
    b: Math.round((1 - v) * 255),
    a: 255,
  };
}

// ── from-scratch RGBA PNG encoder (verified on 1.4.0) ───────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Encode raw RGBA pixels as a PNG (8-bit, colour type 6, zlib level 9). */
export function rgbaPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => RgbaColor,
): Uint8Array {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const stride = w * 4 + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: None
    const row = y * stride + 1;
    for (let x = 0; x < w; x++) {
      const px = pixel(x, y);
      const o = row + x * 4;
      raw[o] = px.r;
      raw[o + 1] = px.g;
      raw[o + 2] = px.b;
      raw[o + 3] = px.a;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w, false);
  dv.setUint32(4, h, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return concatBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    pngChunk("IEND", new Uint8Array(0)),
  );
}

// ── tile build + write ──────────────────────────────────────────────────────

export interface TileOptions extends OddsColorOptions {
  /** Tile edge in pixels. @default 1 */
  size?: number;
}

/** Solid consensus tile: raw RGBA pixels → PNG bytes (from scratch). */
export function renderTile(consensus: number, opts: TileOptions = {}): {
  png: Uint8Array;
  color: RgbaColor;
  v: number;
} {
  const size = Math.max(1, Math.floor(opts.size ?? 1));
  const color = consensusColor(consensus, opts);
  return { png: rgbaPng(size, size, () => color), color, v: colorV(consensus, opts) };
}

export type TileFormat = "png" | "webp" | "jpeg";

export interface TileMeta {
  width: number;
  height: number;
  format: string;
  bytes: number;
}

/**
 * Write the tile. png → direct `Bun.write`; webp/jpeg → decode the
 * hand-encoded PNG via `new Bun.Image(png)` and re-encode (verified chain
 * on 1.4.0). Returns ground-truth metadata from the written file.
 */
export async function writeTile(
  png: Uint8Array,
  out: string,
  opts: { format?: TileFormat; quality?: number } = {},
): Promise<TileMeta> {
  const format = opts.format ?? "png";
  if (format === "png") {
    await Bun.write(out, png);
    const m = await new Bun.Image(png).metadata();
    return { width: m.width, height: m.height, format: m.format, bytes: png.length };
  }
  const img = new Bun.Image(png);
  const encoded =
    format === "webp"
      ? img.webp({ quality: opts.quality ?? 80 })
      : img.jpeg({ quality: opts.quality ?? 80 });
  const bytes = await encoded.write(out);
  const m = await new Bun.Image(Bun.file(out)).metadata();
  return { width: m.width, height: m.height, format: m.format, bytes };
}

// ── feed loading + analysis ─────────────────────────────────────────────────

/** http(s) URL or local file path → Blob (the `Bun.XML.parse` input). */
export async function loadOddsInput(feed: string): Promise<Blob> {
  if (/^https?:\/\//i.test(feed)) {
    const res = await fetch(feed);
    if (!res.ok) throw new Error(`GET ${feed} -> HTTP ${res.status}`);
    return await res.blob();
  }
  const file = Bun.file(feed);
  if (!(await file.exists())) throw new Error(`no such file: ${feed}`);
  // BunFile has no .blob() on 1.4.0 (MIME lives on .type) — wrap the bytes.
  return new Blob([await file.bytes()], { type: file.type });
}

export interface AnalyzeOptions {
  root?: string;
  /** Cluster index, or "all" to aggregate every cluster's prints. @default 0 */
  cluster?: number | "all";
}

export interface AnalyzeResult {
  clusters: OddsCluster[];
  index: number | "all";
  venue: string;
  prints: OddsPrint[];
  printCount: number;
  consensus: number | null;
}

/** Extract prints + consensus from a parsed odds feed. */
export function analyzeOdds(blob: Blob, opts: AnalyzeOptions = {}): AnalyzeResult {
  const clusters = parseOddsClusters(blob, opts.root ?? "odds-heat");
  const index = opts.cluster ?? 0;
  if (clusters.length === 0) {
    return { clusters, index, venue: "", prints: [], printCount: 0, consensus: null };
  }
  const prints =
    index === "all" ? clusters.flatMap((c) => c.prints) : clusters[index]?.prints ?? [];
  const venue = index === "all" ? "ALL" : clusters[index]?.venue ?? "";
  return { clusters, index, venue, prints, printCount: prints.length, consensus: consensus(prints) };
}
