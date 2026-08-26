#!/usr/bin/env bun
/**
 * `bun run images:meta <path...> [--to=png|jpeg|webp] [--resize=WxH] [--quality=N]`
 *
 * Terminal image metadata + conversion via Bun.image (Bun 1.4.0 file-based
 * API): decodes each input with `Bun.file(path).image().metadata()` and
 * prints a branded table (token-colored via the color kernel). With --to /
 * --resize it re-encodes and writes `<name>.<fmt>` next to the input.
 *
 *   bun run images:meta docs/COLORS.html assets/*.png
 *   bun run images:meta shot.png --to=webp --resize=640x360
 */
import { paint } from '../src/lib/color/index.ts';
import { convertImageFile, readImageMeta } from '../src/lib/brand-image.ts';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

function argValue(name: string): string | undefined {
  const a = Bun.argv.find((x) => x.startsWith('--' + name + '='));
  return a?.slice(name.length + 3);
}

const to = argValue('to');
const quality = Number(argValue('quality') ?? '80');
const resize = argValue('resize');
const fit = argValue('fit');
const rotate = argValue('rotate') ? Number(argValue('rotate')) : undefined;
const batchDir = argValue('batch');
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.heic', '.tiff'];
let inputs = Bun.argv.slice(2).filter((a) => !a.startsWith('--'));
if (batchDir) {
  // Batch mode: every image file in the directory (non-recursive).
  inputs = readdirSync(batchDir)
    .filter((f) => IMAGE_EXTS.some((ext) => f.toLowerCase().endsWith(ext)))
    .map((f) => join(batchDir, f))
    .sort();
}
if (!inputs.length) {
  console.error('usage: bun run images:meta <path...> | --batch=DIR [--to=png|jpeg|webp|avif] [--resize=WxH] [--fit=inside|fill] [--rotate=deg] [--quality=N]');
  process.exit(1);
}

// Semantic mapping onto the domain COLORS palette (ok->tennis green,
// bad->trading red, dim->misc gray, acc->kalshi blue).
const paintDim = (s: string): string => paint('  ' + s, 'misc', 'deterministic');
const paintAcc = (s: string): string => paint(s, 'kalshi', 'deterministic');
const paintOk = (s: string): string => paint(s, 'tennis', 'deterministic');
const paintBad = (s: string): string => paint(s, 'trading', 'deterministic');

const rows: Array<Record<string, string>> = [];
let failed = 0;
for (const input of inputs) {
  const meta = await readImageMeta(input);
  if (!meta) {
    failed += 1;
    rows.push({ file: input, status: paintBad('unreadable') });
    continue;
  }
  let out = '';
  if (to || resize || rotate) {
    const ext = to ?? 'png';
    const outPath = input.replace(/\.[^.]+$/, '') + '.' + ext;
    const width = resize ? Number(resize.split('x')[0]) : undefined;
    const height = resize ? Number(resize.split('x')[1]) : undefined;
    const converted = await convertImageFile(input, outPath, {
      ...(to !== undefined
        ? { format: to as 'png' | 'jpeg' | 'webp' | 'avif' }
        : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(fit !== undefined ? { fit: fit as 'inside' | 'fill' } : {}),
      ...(rotate !== undefined ? { rotate } : {}),
      quality,
    });
    if (converted) out = paintOk('→ ' + outPath + ' (' + converted.format + ' ' + converted.width + 'x' + converted.height + ', ' + converted.bytes + ' B)');
    else { failed += 1; out = paintBad('→ conversion failed'); }
  }
  rows.push({
    file: input,
    format: paintAcc(meta.format),
    width: String(meta.width),
    height: String(meta.height),
    bytes: meta.bytes + ' B',
    status: out || paintOk('ok'),
  });
}

process.stderr.write(paintDim(inputs.length + ' image(s) · Bun.image · ' + (failed ? paintBad(failed + ' failed') : paintOk('all read')) + '\n'));
process.stderr.write(Bun.inspect.table(rows) + '\n');
process.exit(failed ? 1 : 0);
