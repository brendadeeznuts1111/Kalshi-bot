/**
 * One-call booked enrich entrypoint (public catalog + optional adapter).
 * Prefer CLI: `bun run inventory:sync -- --enrich-only`
 *
 *   import { enrichBookedEvents } from './src/inventory/enrich-booked.ts';
 *   await enrichBookedEvents({ enrichOnly: true, enrichBookedScope: 'unlinked' });
 */
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from '../institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../institutions/event-store/paths.ts';
import {
  getFantasySessionAdapter,
  loadFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromEnv,
} from '../partner/index.ts';
import type { PartnerAccountProfile } from '../partner/account-profile.ts';
import type { FantasySessionAdapter } from '../partner/types.ts';
import { maybeNotifyInventoryTelegram } from './notify.ts';
import { publicFantasyProfile } from './public-profile.ts';
import {
  runInventorySync,
  type EnrichBookedScope,
  type InventorySyncOptions,
  type InventorySyncReport,
} from './sync.ts';
import type { BookedMatchEntry } from './booked-match.ts';

export type EnrichBookedEventsOptions = {
  enrichOnly?: boolean;
  enrichBookedScope?: EnrichBookedScope;
  enrichCatalogMax?: number;
  /** Max candidates this tick (Map-lane batch). */
  enrichLimit?: number | null;
  /** Inject catalog (tests / offline) — skips public Statscore fetch. */
  bookedCatalog?: BookedMatchEntry[];
  sport?: string;
  dryRun?: boolean;
  nowMs?: number;
  dbPath?: string;
  /** When true (default for enrich-only public), use dummy Fantasy profile. */
  publicOk?: boolean;
  /** Telegram ops alert when validation fails (needs TELEGRAM_*). */
  notifyOnValidateFail?: boolean;
  /** Enrich quality gates (match-rate 0–1, linkedPct 0–100). */
  minMatchRate?: number | null;
  minLinkedPct?: number | null;
  adapter?: FantasySessionAdapter;
  profile?: PartnerAccountProfile;
};

function resolveProfile(publicOk: boolean): PartnerAccountProfile {
  const fromEnv = loadFantasy402ProfileFromEnv();
  if (fromEnv) return fromEnv;
  if (
    publicOk ||
    Bun.env.INVENTORY_SYNC_PUBLIC === '1' ||
    Bun.env.PARTNER_SYNC_PUBLIC === '1'
  ) {
    return publicFantasyProfile();
  }
  return requireFantasy402ProfileFromEnv();
}

/**
 * Run inventory enrich (default: enrich-only / unlinked / public catalog).
 */
export async function enrichBookedEvents(
  options: EnrichBookedEventsOptions = {}
): Promise<InventorySyncReport> {
  const enrichOnly = options.enrichOnly !== false;
  const publicOk = options.publicOk !== false;
  const db = openEventStore({
    dbPath: options.dbPath ?? DEFAULT_EVENT_STORE_DB,
  });
  const profile = options.profile ?? resolveProfile(publicOk || enrichOnly);
  const adapter =
    options.adapter ??
    getFantasySessionAdapter(profile, { warmSession: false });
  try {
    await adapter.login();
  } catch {
    /* public catalog path */
  }

  const syncOpts: InventorySyncOptions = {
    sport: options.sport ?? 'all',
    enrichOnly,
    enrichBooked: true,
    enrichBookedScope: options.enrichBookedScope ?? (enrichOnly ? 'unlinked' : 'board'),
    enrichCatalogMax: options.enrichCatalogMax ?? 2000,
    enrichLimit: options.enrichLimit,
    bookedCatalog: options.bookedCatalog,
    dryRun: options.dryRun === true,
    nowMs: options.nowMs,
    minMatchRate: options.minMatchRate,
    minLinkedPct: options.minLinkedPct,
  };

  const report = await runInventorySync(db, adapter, syncOpts);

  if (
    options.notifyOnValidateFail &&
    report.enrichValidation &&
    !report.enrichValidation.passed
  ) {
    await maybeNotifyInventoryTelegram({
      title: `⚠️ Enrichment incomplete: ${report.enrichValidation.unlinkedRemaining} unlinked`,
      lines: report.enrichValidation.errors.slice(0, 12),
    });
  }

  return report;
}
