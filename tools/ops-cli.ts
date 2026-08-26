#!/usr/bin/env bun
/**
 * Seat-ops architecture status + expansion map (not desk matrix).
 *
 *   bun run ops:status
 *   bun run ops:status -- --json
 *   bun run ops:map
 *   bun run ops:map -- --output=artifacts/partner-expansion.mmd
 *
 * Desk matrix: domain:skins · domain:books · domain:host-discover · domain:sports
 * Inventory: inventory:sync · inventory:watch
 *
 * @see docs/SEAT-OPS.md
 * @see src/partner/architecture.ts
 */
import {
  buildOpsStatusReport,
  formatOpsStatusText,
  formatPartnerExpansionMermaid,
} from '../src/partner/architecture.ts';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const { values: ov } = parseArgs({ args: Bun.argv.slice(2), options: { json: { type: 'boolean' }, map: { type: 'boolean' }, mermaid: { type: 'boolean' }, output: { type: 'string' } }, strict: false, allowPositionals: true });
const json = ov.json === true;
const map = ov.map === true || ov.mermaid === true;
const outputPath = typeof ov.output === 'string' ? ov.output.trim() : undefined;
if (json && map) throw new TypeError('Choose one of --json or --map/--mermaid');
if (ov.output !== undefined && !outputPath) throw new TypeError('--output requires a path');

if (map) {
  const content = `${formatPartnerExpansionMermaid()}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, content);
    console.error(`wrote partner expansion map: ${outputPath}`);
  } else {
    console.log(content.trimEnd());
  }
  process.exit(0);
}

const report = buildOpsStatusReport();
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatOpsStatusText(report));
  console.log('\n  · docs: docs/SEAT-OPS.md · desk matrix: src/domain/README.md');
  console.log('  · skin matrix: bun run domain:skins');
  console.log('  · book matrix: bun run domain:books');
  console.log('  · host discover: bun run domain:host-discover -- --url=https://…');
  console.log('  · sports map / stream coverage: bun run domain:sports');
  console.log('  · inventory sync: bun run inventory:sync -- --sport=all');
}
