#!/usr/bin/env bun
/**
 * Desk domain matrix CLIs only (host → book → skin).
 *
 *   bun run domain:skins
 *   bun run domain:skins -- --json
 *   bun run domain:books
 *   bun run domain:books -- --json
 *
 * Seat-ops status / expansion map: bun run ops:status · bun run ops:map
 * Host discover: bun run domain:host-discover
 *
 * @see src/domain/README.md
 * @see src/domain/skin-matrix.ts
 * @see src/domain/books.ts
 */
import {
  buildBookMatrixRows,
  buildSkinMatrixRows,
  formatBooksMatrixText,
  formatSkinMatrixText,
} from '../src/domain/index.ts';

const json = process.argv.includes('--json');
const skins = process.argv.includes('--skins') || process.argv.includes('--skin-matrix');
const books = process.argv.includes('--books') || process.argv.includes('--book-matrix');

if (skins && books) throw new TypeError('Choose one of --skins or --books');
if (!skins && !books) {
  throw new TypeError(
    'Desk matrix CLI requires --skins or --books. For seat-ops use: bun run ops:status'
  );
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

// books
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
