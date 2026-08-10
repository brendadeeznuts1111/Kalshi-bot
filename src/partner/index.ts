export type {
  FantasySessionAdapter,
  InventoryEvent,
  PartnerAccountStatus,
  PartnerBetGroup,
  PartnerBookedEvent,
  PartnerComponentBet,
  PartnerExecutionResult,
  PartnerLimits,
  PartnerLiveUrlSet,
  PartnerMarket,
  PartnerOrder,
  PartnerOrderAdapter,
  PartnerSportLeague,
  SurfaceAdapterId,
} from './types.ts';

export * from './execution/index.ts';

export {
  credentialsFromFantasyProfile,
  fantasyDeskEnvPresence,
  fantasyVaultItemTitle,
  listPartnerAccountsFromEnv,
  loadFantasy402ProfileFromEnv,
  loadFantasy402ProfileFromPrefix,
  profileFromEnvBundle,
  profileWithLiveProduct,
  requireFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromPrefix,
  type PartnerAccountProfile,
} from './account-profile.ts';

export {
  FantasyUltraAdapter,
  type ConnectWebSocketOptions,
  type FantasyUltraAdapterOptions,
} from './fantasy-ultra/adapter.ts';
export { CookieJar } from './fantasy-ultra/cookie-jar.ts';
export {
  executionResultFromBetGroups,
  inspectStreamListCapabilities,
  normalizeClientEventIdCandidates,
  orderIntentFromComponentBet,
  originFromLiveUrl,
  parseBetGroupsResponse,
  parseRenewTokenResponse,
  parseSportsLeagues,
  parseStatscoreBookedEvents,
  parseStreamList,
  parseUltraLiveUrlResponse,
  statscorePayloadHasPrices,
  type StreamListCapabilities,
} from './fantasy-ultra/parse.ts';
export {
  extractBetGroupsWiresFromHar,
  extractPlaceBetMapFromHar,
  listPlaceBetHarCandidates,
  loadHarFile,
  looksLikeBetGroupsWire,
  placeBetMapFromCandidate,
  type PlaceBetBodyEncoding,
  type PlaceBetEndpointMap,
  type PlaceBetHarCandidate,
} from './fantasy-ultra/place-bet-har.ts';
export {
  buildPlaceBetBody,
  defaultPlaceBetFields,
  encodePlaceBetBody,
  resolvePlaceBetUrl,
} from './fantasy-ultra/place-bet-body.ts';
export { FANTASY_ULTRA_DEFAULTS, type FantasyUltraCredentials } from './fantasy-ultra/types.ts';

export {
  formatSportHistogram,
  formatSyncReport,
  matchBookedOddsEventId,
  planInventoryUpsert,
  runInventorySync,
  sportHistogramFromEvents,
  type InventorySyncOptions,
  type InventorySyncReport,
} from '../inventory/sync.ts';

export {
  countInventoryLeagues,
  ensureInventoryLeaguesSchema,
  formatLeagueLine,
  listInventoryLeagues,
  planInventoryLeagues,
  stampInventoryLeaguesCompetitionIds,
  stampInventoryLeaguesFromRecords,
  upsertInventoryLeagues,
  type InventoryLeagueRow,
  type InventoryLeagueUpsertResult,
} from '../inventory/leagues.ts';

export {
  fetchPublicPliveStreamEvents,
  filterLiveEventsBySport,
  formatSkinEventLine,
  listSkinInventoryIds,
  normalizeSkinEventsSports,
  resolveInventoryCompetitionId,
  stampSkinEventsCompetitionIds,
  upsertSkinLiveEvents,
  type SkinEventRow,
  type SkinEventUpsertResult,
} from '../inventory/skin-events-store.ts';

export {
  adapterBindingForSkin,
  assertLiveProductsAllowed,
  buildSkinMetaFields,
  capacityToOutCapacityRows,
  computeProviderCapacity,
  concentrationByOut,
  ensurePartnerRegistrySchema,
  getBettingAccountById,
  guardAndStampAccountMeta,
  listActiveBettingAccounts,
  listBettingAccountsByProvider,
  listEligibleOutCapacityPairs,
  liquidityKey,
  bookIdFromAccount,
  mapperFromAccount,
  outCapacityFromAccount,
  outIdentityFromAccount,
  parseLiveProductsJsonEnv,
  parseOutIdentity,
  pickBestCapacityForOut,
  resolveOutCapacity,
  resolveSkinForAccountUrl,
  seedFantasy402FromEnv,
  seedFantasySportMappings,
  skinIdFromAccount,
  stampOutMeta,
  upsertBettingAccount,
  upsertPartner,
  type AdapterBinding,
  type BettingAccountRow,
  type LiveProductCapacity,
  type MapperAdapterId,
  type OutCapacity,
  type OutCapacityPair,
  type OutCapacityRow,
  type OutExposureShare,
  type OutIdentity,
  type PartnerEntity,
  type ProviderCapacity,
  type ProviderId,
} from './registry.ts';

