#!/usr/bin/env bun
/**
 * Desk domain matrices + seat-ops architecture status.
 *
 * Desk matrix (skins / books / hosts):
 *   bun run domain:status
 *   bun run domain:status -- --json
 *   bun run domain:skins
 *   bun run domain:skins -- --json
 *   bun run domain:books
 *   bun run domain:books -- --json
 *   bun run domain:map
 *   bun run domain:map -- --output=artifacts/partner-expansion.mmd
 *
 * Legacy aliases: partner:domain · partner:skins · partner:books · partner:map
 *
 * @see docs/PARTNER-DOMAIN.md
 * @see src/partner/architecture.ts
 * @see src/domain/skin-matrix.ts
 * @see src/domain/books.ts
 */
import {
  buildBookMatrixRows,
  buildSkinMatrixRows,
  formatBooksMatrixText,
  formatSkinMatrixText,
} from '../src/domain/index.ts';
import {
  buildDomainStatusReport,
  formatDomainStatusText,
  formatPartnerExpansionMermaid,
} from '../src/partner/architecture.ts';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const json = process.argv.includes('--json');
const skins = process.argv.includes('--skins') || process.argv.includes('--skin-matrix');
const books = process.argv.includes('--books') || process.argv.includes('--book-matrix');
const map = process.argv.includes('--map') || process.argv.includes('--mermaid');
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const outputPath = outputArg?.slice('--output='.length).trim();
if (json && map) throw new TypeError('Choose one of --json or --map/--mermaid');
if (skins && map) throw new TypeError('Choose one of --skins or --map/--mermaid');
if (books && map) throw new TypeError('Choose one of --books or --map/--mermaid');
if (skins && books) throw new TypeError('Choose one of --skins or --books');
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

if (skins) {
  const rows = buildSkinMatrixRows();
  if (json) {
    console.log(
      JSON.stringify(
        {
          skins: rows,
          count: rows.length,
          withGaps: rows.filter(r => r.gaps.length > 0).length,
          fingerprintPending: rows.filter(r => r.fingerprintPending).map(r => r.skinId),
        },
        null,
        2
      )
    );
  } else {
    console.log(formatSkinMatrixText(rows));
    console.log('\n  · SSOT: src/domain/skins.ts · docs: src/domain/README.md');
  }
  process.exit(0);
}

if (books) {
  const rows = buildBookMatrixRows();
  if (json) {
    const bySkin: Record<string, string[]> = {};
    for (const r of rows) {
      const list = bySkin[r.skinId] ?? [];
      list.push(r.bookId);
      bySkin[r.skinId] = list;
    }
    console.log(
      JSON.stringify(
        {
          books: rows,
          count: rows.length,
          bySkin,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatBooksMatrixText(rows));
    console.log('\n  · SSOT: src/domain/books.ts · docs: src/domain/README.md');
  }
  process.exit(0);
}

const report = buildDomainStatusReport();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatDomainStatusText(report));
  console.log('\n  · docs: docs/PARTNER-DOMAIN.md · desk matrix: src/domain/README.md');
  console.log('  · skin matrix: bun run domain:skins');
  console.log('  · book matrix: bun run domain:books');
  console.log('  · host discover: bun run domain:host-discover -- --url=https://…');
}
