#!/usr/bin/env bun
/**
 * Partner visual + identity profile (Bun.color + optional PNG avatar).
 *
 *   bun run partner:profile -- --code=SPEN
 *   bun run partner:profile -- --code=ASH --png
 *   bun run partner:profile -- --code=SPEN --json
 *   bun run partner:profile -- --codes=SPEN,ASH,NOV,BIL
 */
// @see https://bun.com/docs/runtime/color
// @see https://bun.com/docs/runtime/webview
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  formatPartnerVisualLine,
  getPartnerVisual,
  partnerAvatarSvg,
  partnerCssVars,
  writePartnerAvatarPng,
} from "../src/partner/visuals.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const codesRaw =
  argValue("codes") ??
  argValue("code") ??
  process.env.FANTASY402_PARTNER_CODE ??
  "SPEN";
const codes = codesRaw
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);
const wantJson = hasFlag("json");
const wantPng = hasFlag("png");
const outDir =
  argValue("out") ?? join(process.cwd(), "research/cache/partner-avatars");

const profiles = codes.map((code) => {
  const v = getPartnerVisual(code);
  return {
    ...v,
    // Don't dump huge ANSI in JSON as unreadable — keep escaped
    ansi: v.ansi ? `[ansi-16m len=${v.ansi.length}]` : "",
    textAnsi: v.textAnsi ? `[ansi-16m len=${v.textAnsi.length}]` : "",
    cssVars: partnerCssVars(code),
    svgPreview: partnerAvatarSvg(code, { size: 64 }).slice(0, 120) + "…",
  };
});

if (wantPng) {
  mkdirSync(outDir, { recursive: true });
  for (const code of codes) {
    const path = join(outDir, `${code}.png`);
    try {
      const written = await writePartnerAvatarPng(code, path);
      console.error(`avatar png → ${written.path} (${written.bytes} B) ${written.hex}`);
      await Bun.write(join(outDir, `${code}.svg`), partnerAvatarSvg(code));
    } catch (e) {
      console.error(`avatar fail ${code}:`, e);
    }
  }
}

if (wantJson) {
  console.log(
    JSON.stringify(
      {
        profiles: profiles.map((p) => ({
          partnerCode: p.partnerCode,
          hue: p.hue,
          hsl: p.hsl,
          hex: p.hex,
          rgb: p.rgb,
          rgba: p.rgba,
          css: p.css,
          rgbaObj: p.rgbaObj,
          rgbaArr: p.rgbaArr,
          textColor: p.textColor,
          initials: p.initials,
          luminance: p.luminance,
          cssVars: p.cssVars,
        })),
        outDir: wantPng ? outDir : undefined,
      },
      null,
      2,
    ),
  );
} else {
  for (const code of codes) {
    const v = getPartnerVisual(code);
    const box = v.ansi;
    const r = v.ansiReset;
    console.log(`${box}┌────────────────────────────┐${r}`);
    console.log(
      `${box}│  ${v.initials.padEnd(4)}  │${r}  Partner: ${formatPartnerVisualLine(code)}`,
    );
    console.log(`${box}│  ●●●●  │${r}  Hex: ${v.hex}  Text: ${v.textColor}`);
    console.log(
      `${box}│        │${r}  RGBA: ${v.rgbaArr.join(",")}  lum=${v.luminance.toFixed(3)}`,
    );
    console.log(`${box}└────────────────────────────┘${r}`);
    console.log(`  css: ${partnerCssVars(code)}`);
    if (wantPng) console.log(`  avatar: ${join(outDir, code + ".png")}`);
    console.log("");
  }
}