export {
  buildOutCapacityMeta,
  formatOutId,
  formatVaultName,
  normalizeCapacityWireName,
  parseLiquidityKey,
  parseLiveProductWire,
  parseOutMeta,
  type CapacityWireName,
  type OutMapperKind,
  type OutMeta,
} from './out-capacity.ts';

export {
  DEFAULT_HOST_DISCOVER_ARTIFACT_DIR,
  HOST_DISCOVER_BASELINES,
  HOST_FINGERPRINT_RULES,
  adapterIdForMappedSkin,
  collectHtmlUrls,
  discoverHost,
  extractAbsoluteUrls,
  extractUrlsFromHar,
  formatHostDiscoverText,
  listMappedDiscoverHosts,
  listPublicFingerprintRules,
  listSkinBrandFingerprintRules,
  persistHostDiscoverUrls,
  scoreHostDiscovery,
  type HostDiscoverEvidence,
  type HostDiscoverReport,
  type HostDiscoverTarget,
  type HostDiscoverWeigh,
  type SuggestedSkinId,
  type DeskAdapterId,
} from '../domain/host-discover.ts';

export {
  CATEGORY_CAPS,
  buildHostObservations,
  decisionForScore,
  scoreFromEvidence,
  scoreHostAgainstSkins,
  scoreSkinObservations,
  type EvidenceCategory,
  type HostDiscoverDecision,
  type HostObservations,
  type SkinWeightedScore,
  type WeightedEvidenceItem,
} from '../domain/host-weighted-score.ts';

export {
  BINDING_STATUSES,
  BOOKS,
  BOOK_IDS,
  DEFAULT_COVERAGE_LIVE_PRODUCT,
  HOST_TO_BOOK,
  HOST_TO_SKIN,
  LEGACY_CAPACITY_LIVE_PRODUCTS,
  LIVE_PRODUCT_IDS,
  LIVE_PRODUCTS,
  LIVE_PRODUCT_SPORT_BINDINGS,
  DESK_DOMAIN_ENV,
  RETIRED_BARE_BOOK_DOMAIN_ENVS,
  deskDomainFromEnvMap,
  SKIN_IDS,
  SKINS,
  SPORTS,
  SPORT_CATEGORIES,
  bookOffersLiveProduct,
  buildBookMatrixRows,
  formatBooksMatrixText,
  getBook,
  getBookByHost,
  getLiveProduct,
  getSkin,
  getSkinByHost,
  getSport,
  getSportsByCategory,
  isBookId,
  isLegacyCapacityLiveProduct,
  isLiveProductId,
  isRetiredBareBookDomainEnv,
  isSkinId,
  isSportId,
  listBookIdsForSkin,
  listBooks,
  listBooksForSkin,
  listLiveProductSportBindings,
  listLiveProducts,
  listSkins,
  listSports,
  liveProductHasSportCoverage,
  liveProductOwnsCoverage,
  liveProductsWithBindings,
  normalizeHost,
  normalizeLiveProductName,
  resolveBookId,
  resolveSkinId,
  resolveSport,
  skinIdForBook,
  skinOfferedCatalogNames,
  skinOffersLiveProduct,
  type BindingStatus,
  type BookId,
  type BookMatrixRow,
  type BookRecord,
  type LegacyCapacityLiveProduct,
  type LiveProductId,
  type LiveProductRecord,
  type LiveProductSportBinding,
  type ResolveSportQuery,
  type ResolvedSport,
  type SkinId,
  type SkinMapper,
  type SkinRecord,
  type SportCategory,
  type SportId,
  type SportRecord,
} from '../domain/index.ts';

export {
  FANTASY_SPORT_MAPPINGS,
  FANTASY_WIDGET_CONFIG,
  WIDGET_FAVORITES_SPORT_ID,
  WIDGET_SPORT_ORDER,
  fantasySportByApiId,
  fantasySportByCanonical,
  fantasySportByStreamBucket,
  fantasySportByWidgetId,
  mappedStreamBuckets,
  primaryFantasySports,
  type FantasySportMapping,
} from './fantasy-ultra/widget-config.ts';

export {
  fetchStreamSportsInventory,
  inventoryFromStreamList,
  staticSportMapSummary,
  type StreamSportInventoryRow,
  type StreamSportLeagueRow,
  type StreamSportsInventory,
} from '../inventory/sports-inventory.ts';

