/**
 * channel-registry.ts — the CHANNEL SSOT for the dashboard signal pipeline.
 *
 * Every channel on /dashboard (and its signals, actions, cron and alerting)
 * is declared here once. The pipeline (signal-pipeline.ts), the action
 * dispatcher (serve.ts /api/signals/actions/*), the cron registrations and
 * the dashboard rendering all derive from this single table — never inline
 * unions or hardcoded label maps.
 *
 * Contract (unit-tested in tests/institutions/channel-registry.test.ts):
 *   - every ChannelId has exactly one ChannelDef with a label + description
 *   - every channel declares >= 1 source (a file/gate that produces signals)
 *   - actions listed here are the ONLY action names the dispatcher accepts
 *   - CHANNEL_ORDER is the rendering + live-refresh order on /dashboard
 */

export const CHANNEL_IDS = [
  'design',
  'deps',
  'brand',
  'releases',
  'ops',
  'inventory',
  'cron',
  'prune',
  'mapping',
  'docs',
  'compliance',
  'github',
] as const;

export type ChannelId = (typeof CHANNEL_IDS)[number];

export type ChannelCron = { expr: string; title: string };

export type ChannelDef = {
  id: ChannelId;
  label: string;
  description: string;
  /** Sources that produce signals for this channel (files/gates). */
  sources: readonly string[];
  /** Action names the dispatcher accepts for this channel. */
  actions: readonly string[];
  /** Rendering order on /dashboard (ascending). */
  dashboardOrder: number;
  /** Bun.cron refresh job this channel reports on (when any). */
  cron?: ChannelCron;
  /** Channel alerts fan out to Telegram (opt-in, §106 pattern). */
  telegram?: boolean;
};

export const CHANNEL_DEFS: Record<ChannelId, ChannelDef> = {
  design: {
    id: 'design',
    label: 'Design',
    description: 'Bundle budgets / largest contributors / deltas from dist metafiles + history',
    sources: ['dist/*.meta.json', 'dist/*.meta.md', 'design:check budgets', 'design-budget.ts'],
    actions: [],
    dashboardOrder: 1,
  },
  deps: {
    id: 'deps',
    label: 'Dependencies',
    description: 'Offline dependency gates: dedupe --check, prune --dry-run, bun audit',
    sources: ['bun dedupe', 'bun prune', 'bun audit'],
    actions: ['deps-check'],
    dashboardOrder: 2,
  },
  brand: {
    id: 'brand',
    label: 'Brand',
    description: 'Brand asset metrics: card/swatch/svg/badge/quote/chart hits, errors, purge count',
    sources: ['brand metrics', 'brand-image.ts', 'design-tokens.ts (BRAND)'],
    actions: ['brand-card', 'purge-brand'],
    dashboardOrder: 3,
  },
  releases: {
    id: 'releases',
    label: 'Releases',
    description: 'bun.sh RSS + GitHub releases.atom cross-checked latest release',
    sources: ['bun.sh RSS', 'GitHub atom', 'release-blog.ts'],
    actions: ['release-check'],
    dashboardOrder: 4,
  },
  ops: {
    id: 'ops',
    label: 'Ops',
    description: 'Served assets, uptime, runtime + design version',
    sources: ['serve routes', 'runtime'],
    actions: [],
    dashboardOrder: 5,
  },
  inventory: {
    id: 'inventory',
    label: 'Inventory',
    description: 'Data-asset coverage: massey, event-store, cross-market registry, providers, patterns',
    sources: ['massey.db', 'event-store.db', 'sports-sources.json', 'keywords.json', 'fonbet', 'venue-badge', 'partner'],
    actions: [],
    dashboardOrder: 6,
  },
  cron: {
    id: 'cron',
    label: 'Cron',
    description: 'Bun.cron refresh job state for the signal pipeline itself',
    sources: ['Bun.cron', 'registerSignalCron'],
    actions: [],
    dashboardOrder: 7,
    cron: { expr: '*/5 * * * *', title: 'signal refresh' },
  },
  prune: {
    id: 'prune',
    label: 'Content Prune',
    description: 'Content-plane prune state: manifest integrity + .trash/ footprint',
    sources: ['content manifest', '.trash/', 'content:prune'],
    actions: ['content-check'],
    dashboardOrder: 8,
  },
  mapping: {
    id: 'mapping',
    label: 'Blog Mapping',
    description: 'Blog → repo mapping tracker state (bun:blog-map)',
    sources: ['bun:blog-map', '.data/blog-map-state.json'],
    actions: ['blog-map'],
    dashboardOrder: 9,
    cron: { expr: '0 3 * * *', title: 'daily blog-map refresh' },
  },
  docs: {
    id: 'docs',
    label: 'Docs',
    description: 'Repo docs-quality gates: render, api tokens, integrity links, output canary',
    sources: ['docs:check', 'docs:api', 'docs:integrity', 'output:probe'],
    actions: ['docs:check', 'docs:api', 'docs:integrity', 'output:probe', 'docs:refresh'],
    dashboardOrder: 10,
  },
  compliance: {
    id: 'compliance',
    label: 'Compliance',
    description: 'License gate health + expiring exemptions; Telegram alert fan-out (opt-in)',
    sources: ['licenses:gate', '.data/licenses-state.json'],
    actions: ['licenses:gate'],
    dashboardOrder: 11,
    telegram: true,
  },
  github: {
    id: 'github',
    label: 'GitHub',
    description: 'Live research budget: token source + rate-limit buckets (core/search/code_search)',
    sources: ['api.github.com/rate_limit', 'github-network.ts', 'github-budget.ts'],
    actions: [],
    dashboardOrder: 12,
  },
};

/** Rendering + live-refresh order on /dashboard. */
export const CHANNEL_ORDER: readonly ChannelId[] = [...CHANNEL_IDS].sort(
  (a, b) => CHANNEL_DEFS[a].dashboardOrder - CHANNEL_DEFS[b].dashboardOrder,
);

/** All action names the dispatcher accepts, in channel order. */
export const CHANNEL_ACTIONS: readonly string[] = CHANNEL_ORDER.flatMap((id) => CHANNEL_DEFS[id].actions);

/** Register a channel id/def pair — asserts the id matches its def (dev aid). */
export function isKnownChannel(id: string): id is ChannelId {
  return (CHANNEL_IDS as readonly string[]).includes(id);
}
