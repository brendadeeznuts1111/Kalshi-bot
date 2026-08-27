import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeOdds,
  consensus,
  consensusColor,
  parseOddsClusters,
  renderTile,
  rgbaPng,
  writeTile,
} from "../../src/lib/odds-tile.ts";

const FIXTURE = [
  "<odds-heat>",
  '  <cluster venue="Center Court">',
  '    <print american="-150"/>',
  '    <print american="+120"/>',
  "  </cluster>",
  '  <cluster venue="Court 2">',
  '    <print american="-200"/>',
  "  </cluster>",
  "</odds-heat>",
].join("\n");

describe("parseOddsClusters (Bun.XML compact shape)", () => {
  test("string input parses venue + prints", () => {
    const cs = parseOddsClusters(FIXTURE);
    expect(cs).toHaveLength(2);
    expect(cs[0]!.venue).toBe("Center Court");
    expect(cs[0]!.prints.map((p) => p.american)).toEqual([-150, 120]);
    expect(cs[1]!.venue).toBe("Court 2");
    expect(cs[1]!.prints.map((p) => p.american)).toEqual([-200]);
  });

  test("Blob input parses identically (feed → blob path)", () => {
    expect(parseOddsClusters(new Blob([FIXTURE]))).toEqual(parseOddsClusters(FIXTURE));
  });

  test("singleton cluster/print collapse to objects — asArray normalizes", () => {
    const single = parseOddsClusters(
      '<odds-heat><cluster venue="Only"><print american="-110"/></cluster></odds-heat>',
    );
    expect(single).toHaveLength(1);
    expect(single[0]!.prints.map((p) => p.american)).toEqual([-110]);
  });

  test("missing root / empty root yield []", () => {
    expect(parseOddsClusters("<other><x/></other>")).toEqual([]);
    expect(parseOddsClusters("<odds-heat/>")).toEqual([]);
  });

  test("unparseable american values are dropped", () => {
    const cs = parseOddsClusters(
      '<odds-heat><cluster venue="X"><print american="-150"/><print/><print american="zzz"/></cluster></odds-heat>',
    );
    expect(cs[0]!.prints.map((p) => p.american)).toEqual([-150]);
  });
});

describe("consensus + color mapping", () => {
  test("mean of American odds; null when empty", () => {
    expect(consensus([{ american: -150, raw: "-150" }, { american: 120, raw: "+120" }])).toBe(-15);
    expect(consensus([])).toBeNull();
  });

  test("reference mapping: -200 blue (v=0), +200 red (v=1), 0 midpoint", () => {
    expect(consensusColor(-200)).toEqual({ r: 0, g: 128, b: 255, a: 255 });
    expect(consensusColor(200)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    const mid = consensusColor(0);
    expect(mid.r).toBe(128);
    expect(mid.g).toBe(64);
    expect(mid.b).toBe(128);
  });

  test("clamps outside [min, max]", () => {
    expect(consensusColor(-500)).toEqual({ r: 0, g: 128, b: 255, a: 255 });
    expect(consensusColor(500)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });
});

describe("analyzeOdds", () => {
  test("cluster 0 / cluster 1 / all", () => {
    const a0 = analyzeOdds(new Blob([FIXTURE]), { cluster: 0 });
    expect(a0.consensus).toBe(-15);
    expect(a0.venue).toBe("Center Court");
    expect(a0.printCount).toBe(2);

    const a1 = analyzeOdds(new Blob([FIXTURE]), { cluster: 1 });
    expect(a1.consensus).toBe(-200);
    expect(a1.venue).toBe("Court 2");

    const all = analyzeOdds(new Blob([FIXTURE]), { cluster: "all" });
    expect(all.printCount).toBe(3);
    expect(all.consensus).toBeCloseTo(-230 / 3, 5);
  });

  test("empty feed → null consensus, zero prints", () => {
    const a = analyzeOdds(new Blob(["<odds-heat/>"]));
    expect(a.clusters).toHaveLength(0);
    expect(a.printCount).toBe(0);
    expect(a.consensus).toBeNull();
  });
});

describe("renderTile + writeTile (verified Bun.Image roundtrip)", () => {
  test("1x1 png from scratch decodes via Bun.Image", async () => {
    const { png } = renderTile(-15, { size: 1 });
    expect(png[0]).toBe(137); // PNG signature
    expect(png[1]).toBe(80);
    const meta = await new Bun.Image(png).metadata();
    expect(meta).toEqual({ width: 1, height: 1, format: "png" });
  });

  test("webp conversion roundtrips through Bun.Image", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odds-tile-"));
    try {
      const { png } = renderTile(-15, { size: 4 });
      const out = join(dir, "tile.webp");
      const meta = await writeTile(png, out, { format: "webp", quality: 80 });
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(4);
      expect(meta.height).toBe(4);
      expect(meta.bytes).toBeGreaterThan(0);
      expect(await Bun.file(out).exists()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("jpeg conversion roundtrips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odds-tile-"));
    try {
      const { png } = renderTile(120, { size: 8 });
      const out = join(dir, "tile.jpg");
      const meta = await writeTile(png, out, { format: "jpeg" });
      expect(meta.format).toBe("jpeg");
      expect(meta.width).toBe(8);
      expect(meta.height).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("png writes directly without Bun.Image", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odds-tile-"));
    try {
      const { png } = renderTile(0, { size: 1 });
      const out = join(dir, "tile.png");
      const meta = await writeTile(png, out, { format: "png" });
      expect(meta.format).toBe("png");
      expect(meta.bytes).toBe(png.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rgbaPng supports non-square sizes and alpha", async () => {
    const png = rgbaPng(2, 1, (x) => ({ r: x * 255, g: 0, b: 0, a: x * 255 }));
    const meta = await new Bun.Image(png).metadata();
    expect(meta).toEqual({ width: 2, height: 1, format: "png" });
  });
});

describe("CLI end-to-end (local fixture)", () => {
  const ROOT = join(import.meta.dir, "..", "..");

  test("bun run tile <file> --json writes a decodable webp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odds-tile-cli-"));
    try {
      const feedPath = join(dir, "feed.xml");
      await Bun.write(feedPath, FIXTURE);
      const outPath = join(dir, "tile.webp");
      const proc = Bun.spawn(
        [process.execPath, "tools/odds-tile-cli.ts", feedPath, "--out=" + outPath, "--json"],
        { cwd: ROOT },
      );
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      expect(exitCode).toBe(0);
      const summary = JSON.parse(stdout);
      expect(summary.consensus).toBe(-15);
      expect(summary.venue).toBe("Center Court");
      expect(summary.printCount).toBe(2);
      expect(summary.width).toBe(1);
      expect(summary.format).toBe("webp");
      const meta = await new Bun.Image(Bun.file(outPath)).metadata();
      expect(meta.format).toBe("webp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no parseable prints → exit 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odds-tile-cli-"));
    try {
      const feedPath = join(dir, "empty.xml");
      await Bun.write(feedPath, "<odds-heat/>");
      const proc = Bun.spawn(
        [process.execPath, "tools/odds-tile-cli.ts", feedPath, "--json"],
        { cwd: ROOT },
      );
      expect(await proc.exited).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