export {
  OPS_LAYERS,
  PARTNER_NAMING,
  buildOpsStatusReport,
  formatOpsStatusText,
  type OpsComponent,
  type OpsLayer,
  type OpsLayerId,
  type OpsMaturity,
  type OpsStatusReport,
} from './architecture.ts';

export {
  classifyTicketStatus,
  ensurePartnerLedgerSchema,
  insertPartnerLedgerRow,
  listLedgerFreshness,
  sumTicketTotalsForDay,
  writeDeskSnapshot,
  writeOddsBookSnapshot,
  writeTicketFromBetGroup,
  writeTicketFromExecution,
  type LedgerFreshness,
  type PartnerLedgerKind,
  type PartnerLedgerRow,
  type TicketDayTotals,
  type TicketLedgerStatus,
  type TicketOutDayTotals,
  type TicketWriteAction,
  type TicketWriteResult,
} from './ledger.ts';

export {
  applyRiskThreshold,
  evaluateRiskHealth,
  filterFindingsByThreshold,
  formatRiskHealthTelegram,
  formatRiskHealthText,
  parseRiskThreshold,
  riskHealthFingerprint,
  riskOkUnderThreshold,
  toRiskHealthJsonSnapshot,
  type RiskFinding,
  type RiskHealthJsonSnapshot,
  type RiskHealthOptions,
  type RiskHealthReport,
  type RiskSeverity,
  type RiskThreshold,
} from './risk-health.ts';

export {
  capturePandoraViaWebView,
  type WebViewCaptureOptions,
  type WebViewCaptureResult,
} from './webview-ws-capture.ts';

export {
  findLatestWebViewCapture,
  ingestWebViewWsFrames,
  ingestWebViewWsJsonl,
  type WebViewIngestReport,
  type WebViewWsFrame,
} from './webview-ws-ingest.ts';

export {
  runWebViewWsPipeline,
  type WebViewPipelineOptions,
  type WebViewPipelineResult,
} from './webview-ws-pipeline.ts';

export {
  formatFinanceCronReportText,
  notifyTelegramFinance,
  runFinanceCron,
  type FinanceCronOptions,
  type FinanceCronOutRow,
  type FinanceCronPartnerGroup,
  type FinanceCronReport,
} from './finance-cron.ts';

export {
  PARTNER_OPERATOR_COMMANDS,
  buildPartnerDashboardSnapshot,
  renderPartnerDashboardHtml,
  type PartnerDashboardSnapshot,
} from './dashboard-data.ts';

export {
  DEFAULT_PARTNERS_TOML,
  DEFAULT_REQUIRED_ENV_KEYS,
  EXAMPLE_PARTNERS_TOML,
  PARTNER_ENV_KEYS,
  buildPartnersTomlFromRows,
  canonicalOutEnvPrefix,
  canonicalPartnerEnvPrefix,
  canonicalVaultId,
  checkPartnersEnvPresence,
  diffPartnersTomlVsDb,
  envPrefixFallbackChain,
  formatEnvPresenceText,
  formatPartnerAssetIssues,
  formatPartnersDiffText,
  isBareBookEnvPrefix,
  isOutScopedEnvPrefix,
  isPartnerScopedEnvPrefix,
  loadPartnersTomlFile,
  loadRegistrySnapshot,
  materializePartnersToml,
  normalizeEnvPrefix,
  parseOutId,
  parsePartnersToml,
  partnerEnvPresence,
  partnersTomlDocSchema,
  resolveDeskDomainFromEnv,
  resolvePartnerEnv,
  seedRegistryFromPartnersToml,
  stringifyPartnersToml,
  validatePartnerAssetPrefixes,
  type DiffEntry,
  type EnvPresenceReport,
  type PartnerAssetIssue,
  type PartnerEnvBundle,
  type PartnerEnvKey,
  type PartnerEnvSource,
  type PartnersTomlDiff,
  type PartnersTomlDoc,
  type PartnersTomlLoadResult,
  type PartnersTomlOut,
  type PartnersTomlPartner,
  type PartnersTomlSkin,
  type RegistrySnapshot,
} from './toml-config.ts';

export {
  colorizePartnerText,
  contrastTextColorForRgb,
  formatPartnerVisualLine,
  getContrastTextColor,
  getPartnerVisual,
  partnerAvatarSvg,
  partnerCssVars,
  partnerHsl,
  partnerHue,
  partnerInitials,
  relativeLuminanceFromRgb,
  writePartnerAvatarPng,
  type PartnerVisual,
  type RgbaArray,
  type RgbaObject,
  type RgbArray,
  type RgbObject,
} from './visuals.ts';

