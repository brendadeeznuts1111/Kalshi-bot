/**
 * Partner visual identity — deterministic color from partner code + Bun.color formats.
 *
 * Unified pipeline: terminal ANSI · SVG/PNG avatars · CSS hex · contrast text.
 *
 * @see https://bun.com/docs/runtime/color
 * @see https://bun.com/docs/runtime/utils#bun-color
 */
// @see https://bun.com/docs/runtime/color
// @see https://bun.com/docs/api/utils#bun-color

export type RgbaObject = { r: number; g: number; b: number; a: number };
export type RgbObject = { r: number; g: number; b: number };
export type RgbaArray = [number, number, number, number];
export type RgbArray = [number, number, number];

export type PartnerVisual = {
  partnerCode: string;
  /** 0–359 */
  hue: number;
  hsl: string;
  hex: string;
  rgb: string;
  rgba: string;
  css: string;
  rgbaObj: RgbaObject;
  rgbObj: RgbObject;
  rgbaArr: RgbaArray;
  rgbArr: RgbArray;
  /** True-color FG ANSI (ansi-16m) */
  ansi: string;
  /** ANSI reset */
  ansiReset: string;
  /** #000000 or #ffffff for text on partner background */
  textColor: string;
  textAnsi: string;
  initials: string;
  /** Relative luminance 0–1 (sRGB) */
  luminance: number;
};

const ANSI_RESET = "\u001b[0m";

