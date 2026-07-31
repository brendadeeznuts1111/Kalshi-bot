/**
 * HQ fragment routes via URLPattern.hash.
 *
 * URLPattern matches the fragment without the leading "#". The literal colon
 * in glossary routes must be escaped so the second colon can introduce the
 * named `concept` group.
 *
 * @see https://bun.com/blog/bun-v1.3.4#urlpattern-api
 * @see https://developer.mozilla.org/en-US/docs/Web/API/URLPattern/hash
 */

export type HqHashRoute =
  | { kind: 'glossary'; concept: string | null }
  | { kind: 'surface'; alias: string; target: string }
  | { kind: 'component'; component: string; target: string };

export const GLOSSARY_ROOT_PATTERN = new URLPattern({ hash: 'glossary' });
export const GLOSSARY_CONCEPT_PATTERN = new URLPattern({
  hash: 'glossary\\::concept',
});
export const SIMPLE_HASH_PATTERN = new URLPattern({ hash: ':target' });

export const HQ_SURFACE_ALIASES = Object.freeze({
  live: 'live-board',
});

const HASH_BASE_URL = 'https://hq.factory-wager.test/';
const TARGET_TOKEN = /^[A-Za-z0-9_.-]+$/;

function hrefFromInput(input: string | URL): string {
  if (input instanceof URL) return input.href;
  return new URL(String(input || ''), HASH_BASE_URL).href;
}

function decodedToken(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

/**
 * Parse one HQ fragment without manual hash slicing.
 *
 * `#events?...` is owned by the event-filter state machine and intentionally
 * returns null here.
 *
 */
export function parseHqHashRoute(
  input: string | URL,
  aliases: Readonly<Record<string, string>> = HQ_SURFACE_ALIASES
): HqHashRoute | null {
  const href = hrefFromInput(input);
  const glossaryMatch = GLOSSARY_CONCEPT_PATTERN.exec(href);
  if (glossaryMatch) {
    const concept = decodedToken(glossaryMatch.hash.groups.concept || '');
    return TARGET_TOKEN.test(concept) ? { kind: 'glossary', concept } : null;
  }
  if (GLOSSARY_ROOT_PATTERN.test(href)) {
    return { kind: 'glossary', concept: null };
  }

  const simpleMatch = SIMPLE_HASH_PATTERN.exec(href);
  if (!simpleMatch) return null;
  const target = decodedToken(simpleMatch.hash.groups.target || '');
  if (!TARGET_TOKEN.test(target)) return null;
  const aliasTarget = aliases[target];
  return aliasTarget
    ? { kind: 'surface', alias: target, target: aliasTarget }
    : { kind: 'component', component: target, target };
}

/** Build the canonical glossary fragment for history.replaceState. */
export function glossaryHash(concept?: string | null): string {
  return concept ? `#glossary:${encodeURIComponent(concept)}` : '#glossary';
}

/**
 * Reveal the owning tab and scroll a surface/component route into view.
 *
 */
export function scrollToHqHashTarget(route: HqHashRoute | null, doc: Document): boolean {
  if (!route || route.kind === 'glossary') return false;
  const target = doc.getElementById(route.target);
  if (!target) return false;

  const tab = target.closest?.('section.tab');
  const tabName = tab?.id?.startsWith('tab-') ? tab.id.slice(4) : '';
  if (tabName) {
    doc.querySelector<HTMLButtonElement>(`nav.tabs button[data-tab="${tabName}"]`)?.click();
  }
  target.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  target.dataset.hashRouteActive = 'true';
  return true;
}
