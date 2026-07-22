import type { CodeSearchHit, ResearchConfig } from "./types.ts";
import {
  AUTH_MARKERS,
  AUTH_FRESHNESS_MAX_DAYS,
  CENTS_PRICE_MARKERS,
  DEFAULT_STRATEGY_TAG,
  DRY_RUN_MARKERS,
  MS_PER_DAY,
  ORDER_MARKERS,
  PORTFOLIO_ORDERS_MARKER,
  RSA_PSS_MARKERS,
  SDK_MARKERS,
  SDK_ONLY_TAG,
  V2_API_MARKER,
} from "./constants.ts";

type RootEntry = { name: string };

export function detectTestsAndCi(entries: RootEntry[], text: string) {
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  return {
    hasTests:
      names.has("tests") ||
      names.has("test") ||
      names.has("__tests__") ||
      /\.test\.|\.spec\.|pytest|unittest|vitest|jest/i.test(text),
    hasCi: names.has(".github") || /github\/workflows|\.gitlab-ci|circleci/i.test(text),
  };
}

export function detectStrategyTags(text: string, config: ResearchConfig): string[] {
  const tags = Object.entries(config.keywords.strategyTags)
    .filter(([, keywords]) => keywords.some((k) => text.includes(k.toLowerCase())))
    .map(([tag]) => tag);
  return tags.length ? tags : [DEFAULT_STRATEGY_TAG];
}

export function detectReadmeSections(readme: string) {
  return {
    hasSetupSection: /##?\s*(setup|install|getting started|quick start)/i.test(readme),
    hasStrategySection: /##?\s*(strateg|architecture|how it works)/i.test(readme),
  };
}

export function primaryLanguage(languages: Record<string, number>): string | null {
  const entries = Object.entries(languages);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0]![0];
}

export function authCommitFresh(
  lastCommitAt: string | null,
  maxAgeDays = AUTH_FRESHNESS_MAX_DAYS,
): boolean {
  if (!lastCommitAt) return false;
  const ageDays = (Date.now() - new Date(lastCommitAt).getTime()) / MS_PER_DAY;
  return ageDays <= maxAgeDays;
}

export function deriveAuthFreshness(
  lastCommitAt: string | null,
  hasAuthInCode: boolean,
  hasV2Api: boolean,
  hasRsaPss: boolean,
): boolean {
  return authCommitFresh(lastCommitAt) && hasAuthInCode && (hasV2Api || hasRsaPss);
}

export function hasCentsPriceSignals(combinedText: string, orderHits: CodeSearchHit[]): boolean {
  const fromHits = orderHits.some((h) =>
    CENTS_PRICE_MARKERS.some((m) => h.query.toLowerCase().includes(m)),
  );
  if (fromHits) return true;
  const lower = combinedText.toLowerCase();
  if (CENTS_PRICE_MARKERS.some((m) => lower.includes(m))) return true;
  return /\bprice\b[^.\n]{0,40}\b([1-9]|[1-9][0-9])\b/.test(lower);
}

export function deriveCodeSignals(
  readme: string,
  authHits: CodeSearchHit[],
  orderHits: CodeSearchHit[],
  config: ResearchConfig,
) {
  const readmeLower = readme.toLowerCase();
  const combinedText = `${readmeLower}\n${[...authHits, ...orderHits].flatMap((h) => h.paths).join(" ").toLowerCase()}`;

  const usesOfficialSdk = SDK_MARKERS.some((m) => combinedText.includes(m.toLowerCase()));
  const hasAuthInCode = authHits.some((h) => AUTH_MARKERS.some((k) => h.query.includes(k)));
  const hasV2Api =
    authHits.some((h) => h.query.includes(V2_API_MARKER)) || combinedText.includes(V2_API_MARKER);
  const hasRsaPss = RSA_PSS_MARKERS.some((m) => combinedText.includes(m));
  const hasLiveOrderPath =
    orderHits.some((h) => ORDER_MARKERS.some((k) => h.query.includes(k))) ||
    combinedText.includes(PORTFOLIO_ORDERS_MARKER);
  const hasDryRunDefault = DRY_RUN_MARKERS.some((k) => combinedText.includes(k));
  const hasCentsPriceBounds = hasCentsPriceSignals(combinedText, orderHits);

  return {
    combinedText,
    usesOfficialSdk,
    hasAuthInCode,
    hasV2Api,
    hasRsaPss,
    hasLiveOrderPath,
    hasDryRunDefault,
    hasCentsPriceBounds,
    riskKeywordHits: config.keywords.riskKeywords.filter((k) => combinedText.includes(k.toLowerCase())),
  };
}

export function isSdkOnlyRepo(
  strategyTags: string[],
  usesOfficialSdk: boolean,
  hasLiveOrderPath: boolean,
  readme: string,
): boolean {
  const readmeLower = readme.toLowerCase();
  return (
    strategyTags.includes(SDK_ONLY_TAG) ||
    (usesOfficialSdk && !hasLiveOrderPath && readmeLower.includes("client") && readme.length < 2500)
  );
}