/** djb2-style hash → hue in [0, 360). Stable for a given code. */
export function partnerHue(partnerCode: string): number {
  const s = partnerCode.trim().toUpperCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

export function partnerHsl(
  partnerCode: string,
  opts?: { saturation?: number; lightness?: number },
): string {
  const sat = opts?.saturation ?? 75;
  const light = opts?.lightness ?? 60;
  return `hsl(${partnerHue(partnerCode)}, ${sat}%, ${light}%)`;
}

export function partnerInitials(partnerCode: string, max = 2): string {
  const s = partnerCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "??";
  return s.slice(0, max);
}

/**
 * WCAG-ish relative luminance from sRGB channels (0–255).
 * @see https://www.w3.org/TR/WCAG20/#relativeluminancedef (approx via channel linearization skipped for speed — use weighted RGB for contrast choice)
 */
export function relativeLuminanceFromRgb(r: number, g: number, b: number): number {
  // Simple Rec. 601 luma as 0–1 (enough for white/black text pick)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function contrastTextColorForRgb(r: number, g: number, b: number): string {
  return relativeLuminanceFromRgb(r, g, b) > 0.55 ? "#000000" : "#ffffff";
}

/** Pick black/white text for a hex or hsl background via Bun.color. */
export function getContrastTextColor(colorInput: string): string {
  const rgb = Bun.color(colorInput, "{rgb}") as RgbObject | null;
  if (!rgb || typeof rgb.r !== "number") return "#ffffff";
  return contrastTextColorForRgb(rgb.r, rgb.g, rgb.b);
}

/**
 * Full visual pack for a partner code (e.g. SPEN, ASH).
 * All formats derived from one deterministic HSL via Bun.color.
 */
export function getPartnerVisual(partnerCode: string): PartnerVisual {
  const code = partnerCode.trim().toUpperCase() || "??";
  const hue = partnerHue(code);
  const hsl = partnerHsl(code);

  const hex = String(Bun.color(hsl, "hex") ?? "#888888");
  const rgb = String(Bun.color(hsl, "rgb") ?? "rgb(136,136,136)");
  const rgba = String(Bun.color(hsl, "rgba") ?? "rgba(136,136,136,1)");
  const css = String(Bun.color(hsl, "css") ?? hex);
  const rgbaObj = (Bun.color(hsl, "{rgba}") ?? {
    r: 136,
    g: 136,
    b: 136,
    a: 1,
  }) as RgbaObject;
  const rgbObj = (Bun.color(hsl, "{rgb}") ?? {
    r: rgbaObj.r,
    g: rgbaObj.g,
    b: rgbaObj.b,
  }) as RgbObject;
  const rgbaArr = (Bun.color(hsl, "[rgba]") ?? [
    rgbaObj.r,
    rgbaObj.g,
    rgbaObj.b,
    255,
  ]) as RgbaArray;
  const rgbArr = (Bun.color(hsl, "[rgb]") ?? [
    rgbaObj.r,
    rgbaObj.g,
    rgbaObj.b,
  ]) as RgbArray;
  const ansi = String(Bun.color(hsl, "ansi-16m") ?? "");
  const textColor = contrastTextColorForRgb(rgbaObj.r, rgbaObj.g, rgbaObj.b);
  const textAnsi = String(Bun.color(textColor, "ansi-16m") ?? "");
  const luminance = relativeLuminanceFromRgb(rgbaObj.r, rgbaObj.g, rgbaObj.b);

  return {
    partnerCode: code,
    hue,
    hsl,
    hex,
    rgb,
    rgba,
    css,
    rgbaObj,
    rgbObj,
    rgbaArr,
    rgbArr,
    ansi,
    ansiReset: ANSI_RESET,
    textColor,
    textAnsi,
    initials: partnerInitials(code),
    luminance,
  };
}

/** Colorize a string with partner FG (true color). */
export function colorizePartnerText(partnerCode: string, text: string): string {
  const v = getPartnerVisual(partnerCode);
  if (!v.ansi) return text;
  return `${v.ansi}${text}${v.ansiReset}`;
}

/** SVG avatar (circle + initials). Colors via Bun.color-derived pack. */
export function partnerAvatarSvg(
  partnerCode: string,
  opts?: { size?: number },
): string {
  const v = getPartnerVisual(partnerCode);
  const size = opts?.size ?? 200;
  const mid = size / 2;
  const fontSize = Math.round(size * 0.36);
  const textY = Math.round(mid + fontSize * 0.35);
  const { r, g, b } = v.rgbaObj;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<circle cx="${mid}" cy="${mid}" r="${mid}" fill="rgb(${r},${g},${b})"/>`,
    `<text x="${mid}" y="${textY}" font-size="${fontSize}" text-anchor="middle" `,
    `fill="${v.textColor}" font-family="Arial,Helvetica,sans-serif" font-weight="700">${v.initials}</text>`,
    `</svg>`,
  ].join("");
}

/**
 * Minimal RGB8 PNG (solid fill) — Bun.Image does not reliably decode SVG on all builds.
 * Initials live on the sibling SVG from {@link partnerAvatarSvg}.
 */
export function encodeSolidColorPng(
  r: number,
  g: number,
  b: number,
  size: number,
): Uint8Array {
  const w = Math.max(1, Math.min(1024, Math.floor(size)));
  const h = w;
  // Each row: filter byte 0 + RGB pixels
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = r & 255;
      raw[i + 1] = g & 255;
      raw[i + 2] = b & 255;
    }
  }
  // Bun.deflateSync emits RAW deflate (verified: no zlib header); PNG IDAT
  // requires an RFC 1950 zlib stream, so wrap it (0x78 0x9C + Adler-32).
  const compressed = wrapZlib(Bun.deflateSync(raw), raw);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  // Single-pass concatenation — replaces the manual total+offset loop.
  // @see https://bun.com/docs/api/utils#arraybuffersink
  const sink = new Bun.ArrayBufferSink();
  sink.start({ stream: false });
  for (const p of parts) sink.write(p);
  return new Uint8Array(sink.end());
}

/**
 * RFC 1950 zlib wrapper for PNG IDAT: 0x78 0x9C header + raw deflate +
 * Adler-32 of the UNCOMPRESSED data. Bun.deflateSync only emits raw
 * deflate, which strict decoders (Bun.Image) reject in PNG (verified:
 * metadata passes, pixel decode fails without this wrapper).
 */
function wrapZlib(rawDeflate: Uint8Array, raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + rawDeflate.byteLength + 4);
  out[0] = 0x78;
  out[1] = 0x9c; // (0x789c % 31 === 0)
  out.set(rawDeflate, 2);
  new DataView(out.buffer).setUint32(2 + rawDeflate.byteLength, adler32(raw));
  return out;
}

/** RFC 1950 Adler-32 checksum (mod 65521). */
function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.byteLength; i++) {
    a = (a + buf[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.byteLength + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  // CRC over type+data
  const crcBuf = new Uint8Array(4 + data.byteLength);
  crcBuf.set(typeBytes, 0);
  crcBuf.set(data, 4);
  view.setUint32(8 + data.byteLength, crc32(crcBuf) >>> 0);
  return chunk;
}

/** PNG CRC32 */
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.byteLength; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Write partner avatar: SVG (initials + color) + solid PNG swatch (same color).
 * PNG is a color tile for Telegram/thumb; SVG carries initials for UI.
 */
export async function writePartnerAvatarPng(
  partnerCode: string,
  outPath: string,
  opts?: { size?: number },
): Promise<{ path: string; bytes: number; hex: string; svgPath: string }> {
  const size = opts?.size ?? 200;
  const v = getPartnerVisual(partnerCode);
  const svg = partnerAvatarSvg(partnerCode, { size });
  const svgPath = outPath.replace(/\.png$/i, ".svg");
  await Bun.write(svgPath, svg);

  const png = encodeSolidColorPng(v.rgbaObj.r, v.rgbaObj.g, v.rgbaObj.b, size);
  await Bun.write(outPath, png);
  return { path: outPath, bytes: png.byteLength, hex: v.hex, svgPath };
}

/** Compact CLI line: colored code + hex + initials. */
export function formatPartnerVisualLine(partnerCode: string): string {
  const v = getPartnerVisual(partnerCode);
  return `${v.ansi}${v.partnerCode}${v.ansiReset}  ${v.hex}  ${v.initials}  ${v.hsl}`;
}

/** CSS custom-property block for dashboard embed. */
export function partnerCssVars(partnerCode: string, prefix = "--partner"): string {
  const v = getPartnerVisual(partnerCode);
  return [
    `${prefix}-code: ${v.partnerCode};`,
    `${prefix}-hex: ${v.hex};`,
    `${prefix}-rgb: ${v.rgbObj.r} ${v.rgbObj.g} ${v.rgbObj.b};`,
    `${prefix}-text: ${v.textColor};`,
    `${prefix}-hsl: ${v.hsl};`,
  ].join(" ");
}
