// @see https://bun.com/docs/test/index#run-tests
/**
 * Guard: retired bare-book DOMAIN env must not be *read* in production src/.
 * The string may appear only inside RETIRED_BARE_BOOK_DOMAIN_ENVS denylist.
 */
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { RETIRED_BARE_BOOK_DOMAIN_ENVS } from '../../src/domain/index.ts';

describe('retired bare-book DOMAIN env scan', () => {
  test('src/ only mentions retired keys inside the denylist constant', async () => {
    const hits: string[] = [];
    for await (const path of new Glob('src/**/*.{ts,tsx}').scan('.')) {
      const text = await Bun.file(path).text();
      for (const key of RETIRED_BARE_BOOK_DOMAIN_ENVS) {
        if (!text.includes(key)) continue;
        // Allow the denylist definition / isRetired helper module only.
        if (path === 'src/domain/skins.ts' || path === 'src/domain/index.ts') continue;
        // Allow explicit isRetiredBareBookDomainEnv(envKey) call sites (no string literal).
        if (!text.includes(`'${key}'`) && !text.includes(`"${key}"`)) continue;
        hits.push(`${path}: ${key}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
