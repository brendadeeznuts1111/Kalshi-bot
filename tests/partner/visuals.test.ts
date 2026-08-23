// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  colorizePartnerText,
  encodeSolidColorPng,
  getContrastTextColor,
  getPartnerVisual,
  partnerAvatarSvg,
  partnerCssVars,
  partnerHue,
  writePartnerAvatarPng,
} from "../../src/partner/visuals.ts";

describe("partner visuals (Bun.color)", () => {
  test("SPEN hue and formats are stable", () => {
    expect(partnerHue("SPEN")).toBe(70);
    expect(partnerHue("spen")).toBe(70);
    const v = getPartnerVisual("SPEN");
    expect(v.partnerCode).toBe("SPEN");
    expect(v.hsl).toBe("hsl(70, 75%, 60%)");
    expect(v.hex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(v.hex).toBe("#cce64d");
    expect(v.rgbaObj.r).toBe(204);
    expect(v.rgbaObj.g).toBe(230);
    expect(v.rgbaObj.b).toBe(77);
    expect(v.rgbaArr).toEqual([204, 230, 77, 255]);
    expect(v.rgbArr).toEqual([204, 230, 77]);
    expect(v.initials).toBe("SP");
    expect(v.ansi.startsWith("\u001b[38;2;")).toBe(true);
    expect(v.textColor).toBe("#000000"); // bright yellow-green → black text
  });

  test("ASH differs from SPEN and contrast works", () => {
    const ash = getPartnerVisual("ASH");
    const spen = getPartnerVisual("SPEN");
    expect(ash.hex).not.toBe(spen.hex);
    expect(ash.hue).not.toBe(spen.hue);
    expect(getContrastTextColor("#000000")).toBe("#ffffff");
    expect(getContrastTextColor("#ffffff")).toBe("#000000");
  });

  test("SVG + colorize + css vars", () => {
    const svg = partnerAvatarSvg("SPEN", { size: 64 });
    expect(svg).toContain("rgb(204,230,77)");
    expect(svg).toContain(">SP</text>");
    expect(colorizePartnerText("SPEN", "X")).toContain("X");
    expect(partnerCssVars("SPEN")).toContain("--partner-hex:");
  });

  test("encodeSolidColorPng emits a structurally valid PNG (ArrayBufferSink concat)", () => {
    const png = encodeSolidColorPng(204, 230, 77, 64);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    // PNG signature
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR chunk: 4-byte length (13) + type, then width/height
    expect(dv.getUint32(8)).toBe(13);
    expect(new TextDecoder().decode(png.slice(12, 16))).toBe("IHDR");
    expect(dv.getUint32(16)).toBe(64);
    expect(dv.getUint32(20)).toBe(64);
    // IEND terminates the file
    expect(new TextDecoder().decode(png.slice(png.length - 8, png.length - 4))).toBe("IEND");
    // total = signature(8) + IHDR chunk(25) + IDAT chunk(12+len) + IEND chunk(12)
    const idatLen = dv.getUint32(33);
    expect(idatLen).toBeGreaterThan(0);
    expect(png.length).toBe(8 + 25 + (12 + idatLen) + 12);
  });

  test("writePartnerAvatarPng", async () => {
    const dir = join(process.cwd(), "research/cache/partner-avatars-test");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SPEN-test.png");
    const out = await writePartnerAvatarPng("SPEN", path, { size: 64 });
    expect(out.hex).toBe("#cce64d");
    expect(out.bytes).toBeGreaterThan(50);
    expect(await Bun.file(path).exists()).toBe(true);
  });
});
