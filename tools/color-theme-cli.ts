#!/usr/bin/env bun
/**
 * `bun run color:theme` — print the unified theme to a terminal + emit
 * artifacts (swatch PNGs, theme JSON) — the ground-tool for the theme
 * system (no WebView involved; every format probe-verified in §22).
 *
 *   bun run color:theme                 # terminal preview + contrast pairs
 *   bun run color:theme -- --png        # write artifacts/theme-swatches/<role>.png
 *   bun run color:theme -- --json       # write artifacts/color-theme.json
 *   bun run color:theme -- --ansi=16m   # force a bit depth (auto/16/256/16m)
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  THEME,
  THEME_ROLES,
  accessibleForeground,
  contrastRatio,
  relativeLuminance,
  themeAnsi,
  themeCssVars,
  themeManifest,
  themeSwatchPng,
  type AnsiMode,
} from '../src/lib/color/theme.ts';

const root = join(import.meta.dir, '..');
const { values: ctv } = parseArgs({ args: Bun.argv.slice(2), options: { png: { type: 'boolean' }, json: { type: 'boolean' }, ansi: { type: 'string' } }, strict: false, allowPositionals: true });
const wantPng = ctv.png === true;
const wantJson = ctv.json === true;
const mode: AnsiMode = (typeof ctv.ansi === 'string' ? ctv.ansi : 'auto') as AnsiMode;

const RESET = '\x1b[0m';

console.log('color:theme — unified theme (Bun ' + Bun.version + ', mode=' + mode + ')\n');
for (const role of THEME_ROLES) {
  const hex = THEME[role];
  const fg = accessibleForeground(hex);
  const fgAnsi = fg === '#000000' ? '\x1b[30m' : '\x1b[37m';
  const bgAnsi = themeAnsi(role, mode);
  const bg256 = themeAnsi(role, '256');
  const chip = bgAnsi + fgAnsi + '  ' + role.padEnd(11) + hex + '  ' + RESET;
  console.log(chip + '  ansi-256: ' + JSON.stringify(bg256));
}
console.log();
console.log('CSS variables:');
console.log(':root {');
console.log(themeCssVars());
console.log('}');
console.log();
console.log('Contrast pairs (WCAG 2.1):');
for (const c of themeManifest().contrast) {
  console.log('  ' + c.fg + ' on ' + c.bg + ' = ' + c.ratio.toFixed(2) + ':1 -> ' + c.verdict);
}
console.log();
console.log('relative luminance: ' + THEME_ROLES.map((r) => r + '=' + relativeLuminance(THEME[r]).toFixed(3)).join('  '));
console.log('black/white ratio: ' + contrastRatio('#000000', '#ffffff').toFixed(2) + ':1');

if (wantPng) {
  const dir = join(root, 'artifacts/theme-swatches');
  mkdirSync(dir, { recursive: true });
  for (const role of THEME_ROLES) {
    const png = themeSwatchPng(role, 64);
    await Bun.write(join(dir, role + '.png'), png);
  }
  console.log('wrote ' + THEME_ROLES.length + ' swatch PNGs -> artifacts/theme-swatches/');
}
if (wantJson) {
  await Bun.write(join(root, 'artifacts/color-theme.json'), JSON.stringify(themeManifest(), null, 2) + '\n');
  console.log('wrote artifacts/color-theme.json');
}
