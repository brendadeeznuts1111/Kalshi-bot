// @see https://llmstxt.org — llms.txt convention
/** Shared llms.txt bodies — used by serve-public (live) and tools/llms-static.ts (Pages mirror). */

export const PORTAL_MD_SLUGS = [
  'index',
  'ops',
  'catalog',
  'dod',
  'health',
  'env',
  'skills',
  'monitoring',
] as const;

export function llmsTxtBody(): string {
  return `# FactoryWager

> Factory registry, operations portal, and evidence (DOD) pipeline.

## Portal (machine-readable markdown)

Fetch with \`Accept: text/markdown\` for raw markdown; HTML renders otherwise.

- [Registry](portal/index.md): package registry overview
- [Ops](portal/ops.md): operations dashboard (tree, plays, rails)
- [Catalog](portal/catalog.md): platform + account catalog
- [DOD](portal/dod.md): visual-proof submission queue
- [Health](portal/health.md): service health
- [Env](portal/env.md): environment + secret status (redacted)
- [Skills](portal/skills.md): installed skills registry + package downloads
- [Monitoring](portal/monitoring.md): registry + integrity metrics

## JSON APIs

- [GET /api/monitoring](api/monitoring): registry + ops metrics, integrity snapshot
- [GET /api/operations/summary](api/operations/summary): live ops summary
- [GET /api/registry](api/registry): npm-compatible registry index
- [GET /api/env](api/env): env var status (redacted values)
- [GET /health](health): uptime + artifact freshness probe

## Artifacts (static)

- [ops-summary.json](registry/ops-summary.json): portal ops snapshot
- [dod-registry.json](registry/dod-registry.json): DOD snapshot registry
- [registry.json](registry/registry.json): package index

## Full corpus

- [llms-full.txt](llms-full.txt): all portal markdown inlined in one file
`;
}

export function llmsFullTxtBody(portalMarkdownRaw: (slug: string) => string): string {
  const sections = PORTAL_MD_SLUGS.map(
    slug => `# portal/${slug}.md\n\n${portalMarkdownRaw(slug)}`
  ).join('\n\n---\n\n');
  return `# FactoryWager — full portal corpus\n\n${sections}`;
}
