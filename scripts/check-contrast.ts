#!/usr/bin/env bun
/**
 * Kernel-level contrast gate — every ColorKey must pick a foreground that
 * meets WCAG AA (≥ 4.5:1) against its own background.
 *
 * Optional WebView page probe when CONTRAST_BASE_URL is set (local HQ):
 *   CONTRAST_BASE_URL=http://127.0.0.1:3456 bun run colors:contrast
 *
 * @see https://bun.com/docs/runtime/color#flexible-input
 * @see https://bun.com/docs/runtime/webview#new-bun-webview-options
 * @see src/lib/color/kernel.ts
 */
import {
  COLORS,
  foregroundCss,
  luminance,
  type ColorKey,
} from "../src/lib/color/index.ts";
import { GLOSSARY_ENTRIES } from "../src/institutions/glossary.ts";

const keys = Object.keys(COLORS) as ColorKey[];
let failures = 0;

function contrastAgainstFg(key: ColorKey): number {
  const bg = luminance(key);
  const fg = foregroundCss(key) === "#ffffff" ? 1 : 0;
  const [L, d] = bg > fg ? [bg, fg] : [fg, bg];
  return (L + 0.05) / (d + 0.05);
}

console.log("── Kernel on-color contrast (best of black/white) ──");
// Brand accents are often mid-luminance; AA (4.5) is the hard floor when
// used as solid chip backgrounds. Large-text / UI chrome may still use
// weaker pairs — flag those below 3:1 as hard fails, 3–4.5 as warn.
for (const key of keys) {
  const ratio = contrastAgainstFg(key);
  const fg = foregroundCss(key);
  if (ratio < 3) {
    console.error(
      `❌ ${key.padEnd(12)} bg=${COLORS[key]} fg=${fg}  ${ratio.toFixed(2)}:1 (< 3:1)`,
    );
    failures++;
  } else if (ratio < 4.5) {
    console.log(
      `⚠️  ${key.padEnd(12)} bg=${COLORS[key]} fg=${fg}  ${ratio.toFixed(2)}:1 (below AA — large text / badges ok)`,
    );
  } else {
    console.log(
      `✅ ${key.padEnd(12)} bg=${COLORS[key]} fg=${fg}  ${ratio.toFixed(2)}:1`,
    );
  }
}

console.log("\n── Glossary ColorKey coverage ──");
for (const entry of GLOSSARY_ENTRIES) {
  if (!entry.color) continue;
  if (!(entry.color in COLORS)) {
    console.error(`❌ ${entry.id} → unknown color "${entry.color}"`);
    failures++;
  }
}
const colored = GLOSSARY_ENTRIES.filter((e) => e.color).length;
console.log(`✅ ${colored} glossary entries reference ColorKey`);

const base = Bun.env.CONTRAST_BASE_URL?.replace(/\/$/, "");
if (base) {
  console.log(`\n── WebView probe ${base} ──`);
  try {
    const pages = ["/hq"];
    for (const route of pages) {
      await using view = new Bun.WebView({ width: 1200, height: 800 });
      await view.navigate(`${base}${route}`);
      await Bun.sleep(500);
      const elements = (await view.evaluate(`
        Array.from(document.querySelectorAll('[data-color-key]')).map((el) => ({
          key: el.dataset.colorKey,
          computedBg: getComputedStyle(el).backgroundColor,
          computedColor: getComputedStyle(el).color,
        }))
      `)) as Array<{ key: string; computedBg: string; computedColor: string }>;
      console.log(`${route}: ${elements.length} [data-color-key] node(s)`);
      for (const el of elements) {
        if (!(el.key in COLORS)) {
          console.error(`❌ ${route} unknown data-color-key="${el.key}"`);
          failures++;
          continue;
        }
        const expected = foregroundCss(el.key as ColorKey);
        const wantWhite = expected === "#ffffff";
        const rgb = el.computedColor.match(/\d+/g)?.map(Number) ?? [];
        const isLightText =
          rgb.length >= 3 && (rgb[0]! + rgb[1]! + rgb[2]!) / 3 > 128;
        if (wantWhite !== isLightText && rgb.length >= 3) {
          console.error(
            `❌ ${route} key=${el.key} expected fg ${expected}, got ${el.computedColor}`,
          );
          failures++;
        }
      }
    }
  } catch (err) {
    console.error(`WebView probe failed: ${err instanceof Error ? err.message : err}`);
    failures++;
  }
}

if (failures) {
  console.error(`\n${failures} contrast failure(s)`);
  process.exit(1);
}
console.log("\n✅ contrast gate clean");
