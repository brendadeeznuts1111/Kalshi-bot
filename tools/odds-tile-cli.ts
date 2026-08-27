#!/usr/bin/env bun
/**
 * `bun run tile <feed> [--root=odds-heat] [--cluster=0|all] [--size=1]
 *              [--format=png|webp|jpeg] [--out=./tile.webp] [--quality=80]
 *              [--min=-200] [--max=200] [--json]`
 *
 * Feed → blob → XML → consensus → color → tile, all Bun-native (1.4.0):
 *
 *   bun run tile https://example.com/odds.xml            # 1x1 webp consensus tile
 *   bun run tile ./feeds/odds.xml --format=png           # raw PNG, no Bun.Image
 *   bun run tile ./feeds/odds.xml --cluster=all --size=256
 *   bun run tile ./feeds/odds.xml --json                 # machine-readable summary
 *
 * <feed> is an http(s) URL or a local XML file. Picks cluster 0, averages its
 * <print american="…"/> values, maps the mean onto [min, max] (red at max,
 * blue at min), renders a solid tile, and writes it. Verified 1.4.0 API
 * notes live at src/lib/odds-tile.ts.
 */
import { parseArgs } from "node:util";
import {
  analyzeOdds,
  loadOddsInput,
  renderTile,
  writeTile,
  type TileFormat,
} from "../src/lib/odds-tile.ts";
import { paint } from "../src/lib/color/index.ts";

const { values: v, positionals: pos } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: { type: "string" },
    cluster: { type: "string" },
    size: { type: "string" },
    format: { type: "string" },
    out: { type: "string" },
    quality: { type: "string" },
    min: { type: "string" },
    max: { type: "string" },
    json: { type: "boolean" },
  },
  strict: false,
  allowPositionals: true,
});
const arg = (name: string): string | undefined =>
  typeof v[name] === "string" ? (v[name] as string) : undefined;

const USAGE =
  "usage: bun run tile <feed> [--root=odds-heat] [--cluster=0|all] [--size=1] [--format=png|webp|jpeg] [--out=FILE] [--quality=80] [--min=-200] [--max=200] [--json]";

const feed = pos[0];
if (!feed) {
  console.error(USAGE);
  process.exit(1);
}
const formatRaw = (arg("format") ?? "webp").toLowerCase();
const FORMATS: TileFormat[] = ["png", "webp", "jpeg"];
const format: TileFormat = FORMATS.includes(formatRaw as TileFormat)
  ? (formatRaw as TileFormat)
  : "webp";
const clusterArg = arg("cluster") ?? "0";
const cluster: number | "all" =
  clusterArg === "all" ? "all" : Number(clusterArg);
if (cluster !== "all" && !Number.isInteger(cluster)) {
  console.error(paint(`odds-tile: bad --cluster "${clusterArg}" (index or "all")`, "trading", "deterministic"));
  process.exit(1);
}
const size = Math.max(1, Math.floor(Number(arg("size") ?? "1") || 1));
const quality = Math.min(100, Math.max(1, Number(arg("quality") ?? "80") || 80));
const min = Number(arg("min") ?? "-200");
const max = Number(arg("max") ?? "200");
const root = arg("root") ?? "odds-heat";
const out = arg("out") ?? `./tile.${format}`;

let blob: Blob;
try {
  blob = await loadOddsInput(feed);
} catch (e) {
  console.error(paint(`odds-tile: ${(e as Error).message}`, "trading", "deterministic"));
  process.exit(1);
}

const analysis = analyzeOdds(blob, { root, cluster });
if (analysis.printCount === 0 || analysis.consensus === null) {
  const why =
    analysis.clusters.length === 0
      ? `no <cluster> under root "${root}" in ${feed}`
      : `no parseable <print american="…"> in cluster ${cluster} of ${feed}`;
  console.error(paint(`odds-tile: ${why}`, "trading", "deterministic"));
  process.exit(1);
}

const { png, color, v: value } = renderTile(analysis.consensus, { size, min, max });
let meta;
try {
  meta = await writeTile(png, out, { format, quality });
} catch (e) {
  console.error(paint(`odds-tile: write failed: ${(e as Error).message}`, "trading", "deterministic"));
  process.exit(1);
}

const hex = `#${[color.r, color.g, color.b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
if (v.json) {
  console.log(
    JSON.stringify(
      {
        feed,
        root,
        cluster,
        venue: analysis.venue,
        printCount: analysis.printCount,
        consensus: analysis.consensus,
        v: value,
        color: hex,
        out,
        format: meta.format,
        width: meta.width,
        height: meta.height,
        bytes: meta.bytes,
      },
      null,
      2,
    ),
  );
} else {
  process.stderr.write(
    paint(
      `odds-tile: cluster ${cluster}${analysis.venue ? " (" + analysis.venue + ")" : ""} · ${analysis.printCount} print(s) · consensus ${analysis.consensus} · v ${value.toFixed(4)} · ${hex} → ${out} (${meta.format} ${meta.width}x${meta.height}, ${meta.bytes} B)`,
      "misc",
      "deterministic",
    ) + "\n",
  );
}
