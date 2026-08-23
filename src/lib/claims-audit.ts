/**
 * Claims-audit core: check pasted claims against a reference document
 * (release blog HTML). Pure functions only - no network here.
 *
 * Discipline (docs/AGENT-PITFALLS.md sections 13/15): AI-pasted summaries
 * of release notes mix verified facts with invented numbers/mechanisms.
 * Before acting on any claim, grep the primary source. This module makes
 * that checkable in one call (tools/bun-claims-audit.ts is the CLI).
 */

export type ClaimVerdict = { claim: string; found: boolean };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check claims against lowercased reference text.
 * By default matches at word boundaries (avoids 'stranger' matching
 * 'strangler-fig'); pass all=true for substring matching.
 * Returns verdicts in input order plus the count absent.
 */
export function auditClaims(
  claims: string[],
  referenceHtml: string,
  options?: { all?: boolean },
): { verdicts: ClaimVerdict[]; absent: number } {
  const hay = referenceHtml.toLowerCase();
  const verdicts: ClaimVerdict[] = [];
  let absent = 0;
  for (const c of claims) {
    const esc = escapeRegExp(c.toLowerCase());
    const pat = options?.all ? esc : '(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)';
    const found = new RegExp(pat).test(hay);
    if (!found) absent++;
    verdicts.push({ claim: c, found });
  }
  return { verdicts, absent };
}

/** Strip HTML tags/entities so claims can be matched against visible text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
}