export {
  americanToDecimal,
  decimalToAmerican,
  normalizeOdds,
  roundUsOddsDown,
  truncateDecimal,
  type DualOdds,
  type OddsFormat,
} from './odds-format.ts';

export {
  PandoraSocket,
  PANDORA_DEFAULT_SESSION,
  buildPliveSubscribeSequence,
  defaultPandoraSocketUrl,
  encodeSocketIoEmit,
  parseEngineOpen,
  parseSocketIoEvent,
  EIO,
  SIO,
  type PandoraLiveSessionIds,
  type PandoraOpenInfo,
  type PandoraSocketHandlers,
  type PandoraSocketOptions,
} from './fantasy-ultra/pandora-socket.ts';

export {
  applyCoefficientDiff,
  decodePandoraAttachment,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  parseBinaryEventHeader,
  type CoefficientEnvelope,
  type CoefficientLine,
  type PandoraTi,
} from './fantasy-ultra/coefficients.ts';

export {
  CoefficientStore,
  sharedCoefficientStore,
  type CoefficientIngest,
} from './fantasy-ultra/coefficient-store.ts';

import type { PartnerAccountProfile } from './account-profile.ts';
import { credentialsFromFantasyProfile } from './account-profile.ts';
import { FantasyUltraAdapter } from './fantasy-ultra/adapter.ts';
import { getSkinByHost, isSkinId, type SkinId } from '../domain/index.ts';
import { adapterBindingForSkin, type MapperAdapterId } from './out-identity.ts';
import type { FantasySessionAdapter, PartnerOrderAdapter } from './types.ts';

/**
 * Resolve white-label skin: explicit skinId → host (HOST_TO_SKIN) → canonical SkinId.
 * Never forges SkinId from mapper/provider labels (`fantasy402` is an alias, not identity).
 */
export function resolveProfileSkinId(account: PartnerAccountProfile): SkinId | undefined {
  if (account.skinId) return account.skinId;
  const fromHost = account.url ? getSkinByHost(account.url) : undefined;
  if (fromHost) return fromHost;
  // partner field may carry a canonical SkinId only — not mapper aliases
  const partner = String(account.partner ?? '')
    .trim()
    .toLowerCase();
  if (isSkinId(partner)) return partner;
  return undefined;
}

/** Resolve mapper adapterId from profile skin (HOST_TO_SKIN / SkinId), not fantasy402 brand. */
export function resolveProfileAdapterId(account: PartnerAccountProfile): MapperAdapterId {
  if (account.adapterId) return account.adapterId;
  const skinId = resolveProfileSkinId(account);
  if (skinId) return adapterBindingForSkin(skinId).adapterId;
  if (account.partner === 'kalshi') return 'kalshi';
  return 'unmapped';
}

/** Instantiate adapter for a registry profile (optional execution live product). */
export function getPartnerAdapter(
  account: PartnerAccountProfile,
  options: {
    fetchImpl?: typeof fetch;
    warmSession?: boolean;
    /** Override out default live-product wire for this session (ezlive / dark / 2). */
    liveProduct?: string | number;
    /** @deprecated use liveProduct */
    skin?: string | number;
  } = {}
): PartnerOrderAdapter {
  const adapterId = resolveProfileAdapterId(account);
  if (adapterId === 'fantasy-ultra') {
    return new FantasyUltraAdapter({
      credentials: credentialsFromFantasyProfile(account, {
        liveProduct: options.liveProduct ?? options.skin,
      }),
      fetchImpl: options.fetchImpl,
      warmSession: options.warmSession,
    });
  }
  throw new Error(
    `No adapter for adapterId=${adapterId} partner=${account.partner} skinId=${account.skinId ?? resolveProfileSkinId(account) ?? '?'}`
  );
}

/** Typed Fantasy session adapter (renew / sports / warm). */
export function getFantasySessionAdapter(
  account: PartnerAccountProfile,
  options: {
    fetchImpl?: typeof fetch;
    warmSession?: boolean;
    liveProduct?: string | number;
    /** @deprecated use liveProduct */
    skin?: string | number;
  } = {}
): FantasySessionAdapter {
  if (resolveProfileAdapterId(account) !== 'fantasy-ultra') {
    throw new Error(
      `Not a fantasy-ultra account: adapterId=${resolveProfileAdapterId(account)} skinId=${account.skinId ?? '?'}`
    );
  }
  return new FantasyUltraAdapter({
    credentials: credentialsFromFantasyProfile(account, {
      liveProduct: options.liveProduct ?? options.skin,
    }),
    fetchImpl: options.fetchImpl,
    warmSession: options.warmSession,
  });
}
