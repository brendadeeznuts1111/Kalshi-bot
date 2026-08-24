/**
 * docs-style.ts — smart docs structure gate.
 *
 * The naive approach (grep -c '^\s*[-*]\s') just counts bullets — a number
 * without meaning. This detects the actual problem: a section that is a
 * wall of flat bullets with no subsection headers (###) and no tables is
 * unstructured prose (the run-on pattern §55-57 used to be).
 *
 * Per markdown section (## header .. next ##):
 *   - flatBullets: lines starting with '- ' or '* ' (not nested list items)
 *   - hasSubsections: any '### ' line
 *   - hasTables: any '| ' table row
 *   - unstructured: flatBullets >= BULLET_WALL (default 6) AND no
 *     subsections AND no tables
 */
export const BULLET_WALL = 6;
/** Flag only PROSE walls: many bullets AND at least one long prose bullet —
 * short factual lists (e.g. security notes) are good markdown, not walls. */
export const BULLET_MAX_LEN = 200;

export type DocsStyleIssue = {
  file: string;
  section: string;
  flatBullets: number;
  detail: string;
};

export function auditDocsStyle(markdown: string, file: string): DocsStyleIssue[] {
  const issues: DocsStyleIssue[] = [];
  const lines = markdown.split('\n');
  let section = '(preamble)';
  let bullets: string[] = [];
  let hasSub = false;
  let hasTable = false;

  const flush = () => {
    if (bullets.length >= BULLET_WALL && !hasSub && !hasTable) {
      const maxLen = bullets.reduce((a, b) => Math.max(a, b.length), 0);
      if (maxLen >= BULLET_MAX_LEN) {
        issues.push({
          file,
          section,
          flatBullets: bullets.length,
          detail: 'prose bullet wall (' + bullets.length + ' bullets, longest ' + maxLen + ' chars, no ### subsections, no tables) — split into ### sections or a table',
        });
      }
    }
    bullets = [];
    hasSub = false;
    hasTable = false;
  };

  for (const line of lines) {
    if (/^##\s/.test(line)) { flush(); section = line.replace(/^##\s+/, '').slice(0, 60); continue; }
    if (/^###\s/.test(line)) { hasSub = true; continue; }
    if (/^\|\s/.test(line)) { hasTable = true; continue; }
    if (/^\s*-\s/.test(line) || /^\s*\*\s/.test(line)) { bullets.push(line); continue; }
    // a non-list, non-header content line resets the wall (it's prose, not a wall)
    if (line.trim() && !/^\s*$/.test(line)) bullets = [];
  }
  flush();
  return issues;
}