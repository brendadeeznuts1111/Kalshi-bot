#!/usr/bin/env bun
/**
 * `bun run tile <z> <x> <y> --feed=<url|path> [--root=odds-heat]
 *              [--cluster=0|all] [--size=1] [--out=DIR] [--quality=80]
 *              [--min=-200] [--max=200] [--json] [--png|--webp|--format=...]`
 *
 * Feed → blob → XML → consensus → color → pyramid tile(s), all Bun-native
 * (1.4.0). The three positionals are the pyramid coordinate (z/x/y); the
 * default writes BOTH the lossless PNG and the WebP codec copy:
 *
 *   bun run tile 0 0 0 --feed=https://example.com/odds.xml
 *   # → tiles/0/0/0.png + tiles/0/0/0.webp
 *   bun run tile 2 1 0 --feed=./feeds/odds.xml --png       # png only (debug)
 *   bun run tile 0 0 0 --feed=./feeds/odds.xml --webp      # webp only (debug)
 *   bun run tile 0 0 0 --feed=./feeds/odds.xml --cluster=all --size=256
 *   bun run tile 0 0 0 --feed=./feeds/odds.xml --json      # machine-readable
 *
 * <z>/<x>/<y> are non-negative integers. <feed> is an http(s) URL or a local
 * XML file. Picks cluster 0, averages its <print american="…"/> values, maps
 * the mean onto [min, max] (red at max, blue at min), renders a solid tile,
 * and writes it. Verified 1.4.0 API notes live at src/lib/odds-tile.ts.
 */
import { parseArgs } from "node:util";
import {
  analyzeOdds,
  loadOddsInput,
  renderTile,
  writeTilePyramid,
  tilePath,
  type TileFormat,
} from "../src/lib/odds-tile.ts";
import { paint } from "../src/lib/color/index.ts";

const USAGE =
  'usage: bun run tile <z> <x> <y> --feed=<url|path> [--root=odds-heat] [--cluster=0|all] [--size=1] [--out=DIR] [--quality=80] [--min=-200] [--max=200] [--json] [--png|--webp|--format=png|webp|jpeg]';

function fail(msg: string): never {
  console.error(paint("odds-tile: " + msg, "trading", "deterministic"));
  console.error(USAGE);
  process.exit(1);
}

// parseArgs strict:true rejects unknown flags loudly (no silent swallow).
let v: ReturnType<typeof parseArgs>["values"];
let pos: string[];
try {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      feed: { type: "string" },
      root: { type: "string" },
      cluster: { type: "string" },
      size: { type: "string" },
      out: { type: "string" },
      quality: { type: "string" },
      min: { type: "string" },
      max: { type: "string" },
      json: { type: "boolean" },
      png: { type: "boolean" },
      webp: { type: "boolean" },
      format: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
  v = parsed.values;
  pos = parsed.positionals;
} catch (e) {
  fail((e as Error).message);
}

const arg = (name: string): string | undefined =>
  typeof v[name] === "string" ? (v[name] as string) : undefined;

const feed = arg("feed");
if (!feed) fail('missing --feed=<url|path>');
if (pos.length !== 3) fail('expected 3 positionals <z> <x> <y>, got ' + pos.length);

const coord = (name: string, raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    fail('bad ' + name + ' "' + raw + '" (non-negative integer)');
  }
  return n;
};
const z = coord("z", pos[0]!);
const x = coord("x", pos[1]!);
const y = coord("y", pos[2]!);

// Format selection: default BOTH (png + webp); --png / --webp pick one;
// --format=png|webp|jpeg also picks one (jpeg has no bare flag). More than
// one selector is a conflict and fails loudly - never a silent merge.
const FORMATS: TileFormat[] = ["png", "webp", "jpeg"];
const pngFlag = v.png === true;
const webpFlag = v.webp === true;
const formatRaw = arg("format");
let formats: TileFormat[];
const selectorCount = (pngFlag ? 1 : 0) + (webpFlag ? 1 : 0) + (formatRaw ? 1 : 0);
if (selectorCount > 1) {
  fail("conflicting format selectors (use at most one of --png/--webp/--format)");
}
if (pngFlag) {
  formats = ["png"];
} else if (webpFlag) {
  formats = ["webp"];
} else if (formatRaw) {
  if (!FORMATS.includes(formatRaw as TileFormat)) {
    fail('bad --format "' + formatRaw + '" (png|webp|jpeg)');
  }
  formats = [formatRaw as TileFormat];
} else {
  formats = ["png", "webp"];
}

const clusterArg = arg("cluster") ?? "0";
const cluster: number | "all" =
  clusterArg === "all" ? "all" : Number(clusterArg);
if (cluster !== "all" && !Number.isInteger(cluster)) {
  fail('bad --cluster "' + clusterArg + '" (index or "all")');
}
const size = Math.max(1, Math.floor(Number(arg("size") ?? "1") || 1));
const quality = Math.min(100, Math.max(1, Number(arg("quality") ?? "80") || 80));
const min = Number(arg("min") ?? "-200");
const max = Number(arg("max") ?? "200");
const root = arg("root") ?? "odds-heat";
const out = arg("out") ?? "tiles";

let blob: Blob;
try {
  blob = await loadOddsInput(feed);
} catch (e) {
  fail((e as Error).message);
}

const analysis = analyzeOdds(blob, { root, cluster });
if (analysis.printCount === 0 || analysis.consensus === null) {
  const why =
    analysis.clusters.length === 0
      ? 'no <cluster> under root "' + root + '" in ' + feed
      : 'no parseable <print american="…"> in cluster ' + cluster + ' of ' + feed;
  fail(why);
}

const { png, color, v: value } = renderTile(analysis.consensus, { size, min, max });
let metas;
try {
  metas = await writeTilePyramid(png, z, x, y, { formats, quality, root: out });
} catch (e) {
  fail("write failed: " + (e as Error).message);
}

const hex = "#" + [color.r, color.g, color.b].map((c) => c.toString(16).padStart(2, "0")).join("");
if (v.json) {
  console.log(
    JSON.stringify(
      {
        feed,
        root,
        cluster,
        z,
        x,
        y,
        venue: analysis.venue,
        printCount: analysis.printCount,
        consensus: analysis.consensus,
        v: value,
        color: hex,
        out,
        files: metas.map((m) => ({
          path: tilePath(z, x, y, m.format, out),
          format: m.format,
          width: m.width,
          height: m.height,
          bytes: m.bytes,
        })),
      },
      null,
      2,
    ),
  );
} else {
  process.stderr.write(
    paint(
      "odds-tile: " + z + "/" + x + "/" + y + " · cluster " + cluster + (analysis.venue ? " (" + analysis.venue + ")" : "") + " · " + analysis.printCount + " print(s) · consensus " + analysis.consensus + " · v " + value.toFixed(4) + " · " + hex + " → " + metas.map((m) => tilePath(z, x, y, m.format, out) + " (" + m.format + " " + m.width + "x" + m.height + ", " + m.bytes + " B)").join(" + "),
      "misc",
      "deterministic",
    ) + "\n",
  );
}
