#!/usr/bin/env bun
/**
 * kalshi-brand — validate the bundled brand assets. Self-contained
 * (reads the package JSON + assets only; no repo imports), so it ships
 * in the published tarball and runs on any Bun.
 *
 *   kalshi-brand validate   # verify brand-card.png 1200x630 + swatch set
 *   kalshi-brand info       # print package metadata (tokens version etc.)
 *   kalshi-brand validate --json
 */
import { parseArgs } from "node:util";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { json: { type: "boolean" } },
  strict: false,
  allowPositionals: true,
});
const cmd = positionals[0] ?? "info";

const tokens = await Bun.file(join(ROOT, "tokens.json")).json().catch(() => null);

async function validate(): Promise<{ pass: boolean; details: string[] }> {
  const details: string[] = [];
  const card = await new Bun.Image(Bun.file(join(ROOT, "assets", "brand-card.png"))).metadata().catch(() => null);
  const cardOk = card !== null && card.format === "png" && card.width === 1200 && card.height === 630;
  details.push("brand-card.png " + (card ? card.width + "x" + card.height + " " + card.format : "unreadable") + (cardOk ? " ✓" : " ✗"));
  const swatchKeys: string[] = tokens?.swatches ?? [];
  let swatchOk = true;
  for (const key of swatchKeys) {
    const m = await new Bun.Image(Bun.file(join(ROOT, "assets", "swatches", key + ".png"))).metadata().catch(() => null);
    if (!m || m.format !== "png" || m.width !== 64 || m.height !== 64) { swatchOk = false; details.push("swatch " + key + " invalid"); }
  }
  details.push(swatchKeys.length + " swatches (64x64 png) " + (swatchOk ? "✓" : "✗"));
  return { pass: cardOk && swatchOk, details };
}

if (cmd === "validate") {
  const result = await validate();
  if (values.json) {
    console.log(JSON.stringify({ package: "kalshi-brand", version: tokens?.designSystemVersion ?? "?", pass: result.pass, details: result.details }, null, 2));
  } else {
    for (const d of result.details) console.log(d);
    console.log(result.pass ? "kalshi-brand validate: PASS" : "kalshi-brand validate: FAIL");
  }
  process.exit(result.pass ? 0 : 1);
} else {
  console.log(JSON.stringify({
    package: "kalshi-brand",
    version: tokens?.designSystemVersion ?? "?",
    brand: tokens?.brand?.wordmark ?? "?",
    swatches: tokens?.swatches?.length ?? 0,
    commands: ["validate", "info"],
  }, null, 2));
}
