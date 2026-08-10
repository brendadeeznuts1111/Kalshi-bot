#!/usr/bin/env bun
/**
 * Seat-ops architecture status + expansion map (not desk matrix).
 *
 *   bun run ops:status
 *   bun run ops:status -- --json
 *   bun run ops:map
 *   bun run ops:map -- --output=artifacts/partner-expansion.mmd
 *
 * Legacy: partner:domain · partner:map
 * Desk matrix: domain:skins · domain:books · domain:host-discover
 *
 * @see docs/PARTNER-DOMAIN.md
 * @see src/partner/architecture.ts
 */
import {
  buildOpsStatusReport,
  formatOpsStatusText,
  formatPartnerExpansionMermaid,
} from '../src/partner/architecture.ts';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const json = process.argv.includes('--json');
const map = process.argv.includes('--map') || process.argv.includes('--mermaid');
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const outputPath = outputArg?.slice('--output='.length).trim();
if (json && map) throw new TypeError('Choose one of --json or --map/--mermaid');
if (outputArg && !outputPath) throw new TypeError('--output requires a path');

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
  console.log('\n  · docs: docs/PARTNER-DOMAIN.md · desk matrix: src/domain/README.md');
  console.log('  · skin matrix: bun run domain:skins');
  console.log('  · book matrix: bun run domain:books');
  console.log('  · host discover: bun run domain:host-discover -- --url=https://…');
}
