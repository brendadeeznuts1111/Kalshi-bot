export type {
  FantasySessionAdapter,
  PartnerAccountStatus,
  PartnerBetGroup,
  PartnerBookedEvent,
  PartnerComponentBet,
  PartnerExecutionResult,
  PartnerId,
  PartnerLimits,
  PartnerLiveEvent,
  PartnerLiveUrlSet,
  PartnerMarket,
  PartnerOrder,
  PartnerOrderAdapter,
  PartnerSportLeague,
} from "./types.ts";

export * from "./execution/index.ts";

export {
  credentialsFromFantasyProfile,
  fantasyDeskEnvPresence,
  fantasyVaultItemTitle,
  listPartnerAccountsFromEnv,
  loadFantasy402ProfileFromEnv,
  loadFantasy402ProfileFromPrefix,
  profileFromEnvBundle,
  profileWithSkin,
  requireFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromPrefix,
  type PartnerAccountProfile,
} from "./account-profile.ts";

export {
  FantasyUltraAdapter,
  type ConnectWebSocketOptions,
  type FantasyUltraAdapterOptions,
} from "./fantasy-ultra/adapter.ts";
export { CookieJar } from "./fantasy-ultra/cookie-jar.ts";
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
} from "./fantasy-ultra/parse.ts";
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
} from "./fantasy-ultra/place-bet-har.ts";
export {
  buildPlaceBetBody,
  defaultPlaceBetFields,
  encodePlaceBetBody,
  resolvePlaceBetUrl,
} from "./fantasy-ultra/place-bet-body.ts";
export {
  FANTASY_ULTRA_DEFAULTS,
  type FantasyUltraCredentials,
} from "./fantasy-ultra/types.ts";

export {
  formatSyncReport,
  matchBookedClientEventId,
  runPartnerInventorySync,
  type PartnerSyncOptions,
  type PartnerSyncReport,
} from "./sync.ts";

export {
  filterLiveEventsBySport,
  formatPartnerEventLine,
  listPartnerStreamIds,
  upsertPartnerLiveEvents,
  type PartnerEventRow,
  type PartnerEventUpsertResult,
} from "./partner-events-store.ts";

export {
  computeProviderCapacity,
  concentrationByOut,
  ensurePartnerRegistrySchema,
  getBettingAccountById,
  listActiveBettingAccounts,
  listBettingAccountsByProvider,
  listEligibleOutSkinPairs,
  liquidityKey,
  outCapacityFromAccount,
  parseSkinsJsonEnv,
  pickBestSkinForOut,
  resolveOutSkins,
  seedFantasy402FromEnv,
  seedFantasySportMappings,
  upsertBettingAccount,
  upsertPartner,
  type BettingAccountRow,
  type OutCapacity,
  type OutExposureShare,
  type OutSkinLimit,
  type OutSkinPair,
  type PartnerEntity,
  type ProviderCapacity,
  type ProviderId,
} from "./registry.ts";

export {
  buildSkinsMeta,
  formatOutId,
  formatVaultName,
  parseLiquidityKey,
  parseOutMeta,
  parseSkinWire,
  type OutMeta,
  type SkinName,
} from "./skins.ts";

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
} from "./fantasy-ultra/widget-config.ts";

export {
  fetchStreamSportsInventory,
  inventoryFromStreamList,
  staticSportMapSummary,
  type StreamSportInventoryRow,
  type StreamSportLeagueRow,
  type StreamSportsInventory,
} from "./sports-inventory.ts";

export {
  PARTNER_DOMAIN_LAYERS,
  PARTNER_NAMING,
  buildDomainStatusReport,
  formatDomainStatusText,
  type DomainComponent,
  type DomainLayer,
  type DomainLayerId,
  type DomainMaturity,
  type DomainStatusReport,
} from "./domain.ts";

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
} from "./ledger.ts";

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
} from "./risk-health.ts";

export {
  capturePandoraViaWebView,
  type WebViewCaptureOptions,
  type WebViewCaptureResult,
} from "./webview-ws-capture.ts";

export {
  findLatestWebViewCapture,
  ingestWebViewWsFrames,
  ingestWebViewWsJsonl,
  type WebViewIngestReport,
  type WebViewWsFrame,
} from "./webview-ws-ingest.ts";

export {
  runWebViewWsPipeline,
  type WebViewPipelineOptions,
  type WebViewPipelineResult,
} from "./webview-ws-pipeline.ts";

export {
  formatFinanceCronReportText,
  notifyTelegramFinance,
  runFinanceCron,
  type FinanceCronOptions,
  type FinanceCronOutRow,
  type FinanceCronPartnerGroup,
  type FinanceCronReport,
} from "./finance-cron.ts";

export {
  PARTNER_OPERATOR_COMMANDS,
  buildPartnerDashboardSnapshot,
  renderPartnerDashboardHtml,
  type PartnerDashboardSnapshot,
} from "./dashboard-data.ts";

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
} from "./toml-config.ts";

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
} from "./visuals.ts";

export {
  americanToDecimal,
  decimalToAmerican,
  normalizeOdds,
  roundUsOddsDown,
  truncateDecimal,
  type DualOdds,
  type OddsFormat,
} from "./odds-format.ts";

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
} from "./fantasy-ultra/pandora-socket.ts";

export {
  applyCoefficientDiff,
  decodePandoraAttachment,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  parseBinaryEventHeader,
  type CoefficientEnvelope,
  type CoefficientLine,
  type PandoraTi,
} from "./fantasy-ultra/coefficients.ts";

export {
  CoefficientStore,
  sharedCoefficientStore,
  type CoefficientIngest,
} from "./fantasy-ultra/coefficient-store.ts";

import type { PartnerAccountProfile } from "./account-profile.ts";
import { credentialsFromFantasyProfile } from "./account-profile.ts";
import { FantasyUltraAdapter } from "./fantasy-ultra/adapter.ts";
import type { FantasySessionAdapter, PartnerOrderAdapter } from "./types.ts";

/** Instantiate adapter for a registry profile (optional execution skin). */
export function getPartnerAdapter(
  account: PartnerAccountProfile,
  options: {
    fetchImpl?: typeof fetch;
    warmSession?: boolean;
    /** Override out default skin for this session (ezlive / dark / 2). */
    skin?: string | number;
  } = {},
): PartnerOrderAdapter {
  if (account.partner === "fantasy402") {
    return new FantasyUltraAdapter({
      credentials: credentialsFromFantasyProfile(account, {
        skin: options.skin,
      }),
      fetchImpl: options.fetchImpl,
      warmSession: options.warmSession,
    });
  }
  throw new Error(`No adapter for partner=${account.partner}`);
}

/** Typed Fantasy session adapter (renew / sports / warm). */
export function getFantasySessionAdapter(
  account: PartnerAccountProfile,
  options: {
    fetchImpl?: typeof fetch;
    warmSession?: boolean;
    skin?: string | number;
  } = {},
): FantasySessionAdapter {
  if (account.partner !== "fantasy402") {
    throw new Error(`Not a fantasy402 account: ${account.partner}`);
  }
  return new FantasyUltraAdapter({
    credentials: credentialsFromFantasyProfile(account, {
      skin: options.skin,
    }),
    fetchImpl: options.fetchImpl,
    warmSession: options.warmSession,
  });
}
